import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { lotaruDatabasePath } from "./lotaru-db.js";

describe("lotaruDatabasePath", () => {
  it("puts app.sqlite in the data directory root", () => {
    assert.equal(lotaruDatabasePath("/data/lotaru"), join("/data/lotaru", "app.sqlite"));
  });
});
