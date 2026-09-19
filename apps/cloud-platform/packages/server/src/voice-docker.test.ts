import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  VOICE_CPU_IMAGE,
  containerWhisperDevice,
  voiceCpuBuildPlatform,
  voiceCpuImageListFilters,
  voiceSidecarContextDir,
  voiceWhisperDevice,
} from "./voice-docker.js";

describe("voiceWhisperDevice", () => {
  it("uses CPU on macOS even when NVIDIA runtimes exist", () => {
    assert.equal(voiceWhisperDevice("darwin", true), "cpu");
    assert.equal(voiceWhisperDevice("darwin", false), "cpu");
  });

  it("uses CUDA only on Windows or Linux with an NVIDIA runtime", () => {
    assert.equal(voiceWhisperDevice("win32", true), "cuda");
    assert.equal(voiceWhisperDevice("linux", true), "cuda");
    assert.equal(voiceWhisperDevice("win32", false), "cpu");
    assert.equal(voiceWhisperDevice("linux", false), "cpu");
  });
});

describe("voiceCpuBuildPlatform", () => {
  it("maps Node arch to a Docker linux platform", () => {
    assert.equal(voiceCpuBuildPlatform("arm64"), "linux/arm64");
    assert.equal(voiceCpuBuildPlatform("x64"), "linux/amd64");
  });
});

describe("voiceCpuImageListFilters", () => {
  it("encodes a Docker reference filter as JSON text", () => {
    const encoded = voiceCpuImageListFilters();
    assert.equal(encoded.includes("reference"), true);
    assert.equal(encoded.includes(VOICE_CPU_IMAGE), true);
  });
});

describe("containerWhisperDevice", () => {
  it("reads cuda from container env and otherwise uses cpu", () => {
    assert.equal(containerWhisperDevice(["LOTARU_WHISPER_DEVICE=cuda"]), "cuda");
    assert.equal(containerWhisperDevice(["LOTARU_WHISPER_DEVICE=cpu"]), "cpu");
    assert.equal(containerWhisperDevice(["PATH=/usr/bin"]), "cpu");
  });
});

describe("voiceSidecarContextDir", () => {
  it("requires Dockerfile.cpu and sidecar sources", () => {
    const root = mkdtempSync(join(tmpdir(), "lotaru-voice-ctx-"));
    const hereDir = join(root, "packages", "server", "dist");
    const sidecar = join(root, "voice-sidecar");
    mkdirSync(hereDir, { recursive: true });
    mkdirSync(sidecar, { recursive: true });
    assert.throws(() => voiceSidecarContextDir(hereDir), /missing/i);
    writeFileSync(join(sidecar, "Dockerfile.cpu"), "FROM python:3.12-slim-bookworm\n");
    writeFileSync(join(sidecar, "server.py"), "print(1)\n");
    writeFileSync(join(sidecar, "requirements.txt"), "fastapi\n");
    writeFileSync(join(sidecar, "repeat_filter.py"), "def n():\n    return 1\n");
    assert.equal(voiceSidecarContextDir(hereDir), sidecar);
  });
});
