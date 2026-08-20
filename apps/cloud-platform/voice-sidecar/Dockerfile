FROM nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && ln -sf /usr/bin/pip3 /usr/bin/pip

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY repeat_filter.py .

ENV LOTARU_WHISPER_MODEL=medium
ENV LOTARU_WHISPER_LANGUAGE=tr
ENV LOTARU_WHISPER_DEVICE=cuda
ENV LOTARU_WHISPER_COMPUTE=float16
ENV LOTARU_WHISPER_BEAM=5
ENV LOTARU_VOICE_SILENCE_SEC=2.0
ENV LOTARU_VOICE_MIN_SPEECH_SEC=0.7
ENV LOTARU_VOICE_PARTIAL_SEC=1.0
ENV LOTARU_VOICE_MAX_UTTERANCE_SEC=60
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

EXPOSE 18765

HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=10 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18765/healthz', timeout=3)"

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "18765"]
