# Lotaru voice sidecar (faster-whisper + CUDA)

Stack (community default for NVIDIA):
- Runtime: [faster-whisper](https://github.com/SYSTRAN/faster-whisper) on CTranslate2
- Image: `nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04` (official SYSTRAN GPU path)
- Device: **CUDA only** by default (`LOTARU_WHISPER_DEVICE=cuda`) — refuses to start if no GPU
- RTX 3060 (12 GB): default model **`medium`** + `float16` + `beam_size=5`
- Language: `tr`

## Start

```bash
docker compose up -d --build voice-sidecar
```

Requires Docker NVIDIA runtime (`docker run --rm --gpus all nvidia/cuda:12.3.2-base-ubuntu22.04 nvidia-smi`).

Health: `http://127.0.0.1:18765/healthz` must show `"device":"cuda"`.

## Env

| Variable | Default | Notes |
| --- | --- | --- |
| `LOTARU_WHISPER_MODEL` | `medium` | Quality: `large-v3` / `oguzhangokboru/whisper-large-v3-tr` |
| `LOTARU_WHISPER_LANGUAGE` | `tr` | Fixed language (no auto-detect) |
| `LOTARU_WHISPER_DEVICE` | `cuda` | `cpu` only if you intentionally want CPU |
| `LOTARU_WHISPER_COMPUTE` | `float16` | Ampere (3060) sweet spot; `int8_float16` if VRAM tight |
| `LOTARU_WHISPER_BEAM` | `5` | Final utterance beam |
| `LOTARU_VOICE_PARTIAL_SEC` | `0.75` | Partial STT throttle |

Model cache: Docker volume `lotaru-whisper-cache`.

## Protocol

Send 16-bit LE mono PCM at 16 kHz. Receive JSON text only (no audio storage).
