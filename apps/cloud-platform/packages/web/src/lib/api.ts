import type { Session } from "./session";
import { loadSession, saveSession } from "./session";

export const DEFAULT_WORKFLOW_TEMPLATE_ID = "plan-build-deliver";

export type Project = {
  id: string;
  name: string;
  description: string;
  workflowTemplateId: string;
  repoPath: string;
};

export type UpdateProjectInput = {
  name: string;
  description: string;
  workflowTemplateId: string;
  repoPath: string;
};

export type CreateProjectInput = {
  name: string;
  description: string;
  workflowTemplateId: string;
  repoPath: string;
};

export type AppSettings = {
  ollamaHost: string;
  ollamaModel: string;
  translationEnabled: boolean;
  targetLanguage: string;
  ttsEngine: "edge" | "qwen";
  qwenTtsUrl: string;
  ttsVoice: string;
};

export type TargetLanguage = {
  id: string;
  label: string;
};

export type TtsVoiceOption = {
  id: string;
  label: string;
  locale: string;
  gender: string;
};

export type LotaruEventListener = {
  kind: "script" | "agent" | "knowledge";
  id: string;
  label: string;
};

export type LotaruEventRow = {
  id: string;
  type: string;
  projectId: string;
  scriptId: string;
  path: string;
  detail: string;
  createdAt: number;
  replayable: boolean;
  listeners: LotaruEventListener[];
};

export async function fetchGithubSettings(session: Session) {
  return request<{ connected: boolean }>(session, "/api/settings/github");
}

