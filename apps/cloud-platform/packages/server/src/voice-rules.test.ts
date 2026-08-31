import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRuleEventType, ruleEventSlug, ruleEventType } from "./events.js";
import {
  parseVoiceRuleMatches,
  slugifyRuleName,
  voiceRulePrompt,
} from "./voice-rules.js";

const RULES = [
  { slug: "hatirlatma", name: "Hatırlatma", instruction: "Konuşan bir hatırlatma bıraktığında." },
  { slug: "task", name: "Task", instruction: "Konuşan bir iş açılmasını istediğinde." },
];

describe("slugifyRuleName", () => {
  it("folds Turkish letters to ascii", () => {
    assert.equal(slugifyRuleName("Hatırlatma Ekle"), "hatirlatma-ekle");
    assert.equal(slugifyRuleName("Günlük Özet"), "gunluk-ozet");
    assert.equal(slugifyRuleName("İşe Başla"), "ise-basla");
  });

  it("collapses punctuation and trims dashes", () => {
    assert.equal(slugifyRuleName("  Task -- oluştur!  "), "task-olustur");
  });

  it("returns empty for names with no letters or digits", () => {
    assert.equal(slugifyRuleName("!!!"), "");
  });
});

describe("rule event types", () => {
  it("round-trips a slug", () => {
    const type = ruleEventType("hatirlatma");
    assert.equal(type, "voice.rule.hatirlatma");
    assert.equal(ruleEventSlug(type), "hatirlatma");
    assert.equal(isRuleEventType(type), true);
  });

  it("rejects platform events and malformed slugs", () => {
    assert.equal(isRuleEventType("task.created"), false);
    assert.equal(isRuleEventType("voice.rule."), false);
    assert.equal(isRuleEventType("voice.rule.Bad Slug"), false);
  });
});

describe("voiceRulePrompt", () => {
  it("lists every rule id and the transcript", () => {
    const prompt = voiceRulePrompt({ transcript: "yarin ara", rules: RULES });
    assert.match(prompt, /id "hatirlatma"/);
    assert.match(prompt, /id "task"/);
    assert.match(prompt, /yarin ara/);
  });
});

describe("parseVoiceRuleMatches", () => {
  it("reads a fenced JSON reply", () => {
    const raw = [
      "```json",
      '{"matches":[{"rule":"hatirlatma","title":"Ali ara","summary":"Yarin Ali aranacak","quote":"yarin Ali icin hatirlatma ekle"}]}',
      "```",
    ].join("\n");
    const matches = parseVoiceRuleMatches(raw, RULES);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.slug, "hatirlatma");
    assert.equal(matches[0]?.title, "Ali ara");
  });

  it("matches a rule by display name when the model echoes it", () => {
    const raw = '{"matches":[{"rule":"Hatırlatma","title":"t","summary":"s","quote":"q"}]}';
    assert.equal(parseVoiceRuleMatches(raw, RULES)[0]?.slug, "hatirlatma");
  });

  it("drops entries naming a rule the project does not have", () => {
    const raw = '{"matches":[{"rule":"nope","title":"t","summary":"s","quote":"q"}]}';
    assert.deepEqual(parseVoiceRuleMatches(raw, RULES), []);
  });

  it("drops entries with neither a title nor a summary", () => {
    const raw = '{"matches":[{"rule":"task","title":"","summary":"","quote":"q"}]}';
    assert.deepEqual(parseVoiceRuleMatches(raw, RULES), []);
  });

  it("returns nothing for junk", () => {
    assert.deepEqual(parseVoiceRuleMatches("I could not find anything.", RULES), []);
    assert.deepEqual(parseVoiceRuleMatches("", RULES), []);
  });
});
