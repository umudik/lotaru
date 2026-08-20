from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import struct
import time
from typing import Any

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

SAMPLE_RATE = 16000
SILENCE_SECONDS = float(os.environ.get("LOTARU_VOICE_SILENCE_SEC", "1.2"))
MIN_SPEECH_SECONDS = float(os.environ.get("LOTARU_VOICE_MIN_SPEECH_SEC", "0.35"))
ENERGY_THRESHOLD = float(os.environ.get("LOTARU_VOICE_ENERGY", "0.012"))
MOCK = os.environ.get("LOTARU_VOICE_MOCK", "").strip() in {"1", "true", "TRUE", "yes"}
MODEL_NAME = os.environ.get("LOTARU_WHISPER_MODEL", "medium")
LANGUAGE = os.environ.get("LOTARU_WHISPER_LANGUAGE", "tr")

app = FastAPI()
model = None


def load_model() -> Any:
    global model
    if MOCK:
        return None
    if model is not None:
        return model
    from faster_whisper import WhisperModel

    device = "cuda"
    compute = "float16"
    try:
        model = WhisperModel(MODEL_NAME, device=device, compute_type=compute)
    except Exception:
        model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
    return model


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    if len(pcm) < 2:
        return np.zeros(0, dtype=np.float32)
    count = len(pcm) // 2
    samples = struct.unpack("<" + ("h" * count), pcm[: count * 2])
    arr = np.asarray(samples, dtype=np.float32)
    return arr / 32768.0


def rms_energy(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio))))


def transcribe_audio(audio: np.ndarray) -> str:
    if MOCK:
        duration = audio.size / SAMPLE_RATE
        if duration < MIN_SPEECH_SECONDS:
            return ""
        return f"mock utterance {duration:.1f}s"
    loaded = load_model()
    if loaded is None:
        return ""
    segments, _info = loaded.transcribe(
        audio,
        language=LANGUAGE,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": int(SILENCE_SECONDS * 1000)},
    )
    parts: list[str] = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            parts.append(text)
    return " ".join(parts).strip()


class SessionState:
    def __init__(self) -> None:
        self.buffer = np.zeros(0, dtype=np.float32)
        self.speech_started_at: float | None = None
        self.last_voice_at: float | None = None
        self.partial_emitted = ""


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "mock": "1" if MOCK else "0"}


@app.websocket("/v1/stream")
async def stream(ws: WebSocket) -> None:
    await ws.accept()
    state = SessionState()
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
            audio = pcm16_to_float(data)
            if audio.size == 0:
                continue
            energy = rms_energy(audio)
            now = time.time()
            if energy >= ENERGY_THRESHOLD:
                if state.speech_started_at is None:
                    state.speech_started_at = now
                state.last_voice_at = now
                state.buffer = np.concatenate([state.buffer, audio])
                if state.buffer.size > SAMPLE_RATE * 2:
                    preview = state.buffer[-SAMPLE_RATE * 2 :]
                    preview_text = await asyncio.to_thread(transcribe_audio, preview)
                    if preview_text and preview_text != state.partial_emitted:
                        state.partial_emitted = preview_text
                        await ws.send_json(
                            {
                                "kind": "partial",
                                "text": preview_text,
                                "startedAt": state.speech_started_at,
                                "endedAt": now,
                            }
                        )
            else:
                state.buffer = np.concatenate([state.buffer, audio])
                if (
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
        state.buffer = np.zeros(0, dtype=np.float32)
        return
    duration = state.buffer.size / SAMPLE_RATE
    if duration < MIN_SPEECH_SECONDS and force is False:
        state.buffer = np.zeros(0, dtype=np.float32)
        state.speech_started_at = None
        state.last_voice_at = None
        state.partial_emitted = ""
        return
    audio = state.buffer.copy()
    started = state.speech_started_at
    ended = time.time()
    state.buffer = np.zeros(0, dtype=np.float32)
    state.speech_started_at = None
    state.last_voice_at = None
    state.partial_emitted = ""
    text = await asyncio.to_thread(transcribe_audio, audio)
    if text:
        await ws.send_json(
            {
                "kind": "final",
                "text": text,
                "startedAt": started,
                "endedAt": ended,
                "pcmB64": base64.b64encode(_float_to_pcm16(audio)).decode("ascii"),
            }
        )


def _float_to_pcm16(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    ints = (clipped * 32767.0).astype(np.int16)
    return ints.tobytes()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18765)
    args = parser.parse_args()
    if MOCK is False:
        load_model()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
