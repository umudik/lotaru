from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import struct
import time
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from repeat_filter import normalize_spaces, sanitize_transcript

SAMPLE_RATE = 16000
FINAL_BEAM = int(os.environ.get("LOTARU_WHISPER_BEAM", "2"))
PARTIAL_BEAM = int(os.environ.get("LOTARU_WHISPER_PARTIAL_BEAM", "1"))
MODEL_NAME = os.environ.get("LOTARU_WHISPER_MODEL", "medium")
LANGUAGE = os.environ.get("LOTARU_WHISPER_LANGUAGE", "tr")
DEVICE_PREF = os.environ.get("LOTARU_WHISPER_DEVICE", "cuda").strip().lower()
COMPUTE_TYPE = os.environ.get("LOTARU_WHISPER_COMPUTE", "float16").strip()
SILENCE_SECONDS = float(os.environ.get("LOTARU_VOICE_SILENCE_SEC", "2.0"))
MIN_SPEECH_SECONDS = float(os.environ.get("LOTARU_VOICE_MIN_SPEECH_SEC", "0.7"))
ENERGY_THRESHOLD = float(os.environ.get("LOTARU_VOICE_ENERGY", "0.010"))
PARTIAL_INTERVAL_SEC = float(os.environ.get("LOTARU_VOICE_PARTIAL_SEC", "4.0"))
MAX_UTTERANCE_SEC = float(os.environ.get("LOTARU_VOICE_MAX_UTTERANCE_SEC", "45"))

app = FastAPI()
model = None
loaded_device = "none"
loaded_compute = ""
np: Any = None


def ensure_numpy() -> Any:
    global np
    if np is not None:
        return np
    import numpy as imported

    np = imported
    return np


def require_cuda_devices() -> int:
    import ctranslate2

    count = int(ctranslate2.get_cuda_device_count())
    if count < 1:
        raise RuntimeError(
            "CUDA required but ctranslate2 sees 0 GPUs — "
            "docker compose must set gpus: all and NVIDIA Container Toolkit must work"
        )
    return count


def load_model() -> Any:
    global model
    global loaded_device
    global loaded_compute
    if model is not None:
        return model
    ensure_numpy()
    from faster_whisper import WhisperModel

    prefer = DEVICE_PREF
    if prefer not in {"cuda", "cpu", "auto"}:
        prefer = "cuda"
    if prefer == "cpu":
        model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
        loaded_device = "cpu"
        loaded_compute = "int8"
        return model
    if prefer == "cuda":
        gpu_count = require_cuda_devices()
        model = WhisperModel(MODEL_NAME, device="cuda", compute_type=COMPUTE_TYPE)
        loaded_device = "cuda"
        loaded_compute = COMPUTE_TYPE
        print(
            f"voice-sidecar: faster-whisper model={MODEL_NAME} "
            f"device=cuda compute={COMPUTE_TYPE} gpus={gpu_count}"
        )
        return model
    try:
        gpu_count = require_cuda_devices()
        model = WhisperModel(MODEL_NAME, device="cuda", compute_type=COMPUTE_TYPE)
        loaded_device = "cuda"
        loaded_compute = COMPUTE_TYPE
        print(
            f"voice-sidecar: faster-whisper model={MODEL_NAME} "
            f"device=cuda compute={COMPUTE_TYPE} gpus={gpu_count}"
        )
        return model
    except Exception as exc:
        print(f"voice-sidecar: CUDA unavailable ({exc}); falling back to CPU int8")
        model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
        loaded_device = "cpu"
        loaded_compute = "int8"
        return model


def pcm16_to_floats(pcm: bytes) -> list[float]:
    if len(pcm) < 2:
        return []
    count = len(pcm) // 2
    samples = struct.unpack("<" + ("h" * count), pcm[: count * 2])
    return [sample / 32768.0 for sample in samples]


def rms_energy_list(audio: list[float]) -> float:
    if len(audio) == 0:
        return 0.0
    total = 0.0
    for sample in audio:
        total += sample * sample
    return math.sqrt(total / len(audio))


