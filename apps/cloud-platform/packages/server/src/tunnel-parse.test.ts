import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipLogTail,
  cloudflaredAssetName,
  cloudflaredDownloadUrl,
  parseTunnelPublicUrl,
  redactSecret,
  tunnelBinaryFileName,
} from "./tunnel-parse.js";

describe("parseTunnelPublicUrl", () => {
  it("reads a Cloudflare quick tunnel URL from mixed stderr", () => {
    const log =
      "2026-09-08T00:00:00Z INF | https://lotaru-demo.trycloudflare.com | \nmetrics server";
    assert.equal(parseTunnelPublicUrl(log), "https://lotaru-demo.trycloudflare.com");
  });

  it("reads an ngrok free URL", () => {
    const log = "Forwarding  https://abc12.ngrok-free.app -> http://127.0.0.1:4317";
    assert.equal(parseTunnelPublicUrl(log), "https://abc12.ngrok-free.app");
  });

  it("strips a trailing period after the host", () => {
    assert.equal(
      parseTunnelPublicUrl("Your tunnel URL is https://x.trycloudflare.com."),
      "https://x.trycloudflare.com",
    );
  });

  it("rejects http and unrelated hosts", () => {
    assert.equal(parseTunnelPublicUrl("http://lotaru-demo.trycloudflare.com"), "");
    assert.equal(parseTunnelPublicUrl("https://example.com"), "");
  });
});

describe("cloudflared assets", () => {
  it("maps Windows, Linux, and Darwin release names", () => {
    assert.equal(cloudflaredAssetName("win32", "x64"), "cloudflared-windows-amd64.exe");
    assert.equal(cloudflaredAssetName("linux", "arm64"), "cloudflared-linux-arm64");
    assert.equal(cloudflaredAssetName("darwin", "arm64"), "cloudflared-darwin-arm64.tgz");
    assert.equal(cloudflaredAssetName("darwin", "x64"), "cloudflared-darwin-amd64.tgz");
    assert.equal(
      cloudflaredDownloadUrl("win32", "x64"),
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
    );
    assert.equal(tunnelBinaryFileName("cloudflare", "win32"), "cloudflared.exe");
    assert.equal(tunnelBinaryFileName("ngrok", "linux"), "ngrok");
  });
});

describe("log helpers", () => {
  it("redacts a secret and keeps a tail window", () => {
    assert.equal(redactSecret("token=sekrit-value done", "sekrit-value"), "token=[token] done");
    assert.equal(clipLogTail("abcdef", 4), "cdef");
    assert.equal(clipLogTail("ab", 4), "ab");
  });
});
