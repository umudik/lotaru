import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cachedSqlite } from "./sqlite-cache.js";
import { ruleEventType } from "./events.js";
import {
  slugifyRuleName,
  type VoiceRule,
  type VoiceRuleMatch,
} from "./voice-rules.js";

export type VoiceRuleHit = VoiceRuleMatch & {
  id: string;
  projectId: string;
  ruleId: string;
  eventId: string;
  createdAt: number;
};

export const RULE_NAME_MAX = 80;
export const RULE_INSTRUCTION_MAX = 2000;
export const HIT_HISTORY_LIMIT = 60;

const ruleRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  slug: z.string(),
  instruction: z.string(),
  enabled: z.number(),
  created_at: z.string(),
  created_by: z.string(),
});

const hitRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  rule_id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  quote: z.string(),
  event_id: z.string(),
  created_at: z.number(),
});

export function openVoiceRulesDb(databasePath: string): Database.Database {
  return cachedSqlite("voice-rules", databasePath, (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_rules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        instruction TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_rules_slug ON voice_rules(project_id, slug);
      CREATE TABLE IF NOT EXISTS voice_rule_hits (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        quote TEXT NOT NULL,
        event_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_voice_rule_hits_project ON voice_rule_hits(project_id, created_at DESC);
    `);
  });
}

function ruleFromRow(row: z.infer<typeof ruleRowSchema>): VoiceRule {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug,
    instruction: row.instruction,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function listVoiceRules(db: Database.Database, projectId: string): VoiceRule[] {
  const rows = db
    .prepare("SELECT * FROM voice_rules WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId);
  const rules: VoiceRule[] = [];
  for (const entry of rows) {
    const parsed = ruleRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    rules.push(ruleFromRow(parsed.data));
  }
  return rules;
}

export function listEnabledVoiceRules(db: Database.Database, projectId: string): VoiceRule[] {
  const rules: VoiceRule[] = [];
  for (const rule of listVoiceRules(db, projectId)) {
    if (rule.enabled === true) {
      rules.push(rule);
    }
  }
  return rules;
}

/** Every rule event type the project can subscribe to, enabled or not. */
export function voiceRuleEventTypes(databasePath: string, projectId: string): string[] {
  const types: string[] = [];
  for (const rule of listVoiceRules(openVoiceRulesDb(databasePath), projectId)) {
    types.push(ruleEventType(rule.slug));
  }
  return types;
}

/** Label lookup so the events log can show "Reminder" instead of a raw slug. */
export function voiceRuleLabels(databasePath: string, projectId: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const rule of listVoiceRules(openVoiceRulesDb(databasePath), projectId)) {
    labels[ruleEventType(rule.slug)] = rule.name;
  }
  return labels;
}

export function getRule(db: Database.Database, id: string): VoiceRule | null {
  const row = db.prepare("SELECT * FROM voice_rules WHERE id = ?").get(id);
  const parsed = ruleRowSchema.safeParse(row);
  if (parsed.success !== true) {
    return null;
  }
  return ruleFromRow(parsed.data);
}

function slugTaken(db: Database.Database, projectId: string, slug: string, exceptId: string): boolean {
  const row = db
    .prepare("SELECT id FROM voice_rules WHERE project_id = ? AND slug = ? AND id <> ?")
    .get(projectId, slug, exceptId) as { id: string } | undefined;
  return row !== undefined;
}

/** Turns a name into a project-unique slug, appending -2, -3, … on collision. */
export function uniqueRuleSlug(
  db: Database.Database,
  projectId: string,
  requested: string,
  exceptId: string,
): string {
  const base = slugifyRuleName(requested);
  if (base.length === 0) {
    throw new Error("Rule name must contain letters or digits");
  }
  if (slugTaken(db, projectId, base, exceptId) !== true) {
    return base;
  }
  let counter = 2;
  while (counter < 100) {
    const candidate = `${base}-${String(counter)}`;
    if (slugTaken(db, projectId, candidate, exceptId) !== true) {
      return candidate;
    }
    counter += 1;
  }
  throw new Error("Could not derive a unique rule id");
}

export function recordRuleHit(
  db: Database.Database,
  input: {
    projectId: string;
    ruleId: string;
    match: VoiceRuleMatch;
    eventId: string;
  },
): void {
  db.prepare(
    "INSERT INTO voice_rule_hits (id, project_id, rule_id, slug, title, summary, quote, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    input.projectId,
    input.ruleId,
    input.match.slug,
    input.match.title,
    input.match.summary,
    input.match.quote,
    input.eventId,
    Date.now(),
  );
}

export function listRuleHits(db: Database.Database, projectId: string, limit: number): VoiceRuleHit[] {
  const rows = db
    .prepare(
      "SELECT * FROM voice_rule_hits WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(projectId, limit);
  const hits: VoiceRuleHit[] = [];
  for (const entry of rows) {
    const parsed = hitRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    hits.push({
      id: parsed.data.id,
      projectId: parsed.data.project_id,
      ruleId: parsed.data.rule_id,
      slug: parsed.data.slug,
      title: parsed.data.title,
      summary: parsed.data.summary,
      quote: parsed.data.quote,
      eventId: parsed.data.event_id,
      createdAt: parsed.data.created_at,
    });
  }
  return hits;
}

export function withRuleEventType(rule: VoiceRule): VoiceRule & { eventType: string } {
  return Object.assign({}, rule, { eventType: ruleEventType(rule.slug) });
}
