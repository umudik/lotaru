import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { LotaruEvent } from "./events.js";
import { storedEnvelopeFromPublish, type LotaruPublishInput } from "./event-publish.js";
import { openVoiceDb } from "./modules/voice.js";
import { openVoiceRulesDb } from "./voice-rule-store.js";
import { scanVoiceBatchForProject, VOICE_BATCH_INTERVAL_MS } from "./voice-batch.js";

const PROJECT = "proj-rules";

type Harness = {
  databasePath: string;
  emitted: LotaruEvent[];
  emit: (partial: LotaruPublishInput) => LotaruEvent;
  addSegment: (text: string, createdAt: number) => void;
};

function harness(rules: { slug: string; name: string; instruction: string }[]): Harness {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-batch-"));
  const databasePath = join(dir, "app.sqlite");
  const rulesDb = openVoiceRulesDb(databasePath);
  for (const rule of rules) {
    rulesDb
      .prepare(
        "INSERT INTO voice_rules (id, project_id, name, slug, instruction, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      )
      .run(randomUUID(), PROJECT, rule.name, rule.slug, rule.instruction, "now", "test");
  }
  const voiceDb = openVoiceDb(databasePath);
  const emitted: LotaruEvent[] = [];
  return {
    databasePath,
    emitted,
    emit: (partial) => {
      const stored = storedEnvelopeFromPublish(partial);
      const event: LotaruEvent = {
        id: `evt-${String(emitted.length + 1)}`,
        type: stored.type,
        projectId: stored.projectId,
        scriptId: stored.scriptId,
        path: stored.path,
        detail: stored.detail,
        createdAt: Date.now(),
      };
      emitted.push(event);
      return event;
    },
    addSegment: (text, createdAt) => {
      voiceDb
        .prepare(
          "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), PROJECT, "sess", "final", text, 0, 1, "", createdAt);
    },
  };
}

const HATIRLATMA = {
  slug: "hatirlatma",
  name: "Hatırlatma",
  instruction: "Konuşan bir hatırlatma bırakırsa.",
};

describe("scanVoiceBatchForProject", () => {
  it("emits one event per rule match plus a scan summary", async () => {
    const h = harness([HATIRLATMA]);
    h.addSegment("yarin Ali icin hatirlatma ekle", 1000);
    const result = await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 1,
      emit: h.emit,
      runScanner: async () =>
        '{"matches":[{"rule":"hatirlatma","title":"Ali ara","summary":"Yarin Ali aranacak","quote":"yarin Ali icin hatirlatma ekle"}]}',
    });
    assert.equal(result.ran, true);
    assert.equal(result.matched, 1);
    assert.equal(h.emitted.length, 2);
    assert.equal(h.emitted[0]?.type, "voice.rule.hatirlatma");
    assert.equal(h.emitted[0]?.path, "Ali ara");
    assert.equal(h.emitted[0]?.detail, "Yarin Ali aranacak");
    assert.equal(h.emitted[1]?.type, "voice.batch.scanned");
  });

  it("does nothing when the project has no enabled rules", async () => {
    const h = harness([]);
    h.addSegment("bir sey soyledim", 1000);
    const result = await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 1,
      emit: h.emit,
      runScanner: async () => {
        throw new Error("scanner must not run");
      },
    });
    assert.equal(result.ran, false);
    assert.equal(result.skipped, "no enabled rules");
    assert.equal(h.emitted.length, 0);
  });

  it("waits for the scan window unless forced", async () => {
    const h = harness([HATIRLATMA]);
    h.addSegment("hatirlatma ekle", 1000);
    const reply =
      '{"matches":[{"rule":"hatirlatma","title":"t","summary":"s","quote":"hatirlatma ekle"}]}';
    await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 1,
      emit: h.emit,
      runScanner: async () => reply,
    });
    h.addSegment("bir hatirlatma daha", 2000);
    const tooSoon = await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 2,
      emit: h.emit,
      runScanner: async () => reply,
    });
    assert.equal(tooSoon.ran, false);
    assert.equal(tooSoon.skipped, "waiting for the next scan window");
    const forced = await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 3,
      force: true,
      emit: h.emit,
      runScanner: async () =>
        '{"matches":[{"rule":"hatirlatma","title":"t2","summary":"s2","quote":"bir hatirlatma daha"}]}',
    });
    assert.equal(forced.ran, true);
    assert.equal(forced.scanned, 1);
  });

  it("emits every match and leaves duplicate judgement to subscribers", async () => {
    const h = harness([HATIRLATMA]);
    const reply = JSON.stringify({
      matches: [
        { rule: "hatirlatma", title: "t", summary: "s", quote: "hatirlatma ekle" },
        { rule: "hatirlatma", title: "t", summary: "s", quote: "hatirlatma ekle" },
      ],
    });
    h.addSegment("hatirlatma ekle", 1000);
    const result = await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 1,
      emit: h.emit,
      runScanner: async () => reply,
    });
    assert.equal(result.matched, 2);
    const ruleEvents = h.emitted.filter((event) => event.type === "voice.rule.hatirlatma");
    assert.equal(ruleEvents.length, 2);
  });

  it("keeps lines that arrive while the model is thinking", async () => {
    const h = harness([HATIRLATMA]);
    h.addSegment("ilk cumle", 1000);
    let seen = "";
    await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 1,
      emit: h.emit,
      runScanner: async () => {
        // Arrives mid-scan, timestamped after the batch the model was given.
        h.addSegment("gec gelen cumle", 5000);
        return '{"matches":[]}';
      },
    });
    await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 2,
      force: true,
      emit: h.emit,
      runScanner: async (payload) => {
        seen = payload.prompt;
        return '{"matches":[]}';
      },
    });
    assert.match(seen, /gec gelen cumle/);
    assert.doesNotMatch(seen, /ilk cumle/);
  });

  it("leaves the cursor alone when the model is unreachable", async () => {
    const h = harness([HATIRLATMA]);
    h.addSegment("hatirlatma ekle", 1000);
    const failed = await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 1,
      emit: h.emit,
      runScanner: async () => {
        throw new Error("Choose an Ollama model in Settings");
      },
    });
    assert.equal(failed.ran, false);
    assert.match(failed.skipped, /Ollama/);
    let seen = "";
    await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 2,
      force: true,
      emit: h.emit,
      runScanner: async (payload) => {
        seen = payload.prompt;
        return '{"matches":[]}';
      },
    });
    assert.match(seen, /hatirlatma ekle/);
  });

  it("reads transcript lines even when they were stored under another project", async () => {
    const h = harness([HATIRLATMA]);
    const voiceDb = openVoiceDb(h.databasePath);
    voiceDb
      .prepare(
        "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        "proj-other",
        "sess",
        "final",
        "yarin Ali icin hatirlatma ekle",
        0,
        1,
        "",
        1000,
      );
    let seen = "";
    const result = await scanVoiceBatchForProject({
      databasePath: h.databasePath,
      projectId: PROJECT,
      now: VOICE_BATCH_INTERVAL_MS + 1,
      emit: h.emit,
      runScanner: async (payload) => {
        seen = payload.prompt;
        return '{"matches":[{"rule":"hatirlatma","title":"Ali ara","summary":"Yarin Ali aranacak","quote":"yarin Ali icin hatirlatma ekle"}]}';
      },
    });
    assert.equal(result.ran, true);
    assert.match(seen, /hatirlatma ekle/);
    assert.equal(h.emitted[0]?.projectId, PROJECT);
  });
});
