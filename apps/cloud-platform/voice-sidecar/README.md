# Lotaru voice sidecar (faster-whisper)

## Run

```bash
cd apps/cloud-platform/voice-sidecar
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set LOTARU_WHISPER_MODEL=medium
set LOTARU_WHISPER_LANGUAGE=tr
python server.py --port 18765
```

For highest accuracy on GPU, set `LOTARU_WHISPER_MODEL=large-v3`.

Mock mode (no model download):

```bash
set LOTARU_VOICE_MOCK=1
python server.py --port 18765
```

WebSocket: `ws://127.0.0.1:18765/v1/stream`

Send binary frames of 16-bit little-endian mono PCM at 16 kHz. Receive JSON:

```json
{"kind":"partial"|"final","text":"...","startedAt":123.0,"endedAt":124.0}
```