export async function saveGithubSettings(session: Session, token: string) {
  return request<{ connected: boolean }>(session, "/api/settings/github", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export type TunnelProvider = "cloudflare" | "ngrok";
export type TunnelState = "off" | "starting" | "up" | "missing_binary" | "error";

export type TunnelSnapshot = {
  enabled: boolean;
  provider: TunnelProvider;
  ngrokConfigured: boolean;
  state: TunnelState;
  publicUrl: string;
  detail: string;
};

export async function fetchTunnelSettings(session: Session) {
  return request<{ tunnel: TunnelSnapshot }>(session, "/api/settings/tunnel");
}

export async function saveTunnelSettings(
  session: Session,
  input: { enabled: boolean; provider: TunnelProvider; ngrokToken: string },
) {
  return request<{ tunnel: TunnelSnapshot }>(session, "/api/settings/tunnel", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function restartTunnelSettings(session: Session) {
  return request<{ tunnel: TunnelSnapshot }>(session, "/api/settings/tunnel/restart", {
    method: "POST",
  });
}

export type IngestPollRow = {
  connector: string;
  scope: string;
  cursor: string;
  primed: boolean;
  lastSuccessAt: number;
  lastError: string;
  lagged: boolean;
};

export type IngestHookRow = {
  connectorId: string;
  token: string;
};

export type IngestHookSyncRow = {
  connector: string;
  repo: string;
  url: string;
  lastError: string;
};

export type IngestAlarmKind = "ok" | "behind" | "poll_error" | "tunnel_down";

export type IngestAlarm = {
  kind: IngestAlarmKind;
  title: string;
  detail: string;
  connectors: string[];
};

export async function fetchIngestSettings(session: Session) {
  return request<{
    polls: IngestPollRow[];
    hooks: IngestHookRow[];
    alarm: IngestAlarm;
    hookSync: IngestHookSyncRow[];
    notionVerificationToken: string;
  }>(session, "/api/settings/ingest");
}

export type ConnectorRow = {
  id: string;
  label: string;
  intake: string;
  connected: boolean;
  events: { type: string; label: string }[];
};

export async function fetchConnectors(session: Session) {
  return request<{ connectors: ConnectorRow[] }>(session, "/api/connectors");
}

export async function saveConnectorSecret(
  session: Session,
  connectorId: ConnectorRow["id"],
  secret: string,
) {
  return request<{ connected: boolean }>(session, `/api/connectors/${connectorId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
}

export type AiToolLane = "local" | "cloud" | "cli";

export type AiToolRow = {
  id: string;
  label: string;
  lane: AiToolLane;
  protocol: string;
  connected: boolean;
  baseUrl: string;
  model: string;
  defaultBase: string;
  defaultModel: string;
};

export type AiToolHealth = {
  id: string;
  reachable: boolean;
  models: string[];
  detail: string;
  error: string;
};

export async function fetchAiTools(session: Session) {
  return request<{ tools: AiToolRow[] }>(session, "/api/ai-tools");
}

export async function saveAiTool(
  session: Session,
  toolId: string,
  input: { secret: string; baseUrl: string; model: string; disconnect: boolean },
) {
  return request<{ tool: AiToolRow }>(session, `/api/ai-tools/${encodeURIComponent(toolId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function probeAiTool(session: Session, toolId: string) {
  return request<{ health: AiToolHealth; tool: AiToolRow }>(
    session,
    `/api/ai-tools/${encodeURIComponent(toolId)}/health`,
    { method: "POST" },
  );
}

export async function fetchProjectEvents(
  session: Session,
  projectId: string,
  input: { limit: number; cursor: string; type: string },
) {
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor.trim().length > 0) {
    query.set("cursor", input.cursor);
  }
  if (input.type.trim().length > 0) {
    query.set("type", input.type);
  }
  return request<{ events: LotaruEventRow[]; next: string[] }>(
    session,
    `/api/v1/projects/${encodeURIComponent(projectId)}/events?${query.toString()}`,
  );
}

export async function replayProjectEvent(session: Session, projectId: string, eventId: string) {
  return request<{ ok: boolean }>(
    session,
    `/api/v1/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}/replay`,
    { method: "POST" },
  );
}

export type AgentKind = "ollama" | "cursor" | "claude" | "codex";
export type AgentMode = "ask" | "plan" | "execute";

export type AgentProfile = {
  kind: AgentKind;
  mode: AgentMode;
  command: string;
};

export type KnowledgeIntent = "process" | "api" | "overview";
export type KnowledgeAudience = "developer" | "ops" | "frontend";
export type KnowledgeView = "all" | "documentation" | "diagrams";
export type KnowledgeKind = "document" | "diagram";

export type KnowledgeTemplate = {
  id: string;
  projectId: string;
  kind: KnowledgeKind;
  title: string;
  eventType: string;
  scheduleCron: string;
  description: string;
  language: string;
  aiToolId: string;
  enabled: boolean;
  marketplaceId: string;
  createdAt: string;
  createdBy: string;
};

export type KnowledgeArtifact = {
  id: string;
  projectId: string;
  templateId: string;
  templateTitle: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  language: string;
  eventType: string;
  eventId: string;
  createdAt: string;
};

export type KnowledgeOutput = {
  currentBody: string;
  proposedBody: string;
  currentVersion: number;
  proposedVersion: number;
  sourcesText: string;
};

export type KnowledgeItem = {
  id: string;
  projectId: string;
  subject: string;
  intent: KnowledgeIntent;
  audience: KnowledgeAudience;
  language: string;
  stale: boolean;
  createdAt: string;
  createdBy: string;
  document: KnowledgeOutput;
  diagram: KnowledgeOutput;
};

/** "event" publishes the reply on the bus as the agent's own event type. */
export type AgentAction = "none" | "note" | "task" | "event";

export type LotaruAgent = {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  trigger: "event" | "schedule";
  eventType: string;
  /** The event type this agent mints; it publishes on it while the action is "event". */
  outputEventType: string;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleCron: string;
  includeVoice: boolean;
  action: AgentAction;
  noteBookTitle: string;
  aiToolId: string;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
};

export type AgentRunRow = {
  id: string;
  agentId: string;
  projectId: string;
  status: "running" | "done" | "error";
  output: string;
  error: string;
  startedAt: string;
  finishedAt: string;
};

export async function fetchAgents(session: Session, projectId: string) {
  const query = new URLSearchParams({ projectId });
  return request<{ agents: LotaruAgent[] }>(session, `/api/agents?${query.toString()}`);
}

export async function createAgent(
  session: Session,
  input: {
    projectId: string;
    title: string;
    prompt: string;
    trigger: "event" | "schedule";
    eventType?: string;
    scheduleHour?: number;
    scheduleMinute?: number;
    scheduleCron?: string;
    includeVoice?: boolean;
    action?: AgentAction;
    noteBookTitle?: string;
    aiToolId?: string;
    enabled?: boolean;
  },
) {
  return request<LotaruAgent>(session, "/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function patchAgent(
  session: Session,
  agentId: string,
  input: {
    title?: string;
    prompt?: string;
    trigger?: "event" | "schedule";
    eventType?: string;
    scheduleHour?: number;
    scheduleMinute?: number;
    scheduleCron?: string;
    includeVoice?: boolean;
    action?: AgentAction;
    noteBookTitle?: string;
    aiToolId?: string;
    enabled?: boolean;
  },
) {
  return request<LotaruAgent>(session, `/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteAgent(session: Session, agentId: string) {
  return request<{ ok: boolean }>(session, `/api/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
}

export async function runAgentNow(session: Session, agentId: string) {
  return request<{ ok: boolean }>(session, `/api/agents/${encodeURIComponent(agentId)}/run`, {
    method: "POST",
  });
}

export type VoiceRule = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  instruction: string;
  eventType: string;
  enabled: boolean;
  subscriberCount: number;
  createdAt: string;
  createdBy: string;
};

export type EventSubscriber = {
  kind: "agent" | "script" | "knowledge";
  eventType: string;
  id: string;
  label: string;
  enabled: boolean;
};

export type VoiceRuleHit = {
  id: string;
  projectId: string;
  ruleId: string;
  slug: string;
  title: string;
  summary: string;
  quote: string;
  eventId: string;
  createdAt: number;
};

export type VoiceRuleMatch = {
  slug: string;
  title: string;
  summary: string;
  quote: string;
};

export type EventTypeOption = {
  type: string;
  label: string;
  kind: "platform" | "rule" | "agent" | "connection";
  sourceId: string;
  sourceLabel: string;
};

export async function fetchEventTypes(session: Session, projectId: string) {
  const query = new URLSearchParams({ projectId });
  return request<{ eventTypes: EventTypeOption[] }>(
    session,
    `/api/event-types?${query.toString()}`,
  );
}

export async function fetchVoiceRules(session: Session, projectId: string) {
  const query = new URLSearchParams({ projectId });
  return request<{ rules: VoiceRule[]; hits: VoiceRuleHit[]; runtime: AgentKind }>(
    session,
    `/api/voice-rules?${query.toString()}`,
  );
}

export async function fetchVoiceRuleSubscribers(session: Session, ruleId: string) {
  return request<{ subscribers: EventSubscriber[] }>(
    session,
    `/api/voice-rules/${encodeURIComponent(ruleId)}/subscribers`,
  );
}

export async function createVoiceRule(
  session: Session,
  input: {
    projectId: string;
    name: string;
    slug?: string;
    instruction: string;
    enabled?: boolean;
  },
) {
  return request<VoiceRule>(session, "/api/voice-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function patchVoiceRule(
  session: Session,
  ruleId: string,
  input: { name?: string; slug?: string; instruction?: string; enabled?: boolean },
) {
  return request<VoiceRule>(session, `/api/voice-rules/${encodeURIComponent(ruleId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteVoiceRule(session: Session, ruleId: string) {
  return request<{ ok: boolean }>(session, `/api/voice-rules/${encodeURIComponent(ruleId)}`, {
    method: "DELETE",
  });
}

export async function testVoiceRules(session: Session, projectId: string, transcript: string) {
  return request<{ matches: VoiceRuleMatch[]; ran: boolean; error: string }>(
    session,
    "/api/voice-rules/test",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, transcript }),
    },
  );
}

export async function scanVoiceRulesNow(session: Session, projectId: string) {
  return request<{ ran: boolean; scanned: number; matched: number; skipped: string }>(
    session,
    "/api/voice-rules/scan",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    },
  );
}

export async function fetchAgentRuns(session: Session, agentId: string) {
  return request<{ runs: AgentRunRow[] }>(
    session,
    `/api/agents/${encodeURIComponent(agentId)}/runs`,
  );
}

export async function fetchKnowledgeTemplates(
  session: Session,
  projectId: string,
  kind: KnowledgeKind,
) {
  const query = new URLSearchParams({ projectId, kind });
  return request<{ templates: KnowledgeTemplate[] }>(
    session,
    `/api/knowledge/templates?${query.toString()}`,
  );
}

export type MarketplaceKind = "document" | "diagram" | "script" | "task";

export type MarketplaceCategory = {
  id: string;
  label: string;
};

export type MarketplaceCatalogItem = {
  id: string;
  kind: MarketplaceKind;
  category: string;
  categoryLabel: string;
  title: string;
  summary: string;
  source: string;
  installed: boolean;
  imported: boolean;
};

export type MarketplaceCatalog = {
  categories: MarketplaceCategory[];
  items: MarketplaceCatalogItem[];
};

export type MarketplaceInstall = {
  id: string;
  projectId: string;
  kind: MarketplaceKind;
  title: string;
  marketplaceId: string;
  enabled: boolean;
};

export async function fetchMarketplaceCatalog(session: Session, projectId: string) {
  const query = new URLSearchParams({ projectId });
  return request<MarketplaceCatalog>(
    session,
    `/api/marketplace/catalog?${query.toString()}`,
  );
}

export async function installMarketplaceItem(
  session: Session,
  input: { projectId: string; catalogId: string },
) {
  return request<MarketplaceInstall>(session, "/api/marketplace/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function uninstallMarketplaceItem(
  session: Session,
  projectId: string,
  catalogId: string,
) {
  const query = new URLSearchParams({ projectId });
  const path = `/api/marketplace/installs/${encodeURIComponent(catalogId)}?${query.toString()}`;
  await request<void>(session, path, {
    method: "DELETE",
  });
}

export type MarketplacePack = {
  format: string;
  version: number;
  items: unknown[];
};

export type MarketplaceImportResult = {
  added: number;
  updated: number;
  skippedBuiltin: number;
};

function downloadMarketplaceJson(pack: MarketplacePack, fileName: string): void {
  const json = JSON.stringify(pack, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export async function exportMarketplacePack(session: Session, projectId: string): Promise<void> {
  const query = new URLSearchParams({ projectId });
  const pack = await request<MarketplacePack>(
    session,
    `/api/marketplace/export?${query.toString()}`,
  );
  downloadMarketplaceJson(pack, "lotaru-marketplace.json");
}

export async function importMarketplacePack(
  session: Session,
  projectId: string,
  pack: unknown,
): Promise<MarketplaceImportResult> {
  let body = "";
  try {
    body = JSON.stringify(Object.assign({ projectId }, pack));
  } catch {
    throw new Error("Invalid marketplace pack");
  }
  if (body.length === 0) {
    throw new Error("Invalid marketplace pack");
  }
  return request<MarketplaceImportResult>(session, "/api/marketplace/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

export async function removeImportedMarketplaceItem(
  session: Session,
  projectId: string,
  catalogId: string,
): Promise<void> {
  const query = new URLSearchParams({ projectId });
  const path = `/api/marketplace/imported/${encodeURIComponent(catalogId)}?${query.toString()}`;
  await request<void>(session, path, {
    method: "DELETE",
  });
}

export async function createKnowledgeTemplate(
  session: Session,
  input: {
    projectId: string;
    kind: KnowledgeKind;
    title: string;
    eventType: string;
    scheduleCron?: string;
    description: string;
    language: string;
    aiToolId?: string;
    enabled?: boolean;
  },
) {
  return request<KnowledgeTemplate>(session, "/api/knowledge/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteKnowledgeTemplate(session: Session, templateId: string) {
  return request<{ ok: boolean }>(
    session,
    `/api/knowledge/templates/${encodeURIComponent(templateId)}`,
    { method: "DELETE" },
  );
}

export type VoiceSegment = {
  id: string;
  projectId: string;
  sessionId: string;
  kind: "partial" | "final";
  text: string;
  startedAt: number;
  endedAt: number;
  audioPath: string;
  createdAt: number;
};

export async function fetchVoiceSegments(
  session: Session,
  projectId: string,
  options: { limit?: number; cursor?: string } = {},
) {
  const query = new URLSearchParams({ projectId });
  let limit = 40;
  if (options.limit !== undefined) {
    limit = options.limit;
  }
  query.set("limit", String(limit));
  if (options.cursor !== undefined && options.cursor.length > 0) {
    query.set("cursor", options.cursor);
  }
  return request<{ segments: VoiceSegment[]; next: string[] }>(
    session,
    `/api/voice/segments?${query.toString()}`,
  );
}

export async function fetchVoiceStatus(session: Session, projectId: string) {
  const query = new URLSearchParams({ projectId });
  return request<{
    listening: boolean;
    projectId: string;
    sessionId: string;
    sidecar: boolean;
    sidecarMode: string;
    sidecarReachable: boolean;
    sidecarUrl: string;
    sidecarModel: string;
    sidecarLanguage: string;
    sidecarDevice: string;
  }>(session, `/api/voice/status?${query.toString()}`);
}

export async function fetchKnowledgeArtifacts(
  session: Session,
  projectId: string,
  kind: KnowledgeKind,
) {
  const query = new URLSearchParams({ projectId, kind });
  return request<{ artifacts: KnowledgeArtifact[] }>(
    session,
    `/api/knowledge/artifacts?${query.toString()}`,
  );
}

export async function fetchKnowledgeArtifact(session: Session, artifactId: string) {
  return request<KnowledgeArtifact>(
    session,
    `/api/knowledge/artifacts/${encodeURIComponent(artifactId)}`,
  );
}

export async function patchKnowledgeArtifact(
  session: Session,
  artifactId: string,
  patch: Partial<{ title: string; body: string }>,
) {
  return request<KnowledgeArtifact>(
    session,
    `/api/knowledge/artifacts/${encodeURIComponent(artifactId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

export async function deleteKnowledgeArtifact(session: Session, artifactId: string) {
  return request<{ ok: boolean }>(
    session,
    `/api/knowledge/artifacts/${encodeURIComponent(artifactId)}`,
    { method: "DELETE" },
  );
}

export async function fetchAgentSettings(session: Session) {
  return request<{ profile: AgentProfile }>(session, "/api/settings/agent");
}

export async function saveAgentSettings(session: Session, profile: AgentProfile) {
  return request<{ profile: AgentProfile }>(session, "/api/settings/agent", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}

export async function probeAgentSettings(session: Session, profile: AgentProfile) {
  return request<{
    reachable: boolean;
    kind: AgentKind;
    command: string;
    detail: string;
    error: string;
  }>(session, "/api/settings/agent/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}

export async function fetchKnowledgeItems(session: Session, projectId: string, view: KnowledgeView) {
  const query = new URLSearchParams({ projectId, view });
  return request<{ items: KnowledgeItem[] }>(session, `/api/knowledge?${query.toString()}`);
}

export async function fetchKnowledgeItem(session: Session, itemId: string) {
  return request<KnowledgeItem>(session, `/api/knowledge/${encodeURIComponent(itemId)}`);
}

export async function createKnowledgeItem(
  session: Session,
  input: {
    projectId: string;
    subject: string;
    intent: KnowledgeIntent;
    audience: KnowledgeAudience;
    language: string;
  },
) {
  return request<KnowledgeItem>(session, "/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function patchKnowledgeItem(
  session: Session,
  itemId: string,
  patch: Partial<{
    subject: string;
    intent: KnowledgeIntent;
    audience: KnowledgeAudience;
    language: string;
    stale: boolean;
  }>,
) {
  return request<KnowledgeItem>(session, `/api/knowledge/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteKnowledgeItem(session: Session, itemId: string) {
  return request<{ ok: boolean }>(session, `/api/knowledge/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

export async function patchKnowledgeOutput(
  session: Session,
  itemId: string,
  kind: "document" | "diagram",
  patch: Partial<{ currentBody: string; proposedBody: string; sourcesText: string }>,
) {
  return request<KnowledgeItem>(
    session,
    `/api/knowledge/${encodeURIComponent(itemId)}/${kind}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

export async function approveKnowledgeOutput(
  session: Session,
  itemId: string,
  kind: "document" | "diagram",
) {
  return request<KnowledgeItem>(
    session,
    `/api/knowledge/${encodeURIComponent(itemId)}/${kind}/approve`,
    { method: "POST" },
  );
}

export async function proposeKnowledgeOutput(
  session: Session,
  itemId: string,
  kind: "document" | "diagram",
) {
  return request<KnowledgeItem>(
    session,
    `/api/knowledge/${encodeURIComponent(itemId)}/${kind}/propose`,
    { method: "POST" },
  );
}

export async function fetchAppSettings(session: Session) {
  return request<{ settings: AppSettings; languages: TargetLanguage[] }>(session, "/api/settings");
}

export type ClockSchedule = {
  id: string;
  slug: string;
  title: string;
  cron: string;
  eventType: string;
  builtin: boolean;
  enabled: boolean;
  createdAt: number;
};

export async function fetchClockSchedules(session: Session) {
  return request<{ schedules: ClockSchedule[] }>(session, "/api/clock-schedules");
}

export async function createClockSchedule(
  session: Session,
  input: { title: string; cron: string },
) {
  return request<ClockSchedule>(session, "/api/clock-schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function patchClockSchedule(
  session: Session,
  scheduleId: string,
  input: { title?: string; cron?: string; enabled?: boolean },
) {
  return request<ClockSchedule>(
    session,
    `/api/clock-schedules/${encodeURIComponent(scheduleId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function deleteClockSchedule(session: Session, scheduleId: string) {
  return request<null>(session, `/api/clock-schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  });
}

export async function saveAppSettings(session: Session, settings: AppSettings) {
  return request<{ settings: AppSettings; languages: TargetLanguage[] }>(session, "/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function fetchOllamaModels(session: Session) {
  return request<{ models: string[]; reachable: boolean; error?: string }>(
    session,
    "/api/settings/ollama/models",
  );
}

export async function fetchTtsVoices(session: Session, engine: "edge" | "qwen") {
  const query = new URLSearchParams({ engine });
  return request<{ engine: "edge" | "qwen"; voices: TtsVoiceOption[] }>(
    session,
    `/api/settings/voices?${query.toString()}`,
  );
}

export type SpeakSource = "ui" | "mcp" | "note";
export type SpeakStatus = "queued" | "ready" | "played" | "failed";

export type SpeakUtterance = {
  id: string;
  projectId: string;
  text: string;
  source: SpeakSource;
  status: SpeakStatus;
  error: string;
  createdAt: number;
  createdBy: string;
};

export async function createSpeakUtterance(
  session: Session,
  projectId: string,
  text: string,
  source: SpeakSource,
): Promise<SpeakUtterance> {
  return request<SpeakUtterance>(session, "/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, text, source }),
  });
}

export async function fetchSpeakUtterance(session: Session, utteranceId: string) {
  const id = utteranceId.trim();
  if (id.length === 0) {
    throw new ApiError("not found", 404);
  }
  return request<SpeakUtterance>(
    session,
    `/api/speak/${encodeURIComponent(id)}`,
  );
}

export async function fetchSpeakUtterances(session: Session, projectId: string) {
  const query = new URLSearchParams({ projectId });
  return request<{ utterances: SpeakUtterance[] }>(
    session,
    `/api/speak?${query.toString()}`,
  );
}

export async function fetchSpeakPlayable(session: Session, projectId: string) {
  const query = new URLSearchParams({ projectId, playable: "1" });
  return request<{ utterances: SpeakUtterance[] }>(
    session,
    `/api/speak?${query.toString()}`,
  );
}

export async function markSpeakPlayed(session: Session, utteranceId: string) {
  return request<SpeakUtterance>(
    session,
    `/api/speak/${encodeURIComponent(utteranceId)}/played`,
    { method: "POST" },
  );
}

export async function fetchSpeakAudio(session: Session, utteranceId: string): Promise<Blob> {
  const res = await fetch(`/api/speak/${encodeURIComponent(utteranceId)}/audio`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: "audio/mpeg, application/json",
    },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    let message = "Speech failed";
    if (typeof payload.error === "string" && payload.error.length > 0) {
      message = payload.error;
    }
    throw new ApiError(message, res.status);
  }
  return res.blob();
}

export async function fetchSpeakPreview(session: Session, settings: AppSettings): Promise<Blob> {
  const res = await fetch("/api/settings/speak-preview", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    let message = "Speech failed";
    if (typeof payload.error === "string" && payload.error.length > 0) {
      message = payload.error;
    }
    throw new ApiError(message, res.status);
  }
  return res.blob();
}

export type InboxItem = {
  taskId: number;
  title: string;
  preview: string | null;
  status: string;
  parentId: number | null;
  activityAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  projectId: string | null;
  projectName: string | null;
  assignee: string | null;
  stageId: string | null;
  stageTitle: string | null;
  commentCount: number;
};

export type AssigneeKind = "ai" | "";

export type StageTaskTemplate = {
  id: string;
  title: string;
  description: string;
  assigneeRole: string | null;
  dependsOn: string[];
  children: StageTaskTemplate[];
};

export type WorkflowStage = {
  id: string;
  title: string;
  description: string;
  position: number;
  autoAssignRole: string | null;
  layoutX: number | null;
  layoutY: number | null;
  spawnTaskCount: number;
  taskTemplates: StageTaskTemplate[];
  activeTaskCount: number | null;
};

export type ProjectMember = {
  id: string;
  projectId: string;
  name: string;
  role: string;
  openTasks: number;
};

export type ProjectWorkflow = {
  projectId: string;
  roles: string[];
  stages: WorkflowStage[];
  members: ProjectMember[];
};

export type TaskStageSnapshot = {
  id: string;
  title: string;
  description: string;
  taskTemplates: StageTaskTemplate[];
};

export type InboxResult = {
  items: InboxItem[];
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type InboxQuery = {
  projectId: string | null;
  commentsOnly: boolean | null;
  epicsOnly: boolean | null;
  cursor: string | null;
  limit: number | null;
};

export type WorkStatus = "todo" | "in_progress" | "done";

export type TaskSubtask = {
  taskId: number;
  parentId: number | null;
  title: string;
  stageId: string | null;
  stageTitle: string | null;
  templateId: string | null;
  assignee: string | null;
  assigneeKind: AssigneeKind | null;
  claimedBy: string | null;
  workStatus: WorkStatus | null;
  workStatusLabel: string | null;
  done: boolean;
};

export type TaskComment = {
  id: string;
  role: "user" | "system";
  authorId: string;
  tags: string[];
  body: string;
  at: string;
  metadata: Record<string, string | number | boolean | null> | null;
  by: string;
  text: string;
};

export type WorkflowStateNode = {
  templateId: string;
  stageId: string;
  parentTemplateId: string | null;
  title: string;
  taskId: number | null;
  workStatus: WorkStatus;
  workStatusLabel: string;
  commentCount: number;
};

export type TaskDetail = {
  taskId: number;
  title: string;
  request: string;
  description: string;
  status: string;
  parentId: number | null;
  parent: { taskId: number; title: string; stageId: string | null } | null;
  subtasks: TaskSubtask[];
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string | null;
  projectId: string | null;
  projectName: string | null;
  assignee: string | null;
  stageId: string | null;
  stage: TaskStageSnapshot | null;
  isEpic: boolean | null;
  workStatus: WorkStatus | null;
  workStatusLabel: string | null;
  comments: TaskComment[];
  libraryLinks: LibraryDocumentLink[];
  workflowState: WorkflowStateNode[];
};

export type LibrarySummary = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  documentCount: number;
};

export type LibraryDocumentSummary = {
  id: string;
  libraryId: string;
  title: string;
  description: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  extension: string;
  updatedAt: string;
  hasFile: boolean;
};

export type LibraryDetail = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  documents: LibraryDocumentSummary[];
};

export type LibraryDocument = LibraryDocumentSummary & {
  libraryTitle: string;
  projectId: string;
  linkCount: number;
};

export type LibraryDocumentLink = {
  documentId: string;
  documentTitle: string;
  libraryId: string;
  libraryTitle: string;
  taskId: number;
  linkedAt: string;
};

export type LibrarySyncItem = {
  id: string;
  projectId: string;
  libraryId: string;
  libraryTitle: string;
  title: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  extension: string;
  updatedAt: string;
};

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isSystemAdmin: boolean;
  createdAt: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function authHeaders(session: Session): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${session.token}`,
  };
}

async function parseError(response: Response) {
  try {
    const body = (await response.json()) as {
      error: string | null;
      details: { code: string | null } | null;
    };
    const details = body.details;
    if (details !== null && details.code === "PASSWORD_CHANGE_REQUIRED") {
      return "PASSWORD_CHANGE_REQUIRED";
    }
    if (body.error) return body.error;
  } catch {
    return response.statusText || "Request failed";
  }
  return response.statusText || "Request failed";
}

async function request<T>(
  session: Session,
  path: string,
  init: RequestInit | null = null,
): Promise<T> {
  let extraHeaders: HeadersInit = {};
  if (init !== null) {
    const headerValue = init.headers;
    if (typeof headerValue !== "undefined" && headerValue !== null) {
      extraHeaders = headerValue;
    }
  }
  let fetchInit: RequestInit = {};
  if (init !== null) {
    fetchInit = init;
  }
  const headers = Object.assign({}, authHeaders(session), extraHeaders);
  const response = await fetch(path, Object.assign({}, fetchInit, { headers }));

  if (response.status === 401) {
    throw new ApiError("Unauthorized", 401);
  }

  if (!response.ok) {
    const message = await parseError(response);
    if (message === "PASSWORD_CHANGE_REQUIRED") {
      const current = loadSession();
      if (current) {
        saveSession(Object.assign({}, current, { mustChangePassword: true }));
      }
      window.location.href = "/app/change-password";
      throw new ApiError("Password change required", 403);
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) {
    return null as T;
  }
  const text = await response.text();
  if (!text) {
    return null as T;
  }
  return JSON.parse(text) as T;
}

export async function checkAuthStatus(): Promise<{ hasUsers: boolean; mode?: string }> {
  const response = await fetch("/api/auth/status");
  if (!response.ok) throw new ApiError("Failed to check status", response.status);
  return response.json() as Promise<{ hasUsers: boolean; mode?: string }>;
}

export async function fetchAuthMe(token: string): Promise<{
  id: string;
  name: string;
  email: string;
  role: string;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
}> {
  const response = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new ApiError("Failed to load user", response.status);
  return response.json() as Promise<{
    id: string;
    name: string;
    email: string;
    role: string;
    isSystemAdmin: boolean;
    mustChangePassword: boolean;
  }>;
}

export async function setupAdmin(params: { name: string; email: string; password: string }) {
  const response = await fetch("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    let message = "Setup failed";
    if (typeof body.error === "string" && body.error.length > 0) {
      message = body.error;
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<Record<string, never>>;
}

export async function loginUser(params: {
  email: string;
  password: string;
}): Promise<{
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    isSystemAdmin: boolean;
    mustChangePassword: boolean;
  };
}> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    let message = "Login failed";
    if (typeof body.error === "string" && body.error.length > 0) {
      message = body.error;
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<{
    token: string;
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      isSystemAdmin: boolean;
      mustChangePassword: boolean;
    };
  }>;
}

export async function changePassword(
  session: Session,
  params: { currentPassword: string; newPassword: string },
): Promise<{ user: { mustChangePassword: boolean } }> {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error: string | null };
    let message = "Password change failed";
    if (body.error !== null) {
      message = body.error;
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<{ user: { mustChangePassword: boolean } }>;
}

export function buildMobileQrData(session: Session): string {
  let server = "";
  if (typeof window !== "undefined") {
    server = window.location.origin;
  }
  return `taskbridge://auth?server=${encodeURIComponent(server)}&token=${encodeURIComponent(session.token)}`;
}

export async function fetchUsers(session: Session): Promise<PublicUser[]> {
  const data = await request<{ users: PublicUser[] }>(session, "/api/admin/users");
  if (data.users !== null) {
    return data.users;
  }
  return [];
}

export async function createAppUser(
  session: Session,
  params: { name: string; email: string; password: string; role?: string },
): Promise<PublicUser> {
  const data = await request<{ user: PublicUser }>(session, "/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      password: params.password,
    }),
  });
  return data.user;
}

export async function updateAppUser(
  session: Session,
  userId: string,
  params: { name: string | null; role: string | null },
): Promise<PublicUser> {
  const data = await request<{ user: PublicUser }>(session, `/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return data.user;
}

export async function deleteAppUser(session: Session, userId: string): Promise<void> {
  await request<void>(session, `/api/admin/users/${userId}`, { method: "DELETE" });
}

export async function fetchProjects(session: Session) {
  const data = await request<{ projects: Project[] }>(session, "/api/projects");
  if (data.projects === null) {
    return [];
  }
  return data.projects.map((project) => {
    let repoPath = "";
    if (typeof project.repoPath === "string") {
      repoPath = project.repoPath;
    }
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      workflowTemplateId: project.workflowTemplateId,
      repoPath,
    };
  });
}

export type WorkflowTemplateSummary = {
  id: string;
  title: string;
  description: string;
};

export type WorkflowTemplate = WorkflowTemplateSummary & {
  stages: WorkflowStage[];
};

export async function createProject(session: Session, input: CreateProjectInput) {
  return request<Project>(session, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      description: input.description.trim(),
      workflowTemplateId: input.workflowTemplateId.trim() || DEFAULT_WORKFLOW_TEMPLATE_ID,
      repoPath: input.repoPath.trim(),
    }),
  });
}

export async function updateProject(session: Session, projectId: string, input: UpdateProjectInput) {
  return request<Project>(session, `/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function pickProjectFolder(session: Session) {
  return request<{ path: string }>(session, "/api/folder/pick", {
    method: "POST",
  });
}

export async function fetchWorkflowTemplates(session: Session) {
  const data = await request<{ items: WorkflowTemplateSummary[] }>(
    session,
    "/api/workflow-templates",
  );
  if (data.items !== null) {
    return data.items;
  }
  return [];
}

export async function fetchWorkflowTemplate(session: Session, templateId: string) {
  return request<WorkflowTemplate>(session, `/api/workflow-templates/${templateId}`);
}

export async function createWorkflowTemplate(
  session: Session,
  input: { title: string; id: string; description: string },
) {
  return request<WorkflowTemplate>(session, "/api/workflow-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function saveWorkflowTemplate(
  session: Session,
  templateId: string,
  stages: WorkflowStage[],
) {
  return request<WorkflowTemplate>(session, `/api/workflow-templates/${templateId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stages }),
  });
}

export async function deleteWorkflowTemplate(session: Session, templateId: string) {
  await request<void>(session, `/api/workflow-templates/${templateId}`, {
    method: "DELETE",
  });
}

export const PROTECTED_WORKFLOW_TEMPLATE_IDS = new Set(["plan-build-deliver"]);

export async function exportWorkflowTemplate(session: Session, templateId: string): Promise<void> {
  const res = await fetch(`/api/workflow-templates/${templateId}/export`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!res.ok) throw new ApiError("Export failed", res.status);
  const blob = await res.blob();
  const dispositionHeader = res.headers.get("Content-Disposition");
  let disposition = "";
  if (dispositionHeader !== null) {
    disposition = dispositionHeader;
  }
  const match = /filename="([^"]+)"/.exec(disposition);
  let filename = `${templateId}.json`;
  if (match !== null && match.length > 1) {
    const captured = match[1];
    if (typeof captured === "string") {
      filename = captured;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type WorkflowExport = {
  projectId: string;
  roles: string[];
  stages: WorkflowStage[];
  members: ProjectMember[];
};

export async function importWorkflowTemplate(session: Session, data: WorkflowTemplate): Promise<WorkflowTemplate> {
  return request<WorkflowTemplate>(session, "/api/workflow-templates/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function applyWorkflowTemplate(
  session: Session,
  projectId: string,
  templateId: string,
) {
  return request<ProjectWorkflow>(
    session,
    `/api/projects/${projectId}/workflow/apply-template`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    },
  );
}

export type CreateEpicInput = {
  projectId: string;
  title: string;
  description: string | null;
};

export type CreateTaskInput = {
  parentId: number;
  title: string;
  description: string | null;
  stageId: string | null;
};

export async function createEpic(session: Session, input: CreateEpicInput) {
  let description = "";
  if (input.description !== null) {
    description = input.description;
  }
  return request<{
    id: string | number;
    title: string | null;
    projectName: string | null;
    parentId: number | null;
  }>(
    session,
    "/api/epics",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: input.projectId,
        title: input.title,
        description,
      }),
    },
  );
}

export async function createTask(session: Session, input: CreateTaskInput) {
  let description = "";
  if (input.description !== null) {
    description = input.description;
  }
  return request<{
    id: string | number;
    title: string | null;
    projectName: string | null;
    parentId: number | null;
  }>(
    session,
    "/api/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId: input.parentId,
        title: input.title,
        description,
        stageId: input.stageId,
      }),
    },
  );
}

export async function fetchInbox(session: Session, query: InboxQuery = {
  projectId: null,
  commentsOnly: null,
  epicsOnly: null,
  cursor: null,
  limit: null,
}) {
  const params = new URLSearchParams();
  if (query.projectId) params.set("projectId", query.projectId);
  if (query.commentsOnly) params.set("commentsOnly", "true");
  if (query.epicsOnly) params.set("epicsOnly", "true");
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  let suffix = "";
  if (params.toString()) {
    suffix = `?${params.toString()}`;
  }
  return request<InboxResult>(session, `/api/inbox${suffix}`);
}

export async function fetchAllInbox(
  session: Session,
  query: Omit<InboxQuery, "cursor"> = {
    projectId: null,
    commentsOnly: null,
    epicsOnly: null,
    limit: null,
  },
) {
  const items: InboxItem[] = [];
  let cursor: string | null = null;
  do {
    let pageLimit = 100;
    if (query.limit !== null) {
      pageLimit = query.limit;
    }
    const page = await fetchInbox(session, Object.assign({}, query, { cursor, limit: pageLimit }));
    for (const item of page.items) {
      items.push(item);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export async function fetchTask(session: Session, taskId: number) {
  return request<TaskDetail>(session, `/api/tasks/${taskId}`);
}

export async function addTaskComment(session: Session, taskId: number, text: string) {
  return request<TaskDetail>(session, `/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment: { text, by: "web" } }),
  });
}

export async function updateTaskDescription(session: Session, taskId: number, description: string) {
  return request<TaskDetail>(session, `/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
}

export async function fetchProjectWorkflow(session: Session, projectId: string) {
  return request<ProjectWorkflow>(session, `/api/projects/${projectId}/workflow`);
}

export async function saveProjectWorkflow(
  session: Session,
  projectId: string,
  input: { stages: WorkflowStage[]; roles: string[] },
) {
  return request<ProjectWorkflow>(session, `/api/projects/${projectId}/workflow`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function exportProjectWorkflow(session: Session, projectId: string) {
  return request<WorkflowExport>(session, `/api/projects/${projectId}/workflow/export`);
}

export async function createMember(
  session: Session,
  projectId: string,
  input: { name: string; role: string },
) {
  return request<ProjectMember>(session, `/api/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      role: input.role,
    }),
  });
}

export async function updateMember(
  session: Session,
  projectId: string,
  memberId: string,
  input: { name: string | null; role: string | null },
) {
  return request<ProjectMember>(session, `/api/projects/${projectId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteMember(session: Session, projectId: string, memberId: string) {
  await request<void>(session, `/api/projects/${projectId}/members/${memberId}`, {
    method: "DELETE",
  });
}

export async function fetchLibraries(session: Session, projectId: string) {
  const data = await request<{ items: LibrarySummary[] }>(
    session,
    `/api/projects/${projectId}/libraries`,
  );
  if (data.items !== null) {
    return data.items;
  }
  return [];
}

export async function fetchLibrary(session: Session, projectId: string, libraryId: string) {
  return request<LibraryDetail>(session, `/api/projects/${projectId}/libraries/${libraryId}`);
}

export async function createLibrary(
  session: Session,
  projectId: string,
  input: { title: string; id: string; description: string },
) {
  return request<LibraryDetail>(session, `/api/projects/${projectId}/libraries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function saveLibrary(
  session: Session,
  projectId: string,
  libraryId: string,
  input: { title: string; description: string },
) {
  return request<LibraryDetail>(session, `/api/projects/${projectId}/libraries/${libraryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteLibrary(session: Session, projectId: string, libraryId: string) {
  await request<void>(session, `/api/projects/${projectId}/libraries/${libraryId}`, {
    method: "DELETE",
  });
}

export async function uploadLibraryDocument(
  session: Session,
  projectId: string,
  libraryId: string,
  file: File,
  title = "",
) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (title.trim() !== "") form.append("title", title.trim());
  return request<LibraryDocument>(
    session,
    `/api/projects/${projectId}/libraries/${libraryId}/documents/upload`,
    {
      method: "POST",
      body: form,
    },
  );
}

export async function replaceLibraryDocument(
  session: Session,
  projectId: string,
  libraryId: string,
  documentId: string,
  file: File,
) {
  const form = new FormData();
  form.append("file", file, file.name);
  return request<LibraryDocument>(
    session,
    `/api/projects/${projectId}/libraries/${libraryId}/documents/${documentId}/upload`,
    {
      method: "POST",
      body: form,
    },
  );
}

export async function fetchLibraryDocument(session: Session, documentId: string) {
  return request<LibraryDocument>(session, `/api/library-documents/${documentId}`);
}

export async function renameLibraryDocument(
  session: Session,
  projectId: string,
  libraryId: string,
  documentId: string,
  title: string,
) {
  return request<LibraryDocument>(
    session,
    `/api/projects/${projectId}/libraries/${libraryId}/documents/${documentId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
}

export async function deleteLibraryDocument(
  session: Session,
  projectId: string,
  libraryId: string,
  documentId: string,
) {
  await request<void>(
    session,
    `/api/projects/${projectId}/libraries/${libraryId}/documents/${documentId}`,
    {
      method: "DELETE",
    },
  );
}

export async function fetchLibrarySync(session: Session, projectId: string, libraryId = "") {
  const query = libraryId !== "" ? `?libraryId=${encodeURIComponent(libraryId)}` : "";
  const data = await request<{ items: LibrarySyncItem[] }>(
    session,
    `/api/projects/${projectId}/library/sync${query}`,
  );
  if (data.items !== null) return data.items;
  return [];
}

export async function downloadLibraryDocument(session: Session, documentId: string): Promise<Blob> {
  const res = await fetch(`/api/library-documents/${documentId}/content`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!res.ok) throw new ApiError("Download failed", res.status);
  return res.blob();
}

export async function linkLibraryDocument(
  session: Session,
  documentId: string,
  taskId: number,
) {
  const data = await request<{ items: LibraryDocumentLink[] }>(
    session,
    `/api/library-documents/${documentId}/links`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    },
  );
  if (data.items !== null) {
    return data.items;
  }
  return [];
}

export async function unlinkLibraryDocument(
  session: Session,
  documentId: string,
  taskId: number,
) {
  await request<void>(session, `/api/library-documents/${documentId}/links/${taskId}`, {
    method: "DELETE",
  });
}

export async function fetchTaskLibraryLinks(session: Session, taskId: number) {
  const data = await request<{ items: LibraryDocumentLink[] }>(
    session,
    `/api/tasks/${taskId}/library-links`,
  );
  if (data.items !== null) {
    return data.items;
  }
  return [];
}

export async function claimTask(session: Session, taskId: number, claimedBy: string) {
  return request<{ id: number; claimedBy: string | null }>(session, `/api/tasks/${taskId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimedBy }),
  });
}

export async function updateTaskWorkStatus(
  session: Session,
  taskId: number,
  workStatus: WorkStatus,
  claimedBy: string | null = null,
) {
  const body: { workStatus: WorkStatus; claimedBy?: string } = { workStatus };
  if (claimedBy !== null && claimedBy.trim() !== "") {
    body.claimedBy = claimedBy.trim();
  }
  return request<TaskDetail>(session, `/api/tasks/${taskId}/work-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type MarketplaceListingSummary = {
  id: string;
  sellerUserId: string;
  sellerName: string;
  sourceTemplateId: string;
  title: string;
  description: string;
  category: string;
  priceCents: number;
  stageCount: number;
  owned: boolean;
  isOwnListing: boolean;
  purchasedTemplateId: string | null;
  publishedAt: string | null;
};

export type MarketplaceListingDetail = MarketplaceListingSummary & {
  stages: WorkflowStage[];
};

export async function fetchMarketplaceListings(session: Session) {
  const data = await request<{ items: MarketplaceListingSummary[] }>(
    session,
    "/api/marketplace/listings",
  );
  if (data.items !== null) return data.items;
  return [];
}

export async function fetchMyMarketplaceListings(session: Session) {
  const data = await request<{ items: MarketplaceListingSummary[] }>(
    session,
    "/api/marketplace/my-listings",
  );
  if (data.items !== null) return data.items;
  return [];
}

export async function updateMarketplaceListing(
  session: Session,
  listingId: string,
  input: {
    title: string;
    description: string;
    category: string;
    priceCents: number;
  },
) {
  const data = await request<{ listing: MarketplaceListingSummary }>(
    session,
    `/api/marketplace/listings/${listingId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return data.listing;
}

export async function unlistMarketplaceListing(session: Session, listingId: string) {
  await request<void>(session, `/api/marketplace/listings/${listingId}`, {
    method: "DELETE",
  });
}

export async function fetchMarketplacePurchases(session: Session) {
  const data = await request<{
    items: Array<{
      id: string;
      listingId: string;
      amountCents: number;
      purchasedTemplateId: string;
      createdAt: string;
      listingTitle: string;
      sellerName: string;
    }>;
  }>(session, "/api/marketplace/purchases");
  if (data.items !== null) return data.items;
  return [];
}

export async function fetchMarketplaceSales(session: Session) {
  const data = await request<{
    items: Array<{
      id: string;
      listingId: string;
      listingTitle: string;
      buyerName: string;
      amountCents: number;
      createdAt: string;
    }>;
  }>(session, "/api/marketplace/sales");
  if (data.items !== null) return data.items;
  return [];
}

export async function fetchMarketplaceListing(session: Session, listingId: string) {
  const data = await request<{ listing: MarketplaceListingDetail | null }>(
    session,
    `/api/marketplace/listings/${listingId}`,
  );
  return data.listing;
}

export async function publishMarketplaceListing(
  session: Session,
  input: {
    sourceTemplateId: string;
    title: string;
    description: string;
    category: string;
    priceCents: number;
  },
) {
  const data = await request<{ listing: MarketplaceListingSummary }>(
    session,
    "/api/marketplace/listings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return data.listing;
}

export async function purchaseMarketplaceListing(session: Session, listingId: string) {
  return request<{ purchasedTemplateId: string; listing: MarketplaceListingSummary }>(
    session,
    `/api/marketplace/listings/${listingId}/purchase`,
    { method: "POST" },
  );
}

export async function fetchPublishableTemplates(session: Session) {
  const data = await request<{ items: WorkflowTemplateSummary[] }>(
    session,
    "/api/marketplace/publishable-templates",
  );
  if (data.items !== null) return data.items;
  return [];
}

export type ApiKeySummary = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function fetchApiKeys(session: Session) {
  const data = await request<{ items: ApiKeySummary[] }>(session, "/api/me/api-keys");
  if (data.items !== null) return data.items;
  return [];
}

export async function createApiKey(session: Session, name: string) {
  return request<{ key: ApiKeySummary; rawKey: string }>(session, "/api/me/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function revokeApiKey(session: Session, keyId: string) {
  await request<void>(session, `/api/me/api-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
  });
}
