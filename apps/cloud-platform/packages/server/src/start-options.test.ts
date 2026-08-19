import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveStartOptions } from "./start-options.js";

describe("resolveStartOptions", () => {
  it("defaults to localhost 4317 and ~/.lotaru", () => {
    const opts = resolveStartOptions([], {}, homedir());
    assert.equal(opts.port, 4317);
    assert.equal(opts.host, "127.0.0.1");
    assert.equal(opts.dataDir, join(homedir(), ".lotaru"));
    assert.equal(opts.staticDir, null);
  });

  it("reads LOTARU_PORT and LOTARU_DATA_DIR", () => {
    const opts = resolveStartOptions(
      [],
      { LOTARU_PORT: "4400", LOTARU_DATA_DIR: "/tmp/lotaru-data" },
      homedir(),
    );
    assert.equal(opts.port, 4400);
    assert.equal(opts.dataDir, "/tmp/lotaru-data");
    assert.equal(opts.host, "127.0.0.1");
  });

  it("honors --port and --data argv over env", () => {
    const opts = resolveStartOptions(
      ["--port", "4500", "--data", "/var/lotaru"],
      { LOTARU_PORT: "4400", LOTARU_DATA_DIR: "/tmp/ignored" },
      homedir(),
    );
    assert.equal(opts.port, 4500);
    assert.equal(opts.dataDir, "/var/lotaru");
  });

  it("honors short -p and -d flags", () => {
    const opts = resolveStartOptions(["-p", "4600", "-d", "C:\\lotaru-data"], {}, homedir());
    assert.equal(opts.port, 4600);
    assert.equal(opts.dataDir, "C:\\lotaru-data");
  });

  it("ignores invalid port values and keeps 4317", () => {
    const fromEnv = resolveStartOptions([], { LOTARU_PORT: "nope" }, homedir());
    assert.equal(fromEnv.port, 4317);
    const fromArgv = resolveStartOptions(["--port", "0"], {}, homedir());
    assert.equal(fromArgv.port, 4317);
  });
});
