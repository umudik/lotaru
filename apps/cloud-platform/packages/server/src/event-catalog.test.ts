import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { BUS_EVENT_TYPES, canonicalBusEventType, isBusEventType } from "./events.js";
import {
  isKnownEventType,
  PLATFORM_EVENT_TYPES,
  selectableEventTypes,
} from "./event-registry.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const WEB_CATALOG = join(SRC, "..", "..", "web", "src", "lib", "event-catalog.ts");

function webCatalogTypes(): string[] {
  const source = readFileSync(WEB_CATALOG, "utf8");
  const start = source.indexOf("export const CATALOG_EVENT_TYPES = [");
  assert.notEqual(start, -1, "web catalogue not found");
  const end = source.indexOf("];", start);
  const body = source.slice(start, end);
  const types: string[] = [];
  for (const match of body.matchAll(/"([^"]+)"/g)) {
    types.push(match[1]);
  }
  return types;
}

describe("event catalogue", () => {
  it("offers the same platform events to every subscriber", () => {
    assert.deepEqual([...PLATFORM_EVENT_TYPES].sort(), [...BUS_EVENT_TYPES].sort());
  });

  it("keeps the web catalogue in step with the server", () => {
    assert.deepEqual(webCatalogTypes().sort(), [...BUS_EVENT_TYPES].sort());
  });

  it("never offers the same event twice under different names", () => {
    const selectable = selectableEventTypes();
    const canonical = selectable.map((type) => canonicalBusEventType(type));
    assert.equal(new Set(canonical).size, canonical.length);
    // The alias stays accepted on rows that already reference it.
    assert.equal(isKnownEventType("note.page.written"), true);
    assert.equal(selectable.includes("note.page.written"), false);
  });

  it("accepts every catalogue entry as a subscription target", () => {
    for (const type of BUS_EVENT_TYPES) {
      assert.equal(isKnownEventType(type), true, `${type} is not subscribable`);
      assert.equal(isBusEventType(type), true, `${type} is not replayable`);
    }
  });

  it("treats rule events as first-class everywhere", () => {
    assert.equal(isKnownEventType("voice.rule.hatirlatma"), true);
    assert.equal(isBusEventType("voice.rule.hatirlatma"), true);
    assert.equal(isKnownEventType("voice.rule."), false);
    assert.equal(isKnownEventType("made.up.event"), false);
  });
});
