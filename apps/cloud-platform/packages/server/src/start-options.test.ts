import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveStartOptions } from "./start-options.js";

describe("resolveStartOptions", () => {
  it("defaults to localhost 2222 and ~/.lotaru", () => {
    const opts = resolveStartOptions([], {}, homedir());
    assert.equal(opts.port, 2222);
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

  it("reads PORT HOST DATA_DIR aliases for Docker", () => {
    const opts = resolveStartOptions(
      [],
      { PORT: "8080", HOST: "0.0.0.0", DATA_DIR: "/data" },
      homedir(),
    );
    assert.equal(opts.port, 8080);
    assert.equal(opts.host, "0.0.0.0");
    assert.equal(opts.dataDir, "/data");
  });

  it("prefers LOTARU_* over bare PORT HOST DATA_DIR", () => {
    const opts = resolveStartOptions(
      [],
      {
        PORT: "8080",
        HOST: "0.0.0.0",
        DATA_DIR: "/data",
        LOTARU_PORT: "9090",
        LOTARU_HOST: "127.0.0.1",
        LOTARU_DATA_DIR: "/lotaru",
      },
      homedir(),
    );
    assert.equal(opts.port, 9090);
    assert.equal(opts.host, "127.0.0.1");
    assert.equal(opts.dataDir, "/lotaru");
  });

  it("honors --host over env", () => {
    const opts = resolveStartOptions(
      ["--host", "0.0.0.0"],
      { LOTARU_HOST: "127.0.0.1" },
      homedir(),
    );
    assert.equal(opts.host, "0.0.0.0");
  });
});