def should_emit_partial(previous: str, candidate: str) -> bool:
    cleaned = sanitize_transcript(candidate)
    if len(cleaned) == 0:
        return False
    prior = normalize_spaces(previous)
    if len(prior) == 0:
        return True
    if cleaned == prior:
        return False
    if cleaned.startswith(prior):
        return True
    if prior.startswith(cleaned):
        return False
    shared = 0
    limit = min(len(prior), len(cleaned))
    for index in range(limit):
        if prior[index] != cleaned[index]:
            break
        shared += 1
    if shared >= 12 and len(cleaned) >= len(prior):
        return True
    if len(cleaned) > len(prior) + 8 and shared >= max(8, len(prior) // 3):
        return True
    return False


def prefer_stable_text(partial: str, final: str) -> str:
    cleaned_final = sanitize_transcript(final)
    cleaned_partial = sanitize_transcript(partial)
    if len(cleaned_final) == 0:
        return cleaned_partial
    if len(cleaned_partial) == 0:
        return cleaned_final
    if cleaned_final.startswith(cleaned_partial) or cleaned_partial.startswith(cleaned_final):
        if len(cleaned_final) >= len(cleaned_partial):
            return cleaned_final
        return cleaned_partial
    shared = 0
    limit = min(len(cleaned_partial), len(cleaned_final))
    for index in range(limit):
        if cleaned_partial[index] != cleaned_final[index]:
            break
        shared += 1
    if shared >= 12 and len(cleaned_partial) > len(cleaned_final) + 4:
        return cleaned_partial
    return cleaned_final


def transcribe_audio(
    audio: list[float],
    beam_size: int,
    *,
    use_vad: bool,
) -> str:
    numpy = ensure_numpy()
    loaded = load_model()
    arr = numpy.asarray(audio, dtype=numpy.float32)
    kwargs: dict[str, Any] = {
        "language": LANGUAGE,
        "beam_size": beam_size,
        "best_of": 1,
        "temperature": 0.0,
        "condition_on_previous_text": False,
        "without_timestamps": True,
        "compression_ratio_threshold": 2.2,
        "log_prob_threshold": -0.8,
        "no_speech_threshold": 0.6,
        "no_repeat_ngram_size": 3,
        "vad_filter": use_vad,
    }
    if use_vad:
        kwargs["vad_parameters"] = {
            "min_silence_duration_ms": int(SILENCE_SECONDS * 1000),
        }
    segments, _info = loaded.transcribe(arr, **kwargs)
    parts: list[str] = []
    for segment in segments:
        text = sanitize_transcript(segment.text)
        if text:
            parts.append(text)
    return sanitize_transcript(" ".join(parts))


class SessionState:
    def __init__(self) -> None:
        self.buffer: list[float] = []
        self.speech_started_at: float | None = None
        self.last_voice_at: float | None = None
        self.last_partial_at: float = 0.0
        self.partial_emitted = ""
        self.partial_busy = False


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "language": LANGUAGE,
        "device": loaded_device,
        "compute": loaded_compute if loaded_compute else "unknown",
    }


@app.websocket("/v1/stream")
async def stream(ws: WebSocket) -> None:
    await ws.accept()
    state = SessionState()
    max_samples = int(SAMPLE_RATE * MAX_UTTERANCE_SEC)
    try:
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            data = message.get("bytes")
            text = message.get("text")
            if text is not None:
                payload = json.loads(text)
                if payload.get("op") == "flush":
                    await flush_utterance(ws, state, force=True)
                continue
            if data is None:
                continue
            audio = pcm16_to_floats(data)
            if len(audio) == 0:
                continue
            energy = rms_energy_list(audio)
            now = time.time()
            state.buffer.extend(audio)
            if len(state.buffer) > max_samples:
                state.buffer = state.buffer[-max_samples:]
            if energy >= ENERGY_THRESHOLD:
                if state.speech_started_at is None:
                    state.speech_started_at = now
                state.last_voice_at = now
                due = now - state.last_partial_at >= PARTIAL_INTERVAL_SEC
                enough = len(state.buffer) >= int(SAMPLE_RATE * 0.6)
                if enough and due and state.partial_busy is False:
                    state.partial_busy = True
                    state.last_partial_at = now
                    preview = list(state.buffer)
                    try:
                        preview_text = await asyncio.to_thread(
                            transcribe_audio,
                            preview,
                            PARTIAL_BEAM,
                            use_vad=False,
                        )
                    finally:
                        state.partial_busy = False
                    if should_emit_partial(state.partial_emitted, preview_text):
                        state.partial_emitted = normalize_spaces(preview_text)
                        await ws.send_json(
                            {
                                "kind": "partial",
                                "text": state.partial_emitted,
                                "startedAt": state.speech_started_at,
                                "endedAt": now,
                            }
                        )
            elif (
                state.speech_started_at is not None
                and state.last_voice_at is not None
                and now - state.last_voice_at >= SILENCE_SECONDS
            ):
                await flush_utterance(ws, state, force=False)
    except WebSocketDisconnect:
        return
    except Exception as exc:
        await ws.send_json({"kind": "error", "text": str(exc)})


async def flush_utterance(ws: WebSocket, state: SessionState, force: bool) -> None:
    if state.speech_started_at is None:
        state.buffer = []
        return
    duration = len(state.buffer) / SAMPLE_RATE
    if duration < MIN_SPEECH_SECONDS and force is False:
        state.buffer = []
        state.speech_started_at = None
        state.last_voice_at = None
        state.last_partial_at = 0.0
        state.partial_emitted = ""
        return
    audio = list(state.buffer)
    started = state.speech_started_at
    ended = time.time()
    sticky_partial = state.partial_emitted
    state.buffer = []
    state.speech_started_at = None
    state.last_voice_at = None
    state.last_partial_at = 0.0
    state.partial_emitted = ""
    final_text = await asyncio.to_thread(
        transcribe_audio,
        audio,
        FINAL_BEAM,
        use_vad=True,
    )
    text = prefer_stable_text(sticky_partial, final_text)
    if text:
        await ws.send_json(
            {
                "kind": "final",
                "text": text,
                "startedAt": started,
                "endedAt": ended,
            }
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18765)
    args = parser.parse_args()
    load_model()
    if DEVICE_PREF == "cuda" and loaded_device != "cuda":
        raise SystemExit("LOTARU_WHISPER_DEVICE=cuda but model did not load on CUDA")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
