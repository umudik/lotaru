import { z } from "zod";
import { SCRIPT_SEEDS, TASK_SEEDS } from "./marketplace-work-seeds.js";

export const MARKETPLACE_KIND_IDS = ["document", "diagram", "script", "task"] as const;

export type MarketplaceKind = (typeof MARKETPLACE_KIND_IDS)[number];

export const MARKETPLACE_CATEGORY_IDS = [
  "architecture",
  "api",
  "data",
  "security",
  "operations",
  "delivery",
  "quality",
  "process",
  "frontend",
  "backend",
] as const;

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORY_IDS)[number];

export const MARKETPLACE_CATEGORIES: readonly { id: MarketplaceCategory; label: string }[] = [
  { id: "architecture", label: "Architecture" },
  { id: "api", label: "API" },
  { id: "data", label: "Data" },
  { id: "security", label: "Security" },
  { id: "operations", label: "Operations" },
  { id: "delivery", label: "Delivery" },
  { id: "quality", label: "Quality" },
  { id: "process", label: "Process" },
  { id: "frontend", label: "Frontend" },
  { id: "backend", label: "Backend" },
];

export type MarketplaceTaskNode = {
  id: string;
  title: string;
  description: string;
  children: readonly MarketplaceTaskNode[];
};

export type MarketplaceCatalogItem = {
  id: string;
  kind: MarketplaceKind;
  category: MarketplaceCategory;
  title: string;
  summary: string;
  source: string;
  description: string;
  command: string;
  triggerType: string;
  triggerGlob: string;
  triggerBusEvent: string;
  concurrency: string;
  stageTitle: string;
  stageRules: readonly string[];
  taskNodes: readonly MarketplaceTaskNode[];
};

export type CatalogSeed = {
  id: string;
  kind: MarketplaceKind;
  category: MarketplaceCategory;
  title: string;
  summary: string;
  source: string;
  sections: readonly string[];
  command: string;
  triggerType: string;
  triggerGlob: string;
  triggerBusEvent: string;
  concurrency: string;
  stageTitle: string;
  stageRules: readonly string[];
  taskNodes: readonly MarketplaceTaskNode[];
};

function emptyWorkFields(): {
  command: string;
  triggerType: string;
  triggerGlob: string;
  triggerBusEvent: string;
  concurrency: string;
  stageTitle: string;
  stageRules: readonly string[];
  taskNodes: readonly MarketplaceTaskNode[];
} {
  return {
    command: "",
    triggerType: "",
    triggerGlob: "",
    triggerBusEvent: "",
    concurrency: "",
    stageTitle: "",
    stageRules: [],
    taskNodes: [],
  };
}

const catalogIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const categorySchema = z.enum(MARKETPLACE_CATEGORY_IDS);
const kindSchema = z.enum(MARKETPLACE_KIND_IDS);

function joinSections(sections: readonly string[]): string {
  const lines: string[] = [];
  let index = 1;
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length === 0) {
      throw new Error("catalog section empty");
    }
    lines.push(`${String(index)}. ${trimmed}`);
    index += 1;
  }
  return lines.join("\n");
}

function compileDocument(seed: CatalogSeed): string {
  const outline = joinSections(seed.sections);
  const lines: string[] = [];
  lines.push(`Write this ${seed.title} for this software repository.`);
  lines.push(`Follow ${seed.source}.`);
  lines.push("Use only services, files, types, APIs, and names that exist in this repo and the trigger event.");
  lines.push("If evidence is missing, write Unknown and what to inspect. Never invent systems, metrics, or owners.");
  lines.push("Audience is software engineers. Be precise. Prefer lists and tables over slogans.");
  lines.push("Required sections, in this order:");
  lines.push(outline);
  lines.push("Output markdown only. No preamble, no apology, no invented appendix.");
  return lines.join("\n");
}

function compileDiagram(seed: CatalogSeed): string {
  const outline = joinSections(seed.sections);
  const lines: string[] = [];
  lines.push(`Draw this ${seed.title} for this software repository.`);
  lines.push(`Follow ${seed.source}.`);
  lines.push("Nodes, edges, and labels must be real names from this repo and the trigger event.");
  lines.push("If a part of the picture is unknown, omit it and list it under Unknown. Never invent services.");
  lines.push("Prefer one fenced Mermaid block. If Mermaid cannot express the view, use a structured markdown diagram.");
  lines.push("After the diagram, a short legend mapping each symbol to a real name.");
  lines.push("Required content:");
  lines.push(outline);
  lines.push("Output markdown only. No clip-art, no fictional architecture.");
  return lines.join("\n");
}

type KnowledgeSeedLite = {
  id: string;
  kind: "document" | "diagram";
  category: MarketplaceCategory;
  title: string;
  summary: string;
  source: string;
  sections: readonly string[];
};

function knowledgeToSeed(seed: KnowledgeSeedLite): CatalogSeed {
  const work = emptyWorkFields();
  return {
    id: seed.id,
    kind: seed.kind,
    category: seed.category,
    title: seed.title,
    summary: seed.summary,
    source: seed.source,
    sections: seed.sections,
    command: work.command,
    triggerType: work.triggerType,
    triggerGlob: work.triggerGlob,
    triggerBusEvent: work.triggerBusEvent,
    concurrency: work.concurrency,
    stageTitle: work.stageTitle,
    stageRules: work.stageRules,
    taskNodes: work.taskNodes,
  };
}

function compileScript(seed: CatalogSeed): string {
  const outline = joinSections(seed.sections);
  const lines: string[] = [];
  lines.push(`Install this ${seed.title} as a host shell script.`);
  lines.push(`Follow ${seed.source}.`);
  lines.push(`Command: ${seed.command}`);
  lines.push("Trigger is manual. Enable it in Scripts only after the command matches this repo.");
  lines.push("If the package script or binary is missing, the run fails closed. Do not invent flags.");
  lines.push("What it is for:");
  lines.push(outline);
  return lines.join("\n");
}

function compileTask(seed: CatalogSeed): string {
  const outline = joinSections(seed.sections);
  const lines: string[] = [];
  lines.push(`Install this ${seed.title} as a pipeline stage.`);
  lines.push(`Follow ${seed.source}.`);
  lines.push(`Stage: ${seed.stageTitle}`);
  lines.push("New epics that enter this stage spawn the listed tasks. Do not invent extra work.");
  lines.push("Task outline:");
  lines.push(outline);
  return lines.join("\n");
}

function descriptionFor(seed: CatalogSeed): string {
  if (seed.kind === "script") {
    return compileScript(seed);
  }
  if (seed.kind === "task") {
    return compileTask(seed);
  }
  if (seed.kind === "diagram") {
    return compileDiagram(seed);
  }
  return compileDocument(seed);
}

function compileSeed(seed: CatalogSeed): MarketplaceCatalogItem {
  const idParsed = catalogIdSchema.safeParse(seed.id);
  if (idParsed.success !== true) {
    throw new Error(`invalid catalog id ${seed.id}`);
  }
  const kindParsed = kindSchema.safeParse(seed.kind);
  if (kindParsed.success !== true) {
    throw new Error(`invalid catalog kind ${seed.id}`);
  }
  const categoryParsed = categorySchema.safeParse(seed.category);
  if (categoryParsed.success !== true) {
    throw new Error(`invalid catalog category ${seed.id}`);
  }
  if (seed.sections.length < 4) {
    throw new Error(`catalog ${seed.id} needs at least four sections`);
  }
  if (seed.kind === "script") {
    if (seed.command.trim().length === 0) {
      throw new Error(`catalog ${seed.id} needs a command`);
    }
  }
  if (seed.kind === "task") {
    if (seed.stageTitle.trim().length === 0) {
      throw new Error(`catalog ${seed.id} needs a stage title`);
    }
    if (seed.taskNodes.length === 0) {
      throw new Error(`catalog ${seed.id} needs tasks`);
    }
  }
  return {
    id: seed.id,
    kind: seed.kind,
    category: seed.category,
    title: seed.title.trim(),
    summary: seed.summary.trim(),
    source: seed.source.trim(),
    description: descriptionFor(seed),
    command: seed.command,
    triggerType: seed.triggerType,
    triggerGlob: seed.triggerGlob,
    triggerBusEvent: seed.triggerBusEvent,
    concurrency: seed.concurrency,
    stageTitle: seed.stageTitle,
    stageRules: seed.stageRules,
    taskNodes: seed.taskNodes,
  };
}

const DOCUMENT_SEEDS: readonly KnowledgeSeedLite[] = [
  { id: "doc-adr-madr", kind: "document", category: "architecture", title: "Architecture decision record (MADR)", summary: "Context, drivers, options, outcome, and consequences for one decision.", source: "MADR (adr.github.io/madr)", sections: ["Title and status", "Context and problem statement", "Decision drivers", "Considered options", "Decision outcome", "Consequences", "Confirmation", "More information"] },
  { id: "doc-adr-nygard", kind: "document", category: "architecture", title: "Architecture decision record (Nygard)", summary: "Short ADR: context, decision, and consequences.", source: "Michael Nygard ADR format", sections: ["Title and status", "Context", "Decision", "Consequences"] },
  { id: "doc-rfc-engineering", kind: "document", category: "architecture", title: "Engineering RFC", summary: "Proposal that asks for comments before a change lands.", source: "IETF RFC process adapted for product engineering (Rust/IETF practice)", sections: ["Abstract", "Motivation", "Guide-level explanation", "Reference-level design", "Drawbacks", "Rationale and alternatives", "Unresolved questions"] },
  { id: "doc-design-google", kind: "document", category: "architecture", title: "Technical design document", summary: "Google-style design doc: goals, design, data, rollout, and risks.", source: "Google / Uber engineering design doc pattern", sections: ["Context and goals", "Non-goals", "Proposed design", "Data model", "API and failure modes", "Cross-cutting concerns", "Milestones and rollout", "Risks and alternatives"] },
  { id: "doc-system-design", kind: "document", category: "architecture", title: "System design document", summary: "Structure, containers, and technology choices for the system.", source: "ISO/IEC/IEEE 42010 architecture description practice", sections: ["System context", "Containers and responsibilities", "Key workflows", "Technology stack", "Quality attributes", "Open decisions"] },
  { id: "doc-c4-narrative", kind: "document", category: "architecture", title: "C4 architecture narrative", summary: "Prose companion to C4 context, container, and component views.", source: "C4 model (Simon Brown, c4model.com)", sections: ["System context", "Containers", "Key components", "External systems", "Deployment notes", "What is out of scope"] },
  { id: "doc-hexagonal", kind: "document", category: "architecture", title: "Hexagonal architecture notes", summary: "Ports, adapters, and domain boundaries in this repo.", source: "Alistair Cockburn hexagonal / ports-and-adapters", sections: ["Domain core", "Inbound ports", "Outbound ports", "Adapters found in the repo", "Forbidden leaks", "Unknowns"] },
  { id: "doc-event-driven", kind: "document", category: "architecture", title: "Event-driven design", summary: "Events, producers, consumers, and delivery guarantees.", source: "Enterprise Integration Patterns / AsyncAPI thinking", sections: ["Event catalog", "Producers", "Consumers", "Ordering and idempotency", "Failure and retry", "Unknowns"] },
  { id: "doc-cqrs-saga", kind: "document", category: "architecture", title: "CQRS and saga notes", summary: "Command/query split and long-running consistency.", source: "CQRS and saga literature (Hohpe, Richardson)", sections: ["Commands vs queries", "Write model", "Read model", "Saga or process manager", "Failure compensation", "Unknowns"] },
  { id: "doc-bounded-context", kind: "document", category: "architecture", title: "Bounded context catalog", summary: "DDD contexts, ubiquitous language, and translations.", source: "Domain-Driven Design (Evans) context mapping", sections: ["Contexts in this repo", "Ubiquitous language", "Upstream/downstream", "Shared kernels", "Translation", "Unknowns"] },
  { id: "doc-nfr", kind: "document", category: "architecture", title: "Non-functional requirements", summary: "Measurable quality attributes for this system.", source: "ISO/IEC 25010 quality model", sections: ["Performance", "Reliability", "Security", "Operability", "Constraints", "How we will measure"] },
  { id: "doc-capacity", kind: "document", category: "architecture", title: "Capacity plan", summary: "Load assumptions, bottlenecks, and headroom.", source: "Google SRE capacity planning practice", sections: ["Demand assumptions", "Bottlenecks", "Headroom", "Scaling levers", "Risks", "Unknowns"] },
  { id: "doc-dr-plan", kind: "document", category: "architecture", title: "Disaster recovery plan", summary: "RPO/RTO, backups, and restore drills.", source: "NIST SP 800-34 contingency planning (engineering slice)", sections: ["Critical services", "RPO and RTO", "Backup method", "Restore steps", "Drill cadence", "Gaps"] },
  { id: "doc-deprecation", kind: "document", category: "architecture", title: "Deprecation plan", summary: "What is going away, who still uses it, and the cut date.", source: "IETF / public API deprecation practice", sections: ["What is deprecated", "Who still depends on it", "Replacement", "Timeline", "Telemetry to watch", "Rollback"] },
  { id: "doc-architecture-principles", kind: "document", category: "architecture", title: "Architecture principles", summary: "Hard rules this codebase is supposed to obey.", source: "TOGAF-style principles, written as engineering law", sections: ["Principle list", "Why each exists", "How we detect violations", "Known exceptions", "Unknowns"] },
  { id: "doc-integration-map", kind: "document", category: "architecture", title: "Integration map", summary: "Inbound and outbound integrations with owners and contracts.", source: "Enterprise Integration Patterns catalog", sections: ["Inbound", "Outbound", "Auth and secrets", "Failure modes", "Contracts", "Unknowns"] },
  { id: "doc-openapi-overview", kind: "document", category: "api", title: "OpenAPI overview", summary: "Human summary of the HTTP API this repo actually exposes.", source: "OpenAPI Specification 3", sections: ["Servers and auth", "Resource groups", "Idempotent writes", "Error envelope", "Versioning", "Unknowns"] },
  { id: "doc-rest-contract", kind: "document", category: "api", title: "REST API contract", summary: "Resources, verbs, status codes, and examples from the code.", source: "RFC 9110 HTTP semantics + OpenAPI", sections: ["Resources", "Methods and status codes", "Request/response bodies", "Pagination", "Auth", "Examples from the repo"] },
  { id: "doc-graphql-notes", kind: "document", category: "api", title: "GraphQL schema notes", summary: "Types, queries, mutations, and authz from the schema.", source: "GraphQL specification", sections: ["Types", "Queries", "Mutations", "Authz", "N+1 risks", "Unknowns"] },
  { id: "doc-grpc-contract", kind: "document", category: "api", title: "gRPC contract notes", summary: "Services, messages, and error codes from protobuf.", source: "gRPC / Protocol Buffers style guide", sections: ["Services", "Messages", "Streaming", "Status codes", "Compatibility", "Unknowns"] },
  { id: "doc-asyncapi", kind: "document", category: "api", title: "AsyncAPI event catalog", summary: "Channels, payloads, and delivery guarantees.", source: "AsyncAPI Specification", sections: ["Channels", "Publishers", "Subscribers", "Payload schemas", "Delivery", "Unknowns"] },
  { id: "doc-webhook-contract", kind: "document", category: "api", title: "Webhook contract", summary: "Callback URLs, signatures, retries, and event types.", source: "Standard webhook signing and retry practice", sections: ["Event types", "Payload", "Signature verification", "Retries", "Idempotency", "Unknowns"] },
  { id: "doc-error-catalog", kind: "document", category: "api", title: "API error catalog", summary: "Stable error codes and what callers should do.", source: "RFC 9457 Problem Details / API error catalogs", sections: ["Error envelope", "Code list", "HTTP mapping", "Retry guidance", "Examples", "Unknowns"] },
  { id: "doc-api-versioning", kind: "document", category: "api", title: "API versioning policy", summary: "How this API changes without stranding callers.", source: "Stripe / GitHub public API versioning practice", sections: ["Current versions", "Compatibility rules", "Sunset process", "Header or path scheme", "Unknowns"] },
  { id: "doc-auth-scheme", kind: "document", category: "api", title: "Authentication scheme", summary: "How callers prove identity on these APIs.", source: "OAuth 2.1 / OIDC / HTTP bearer practice", sections: ["Mechanisms in code", "Token lifetime", "Scopes", "Local vs cloud", "Failure modes", "Unknowns"] },
  { id: "doc-rate-limit", kind: "document", category: "api", title: "Rate limit policy", summary: "Limits, keys, and 429 behavior.", source: "IETF rate-limit headers draft practice", sections: ["What is limited", "Keys", "Budgets", "429 body", "Exemptions", "Unknowns"] },
  { id: "doc-idempotency", kind: "document", category: "api", title: "Idempotency guide", summary: "Which writes are safe to retry and how keys work.", source: "Stripe idempotency-key practice", sections: ["Safe methods", "Idempotency keys", "Storage", "Failure cases", "Unknowns"] },
  { id: "doc-pagination", kind: "document", category: "api", title: "Pagination and filtering", summary: "Cursor vs offset, sort, and filter rules from the code.", source: "JSON:API / GraphQL connection / Slack cursor practice", sections: ["List endpoints", "Cursor or offset", "Sort", "Filters", "Unknowns"] },
  { id: "doc-er-notes", kind: "document", category: "data", title: "Entity-relationship notes", summary: "Tables, keys, and relations as they exist in the schema.", source: "Chen / crow's-foot ER modeling", sections: ["Entities", "Keys", "Relations", "Invariants", "Unknowns"] },
  { id: "doc-data-dictionary", kind: "document", category: "data", title: "Data dictionary", summary: "Column-level meaning, types, and nullability.", source: "ISO 11179 metadata registry thinking, applied to this schema", sections: ["Tables", "Columns", "Units and enums", "PII flags", "Unknowns"] },
  { id: "doc-schema-migration", kind: "document", category: "data", title: "Schema migration plan", summary: "Expand/contract steps for a schema change.", source: "expand/contract database migration practice", sections: ["Current schema", "Target schema", "Expand steps", "Migrate data", "Contract steps", "Rollback"] },
  { id: "doc-cache-strategy", kind: "document", category: "data", title: "Cache strategy", summary: "What is cached, keys, TTL, and invalidation.", source: "cache-aside / write-through patterns", sections: ["Caches in the repo", "Keys", "TTL", "Invalidation", "Stampede risk", "Unknowns"] },
  { id: "doc-consistency", kind: "document", category: "data", title: "Consistency model", summary: "What is strongly consistent vs eventually consistent here.", source: "PACELC / distributed consistency notes", sections: ["Strong paths", "Eventual paths", "Conflicts", "User-visible lag", "Unknowns"] },
  { id: "doc-backup-restore", kind: "document", category: "data", title: "Backup and restore", summary: "What is backed up, how to restore, how to verify.", source: "SRE backup verification practice", sections: ["What is backed up", "Where", "Restore steps", "Verification", "Last successful drill", "Gaps"] },
  { id: "doc-etl-notes", kind: "document", category: "data", title: "ETL / ELT notes", summary: "Pipelines, freshness, and failure handling.", source: "data pipeline operational practice", sections: ["Pipelines", "Sources", "Transforms", "Freshness", "Failure handling", "Unknowns"] },
  { id: "doc-pii-inventory", kind: "document", category: "data", title: "PII inventory", summary: "Where personal data lives in this codebase and stores.", source: "GDPR inventory thinking for engineers, not legal advice", sections: ["Stores", "Fields", "Purpose", "Retention in code", "Access paths", "Unknowns"] },
  { id: "doc-threat-stride", kind: "document", category: "security", title: "STRIDE threat model", summary: "Spoofing, tampering, repudiation, info disclosure, DoS, elevation.", source: "Microsoft STRIDE", sections: ["Assets", "Trust boundaries", "STRIDE table", "Mitigations in code", "Unmitigated", "Unknowns"] },
  { id: "doc-security-review", kind: "document", category: "security", title: "Security review", summary: "Authn, authz, secrets, injection, and supply chain for this change.", source: "OWASP ASVS engineering review slice", sections: ["Authn", "Authz", "Secrets", "Injection", "Dependencies", "Findings"] },
  { id: "doc-authz-matrix", kind: "document", category: "security", title: "Authorization matrix", summary: "Who can call what, from the actual checks in code.", source: "RBAC / ReBAC engineering matrices", sections: ["Actors", "Resources", "Actions", "Checks in code", "Gaps"] },
  { id: "doc-secrets", kind: "document", category: "security", title: "Secrets handling", summary: "Where secrets enter, where they must not land.", source: "OWASP secrets management cheat sheet", sections: ["Secret sources", "In-memory handling", "Logs and traces", "Rotation", "Gaps"] },
  { id: "doc-cve-notes", kind: "document", category: "security", title: "Dependency and CVE notes", summary: "Direct deps, known holes, and upgrade plan.", source: "OpenSSF / GitHub Advisory practice", sections: ["Direct dependencies", "Known advisories", "Upgrade plan", "Exceptions", "Unknowns"] },
  { id: "doc-security-md", kind: "document", category: "security", title: "Security policy (engineering)", summary: "How to report issues and what this project actually supports.", source: "GitHub SECURITY.md convention", sections: ["Supported versions", "How to report", "What is in scope", "What is out of scope", "Response targets"] },
  { id: "doc-runbook", kind: "document", category: "operations", title: "Incident runbook", summary: "Detect, diagnose, mitigate, and recover for one service.", source: "PagerDuty incident response / Google SRE", sections: ["Symptoms", "Severity", "Diagnosis", "Mitigation", "Recovery", "Escalation", "Where the logs are"] },
  { id: "doc-postmortem", kind: "document", category: "operations", title: "Blameless postmortem", summary: "SRE postmortem: impact, timeline, cause, and actions.", source: "Google SRE Workbook postmortem template", sections: ["Summary", "Impact", "Timeline", "Root cause", "What went well", "What went poorly", "Action items"] },
  { id: "doc-sli-slo", kind: "document", category: "operations", title: "SLI / SLO / error budget", summary: "What we measure, the target, and what happens when we miss.", source: "Google SRE SLI/SLO practice", sections: ["User journeys", "SLIs", "SLOs", "Error budget policy", "Dashboards", "Unknowns"] },
  { id: "doc-alerting", kind: "document", category: "operations", title: "Alerting policy", summary: "What pages a human, why, and what to do.", source: "SRE alerting on symptoms, not causes", sections: ["Symptom alerts", "Cause alerts (if any)", "Routes", "Inhibition", "Noise sources", "Unknowns"] },
  { id: "doc-observability", kind: "document", category: "operations", title: "Observability spec", summary: "Logs, metrics, and traces this system actually emits.", source: "OpenTelemetry observability pillars", sections: ["Logs", "Metrics", "Traces", "Exemplars", "Cardinality risks", "Unknowns"] },
  { id: "doc-oncall-handoff", kind: "document", category: "operations", title: "On-call handoff", summary: "What the next engineer needs right now.", source: "PagerDuty handoff notes practice", sections: ["Open incidents", "Recent changes", "Fragile areas", "Follow-ups", "Unknowns"] },
  { id: "doc-deploy-runbook", kind: "document", category: "operations", title: "Deploy runbook", summary: "How a release actually goes out from this repo.", source: "GitOps / pipeline runbook practice", sections: ["Preconditions", "Steps", "Verification", "Abort", "Owners", "Unknowns"] },
  { id: "doc-rollback", kind: "document", category: "operations", title: "Rollback runbook", summary: "How to undo a bad release without making it worse.", source: "SRE rollback-first incident practice", sections: ["When to roll back", "Steps", "Data compatibility", "Verification", "When not to roll back"] },
  { id: "doc-log-taxonomy", kind: "document", category: "operations", title: "Log taxonomy", summary: "Levels, fields, and what must never be logged.", source: "12-factor logs / structured logging practice", sections: ["Levels", "Required fields", "Redaction", "Destinations", "Unknowns"] },
  { id: "doc-tracing", kind: "document", category: "operations", title: "Tracing notes", summary: "Trace context, spans, and sampling in this stack.", source: "W3C Trace Context / OpenTelemetry", sections: ["Propagators", "Span names", "Sampling", "Errors", "Unknowns"] },
  { id: "doc-changelog", kind: "document", category: "delivery", title: "Changelog", summary: "Keep a Changelog sections for what actually changed.", source: "Keep a Changelog", sections: ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"] },
  { id: "doc-release-notes", kind: "document", category: "delivery", title: "Release notes", summary: "User-facing and engineer-facing notes for one release.", source: "GitHub Releases convention", sections: ["Highlights", "Breaking changes", "Fixes", "Upgrade steps", "Known issues"] },
  { id: "doc-rollout", kind: "document", category: "delivery", title: "Rollout plan", summary: "Stages, gates, and abort criteria.", source: "progressive delivery / canary practice", sections: ["Stages", "Gates", "Metrics", "Abort", "Owners"] },
  { id: "doc-feature-flags", kind: "document", category: "delivery", title: "Feature flag spec", summary: "Flags, defaults, cleanup, and who they protect.", source: "LaunchDarkly / OpenFeature engineering practice", sections: ["Flags in code", "Default", "Audience", "Cleanup date", "Unknowns"] },
  { id: "doc-cutover", kind: "document", category: "delivery", title: "Cutover plan", summary: "The hour you switch traffic or data.", source: "migration cutover runbooks", sections: ["Preconditions", "Freeze", "Cut", "Verify", "Abort", "Owners"] },
  { id: "doc-cicd", kind: "document", category: "delivery", title: "CI/CD pipeline notes", summary: "Jobs, gates, artifacts, and who can ship.", source: "SLSA / pipeline as code practice", sections: ["Triggers", "Jobs", "Required checks", "Artifacts", "Who can ship", "Unknowns"] },
  { id: "doc-branching", kind: "document", category: "delivery", title: "Branching strategy", summary: "Trunk, release, and hotfix rules as this repo uses them.", source: "Trunk-Based Development / GitHub Flow", sections: ["Default branch", "Feature branches", "Release", "Hotfix", "Unknowns"] },
  { id: "doc-release-checklist", kind: "document", category: "delivery", title: "Release checklist", summary: "A yes/no list before a human hits ship.", source: "GOV.UK / engineering release checklists", sections: ["Code", "Tests", "Migrations", "Observability", "Comms", "Abort plan"] },
  { id: "doc-hotfix", kind: "document", category: "delivery", title: "Hotfix notes", summary: "What broke, the patch, and how we avoid a repeat.", source: "incident hotfix engineering notes", sections: ["Symptom", "Patch", "Blast radius", "Follow-up", "Unknowns"] },
  { id: "doc-test-strategy", kind: "document", category: "quality", title: "Test strategy", summary: "What we test, at which layer, and what we refuse to test.", source: "test pyramid / Google testing blog", sections: ["Unit", "Integration", "Contract", "E2E", "Out of scope", "Gaps"] },
  { id: "doc-test-plan", kind: "document", category: "quality", title: "Test plan", summary: "Cases for one change, mapped to code paths.", source: "IEEE 829 thinking, kept short for engineers", sections: ["In scope", "Cases", "Data", "Pass/fail", "Risks"] },
  { id: "doc-load-test", kind: "document", category: "quality", title: "Load test plan", summary: "Target QPS, dataset, and abort rules.", source: "k6 / SRE load testing practice", sections: ["Hypothesis", "Load profile", "Dataset", "Pass criteria", "Abort"] },
  { id: "doc-contract-tests", kind: "document", category: "quality", title: "Contract test notes", summary: "Consumer/provider contracts this repo actually runs.", source: "Pact / OpenAPI contract testing", sections: ["Consumers", "Providers", "Where tests live", "CI gate", "Unknowns"] },
  { id: "doc-code-review", kind: "document", category: "quality", title: "Code review checklist", summary: "What a reviewer must look at in this codebase.", source: "Google Engineering Practices code review", sections: ["Correctness", "Security", "Tests", "Observability", "API stability", "Nits we ignore"] },
  { id: "doc-dod", kind: "document", category: "quality", title: "Definition of done", summary: "The engineering bar for a change in this repo.", source: "Scrum DoD, written as engineering checks", sections: ["Tests", "Types", "Docs", "Telemetry", "Rollback", "Unknowns"] },
  { id: "doc-a11y-audit", kind: "document", category: "quality", title: "Accessibility audit", summary: "WCAG issues found in this UI code.", source: "WCAG 2.2 for engineers", sections: ["Keyboard", "Names and labels", "Contrast", "Status messages", "Findings"] },
  { id: "doc-contributing", kind: "document", category: "process", title: "CONTRIBUTING", summary: "How an engineer changes this repo safely.", source: "GitHub CONTRIBUTING.md convention", sections: ["Setup", "How to run tests", "How to propose a change", "Review rules", "Release"] },
  { id: "doc-readme-dev", kind: "document", category: "process", title: "Developer README", summary: "How to run, test, and debug this project locally.", source: "Standard OSS README sections for developers", sections: ["What this is", "Prerequisites", "Run", "Test", "Debug", "Layout of the repo"] },
  { id: "doc-onboarding", kind: "document", category: "process", title: "Engineer onboarding", summary: "First-week map of this codebase.", source: "engineering onboarding guides", sections: ["Repo map", "How to run", "Where truth lives", "Who to ask (roles, not names if unknown)", "First tasks"] },
  { id: "doc-spike", kind: "document", category: "process", title: "Spike notes", summary: "Time-boxed research: question, evidence, recommendation.", source: "XP spike practice", sections: ["Question", "Time box", "Evidence from the repo", "Options", "Recommendation"] },
  { id: "doc-tech-debt", kind: "document", category: "process", title: "Tech debt register", summary: "Known debt, cost, and the next cut.", source: "technical debt quadrants (Fowler), as a register", sections: ["Item", "Where in the repo", "Cost of delay", "Fix sketch", "Unknowns"] },
  { id: "doc-retro", kind: "document", category: "process", title: "Engineering retrospective", summary: "What the last slice taught us about this system.", source: "agile retrospective, evidence-based", sections: ["What happened", "Evidence", "Keep", "Change", "Experiments"] },
  { id: "doc-glossary", kind: "document", category: "process", title: "Engineering glossary", summary: "Words this codebase uses with one meaning each.", source: "DDD ubiquitous language", sections: ["Term", "Meaning in this repo", "Not this", "Where it appears"] },
  { id: "doc-working-agreement", kind: "document", category: "process", title: "Engineering working agreement", summary: "How this team changes production software.", source: "team working agreements for engineering", sections: ["Branching", "Review", "On-call", "Docs", "Unknowns"] },
  { id: "doc-component-api", kind: "document", category: "frontend", title: "UI component API", summary: "Props, events, and accessibility of a component in this repo.", source: "W3C ARIA APG + design-system component API notes", sections: ["Purpose", "Props", "Events", "Accessibility", "Do/don't"] },
  { id: "doc-design-tokens", kind: "document", category: "frontend", title: "Design token notes", summary: "Color, type, and space tokens as the CSS actually defines them.", source: "W3C Design Tokens community format thinking", sections: ["Color", "Type", "Space", "Motion", "Unknowns"] },
  { id: "doc-frontend-state", kind: "document", category: "frontend", title: "Frontend state model", summary: "Client state, server state, and where they meet.", source: "SPA state management practice", sections: ["Server state", "Client state", "URL state", "Invalidation", "Unknowns"] },
  { id: "doc-service-charter", kind: "document", category: "backend", title: "Service charter", summary: "What this service is for, SLOs, and who it talks to.", source: "Google SRE service charter / team charter", sections: ["Purpose", "SLIs/SLOs", "Dependencies", "Non-goals", "Unknowns"] },
  { id: "doc-job-queue", kind: "document", category: "backend", title: "Job queue notes", summary: "Queues, workers, retries, and poison messages.", source: "transactional outbox / queue processing practice", sections: ["Queues", "Workers", "Retry", "Poison", "Idempotency", "Unknowns"] },
  { id: "doc-db-indexes", kind: "document", category: "backend", title: "Database index notes", summary: "Indexes that exist and queries they serve.", source: "relational index design practice", sections: ["Tables", "Indexes", "Queries they serve", "Write cost", "Unknowns"] },
  { id: "doc-config-surface", kind: "document", category: "backend", title: "Configuration surface", summary: "Env, flags, and files that change runtime behavior.", source: "12-factor config", sections: ["Sources", "Keys", "Defaults", "Dangerous flags", "Unknowns"] },
  { id: "doc-adr-index", kind: "document", category: "architecture", title: "ADR index", summary: "Table of architecture decisions found or missing in this repo.", source: "MADR / Nygard ADR collections", sections: ["Known ADRs", "Status", "Superseded", "Missing decisions", "Unknowns"] },
  { id: "doc-healthcheck", kind: "document", category: "operations", title: "Health check contract", summary: "Liveness vs readiness and what each probe actually hits.", source: "Kubernetes probe / SRE health-check practice", sections: ["Liveness", "Readiness", "Dependencies checked", "Failure meaning", "Unknowns"] },
  { id: "doc-timeouts", kind: "document", category: "backend", title: "Timeouts and retries", summary: "Deadlines and retry policy as the code implements them.", source: "Google SRE handling overload / retry budgets", sections: ["Inbound deadlines", "Outbound timeouts", "Retries", "Jitter", "Unknowns"] },
  { id: "doc-circuit-breaker", kind: "document", category: "backend", title: "Circuit breaker notes", summary: "Where this repo sheds load instead of retrying forever.", source: "Release It! circuit breaker pattern", sections: ["Protected calls", "Open/half-open", "Fallback", "Metrics", "Unknowns"] },
  { id: "doc-audit-log", kind: "document", category: "security", title: "Audit log design", summary: "Who did what, where it is stored, what must never be logged.", source: "OWASP logging / audit trail practice", sections: ["Events", "Actor", "Resource", "Retention in code", "Redaction", "Unknowns"] },
  { id: "doc-codeowners", kind: "document", category: "process", title: "CODEOWNERS map", summary: "Who reviews which paths, from CODEOWNERS or equivalent.", source: "GitHub CODEOWNERS", sections: ["Paths", "Owners", "Gaps", "Unknowns"] },
  { id: "doc-sbom", kind: "document", category: "security", title: "SBOM notes", summary: "How this repo records what it ships.", source: "SPDX / CycloneDX SBOM practice", sections: ["Format", "Where generated", "What is included", "Unknowns"] },
  { id: "doc-semver", kind: "document", category: "delivery", title: "Versioning policy", summary: "How this project versions public surfaces.", source: "Semantic Versioning 2.0.0", sections: ["Public surface", "MAJOR", "MINOR", "PATCH", "Unknowns"] },
  { id: "doc-canary", kind: "document", category: "delivery", title: "Canary analysis", summary: "How a partial rollout is judged a pass or a fail.", source: "progressive delivery / SRE canary practice", sections: ["Slice", "Metrics", "Pass", "Abort", "Unknowns"] },
  { id: "doc-tenant-isolation", kind: "document", category: "security", title: "Tenant isolation", summary: "How one tenant is kept out of another's data, if multi-tenant.", source: "SaaS tenant isolation engineering notes", sections: ["Tenant key", "Query scoping", "Storage", "Gaps", "Unknowns"] },
]

const DIAGRAM_SEEDS: readonly KnowledgeSeedLite[] = [
  { id: "diag-c4-context", kind: "diagram", category: "architecture", title: "C4 system context", summary: "People and systems around this software system.", source: "C4 model — System Context (Simon Brown)", sections: ["This system", "Users/actors", "External systems", "Relationships", "Unknowns"] },
  { id: "diag-c4-container", kind: "diagram", category: "architecture", title: "C4 containers", summary: "Applications and data stores that make up the system.", source: "C4 model — Container", sections: ["Containers", "Protocols", "Stores", "External systems", "Unknowns"] },
  { id: "diag-c4-component", kind: "diagram", category: "architecture", title: "C4 components", summary: "Components inside one container.", source: "C4 model — Component", sections: ["Chosen container", "Components", "Interfaces", "Dependencies", "Unknowns"] },
  { id: "diag-c4-code", kind: "diagram", category: "architecture", title: "C4 code view", summary: "Important classes or modules inside one component.", source: "C4 model — Code", sections: ["Chosen component", "Types/modules", "Relations", "Unknowns"] },
  { id: "diag-c4-landscape", kind: "diagram", category: "architecture", title: "C4 system landscape", summary: "Enterprise view of systems this repo participates in.", source: "C4 model — System Landscape", sections: ["Systems", "This repo's system", "Relationships", "Unknowns"] },
  { id: "diag-c4-dynamic", kind: "diagram", category: "architecture", title: "C4 dynamic diagram", summary: "Runtime collaboration for one use case.", source: "C4 model — Dynamic", sections: ["Use case", "Participants", "Ordered interactions", "Unknowns"] },
  { id: "diag-c4-deployment", kind: "diagram", category: "architecture", title: "C4 deployment", summary: "Where containers run and how they connect.", source: "C4 model — Deployment", sections: ["Nodes", "Containers on nodes", "Networks", "Unknowns"] },
  { id: "diag-uml-class", kind: "diagram", category: "backend", title: "UML class diagram", summary: "Types, fields, and relations from the code.", source: "UML 2.5 class diagram", sections: ["Types", "Fields/methods that exist", "Associations", "Unknowns"] },
  { id: "diag-uml-sequence", kind: "diagram", category: "backend", title: "UML sequence diagram", summary: "Time-ordered calls for one real flow.", source: "UML 2.5 sequence diagram", sections: ["Actors/objects", "Messages in order", "Returns/errors", "Unknowns"] },
  { id: "diag-uml-activity", kind: "diagram", category: "process", title: "UML activity diagram", summary: "Control flow of one real procedure in the repo.", source: "UML 2.5 activity diagram", sections: ["Start", "Actions", "Decisions", "End", "Unknowns"] },
  { id: "diag-uml-state", kind: "diagram", category: "backend", title: "UML state machine", summary: "States and transitions of one entity in code.", source: "UML 2.5 state machine", sections: ["States", "Events", "Transitions", "Illegal transitions", "Unknowns"] },
  { id: "diag-uml-component", kind: "diagram", category: "architecture", title: "UML component diagram", summary: "Components and provided/required interfaces.", source: "UML 2.5 component diagram", sections: ["Components", "Provided interfaces", "Required interfaces", "Unknowns"] },
  { id: "diag-uml-deployment", kind: "diagram", category: "operations", title: "UML deployment diagram", summary: "Artifacts on nodes as this system actually ships.", source: "UML 2.5 deployment diagram", sections: ["Nodes", "Artifacts", "Communication paths", "Unknowns"] },
  { id: "diag-uml-package", kind: "diagram", category: "backend", title: "UML package diagram", summary: "Packages/modules and dependencies.", source: "UML 2.5 package diagram", sections: ["Packages", "Dependencies", "Cycles", "Unknowns"] },
  { id: "diag-uml-usecase", kind: "diagram", category: "process", title: "UML use case diagram", summary: "Actors and use cases grounded in this product.", source: "UML 2.5 use case diagram", sections: ["Actors", "Use cases", "Includes/extends if real", "Unknowns"] },
  { id: "diag-uml-object", kind: "diagram", category: "backend", title: "UML object diagram", summary: "A snapshot of real instances and links.", source: "UML 2.5 object diagram", sections: ["Instances", "Links", "Values that exist", "Unknowns"] },
  { id: "diag-erd", kind: "diagram", category: "data", title: "Entity-relationship diagram", summary: "Crow's-foot ERD of tables in this schema.", source: "Crow's-foot ERD", sections: ["Entities", "Keys", "Cardinalities", "Unknowns"] },
  { id: "diag-dfd", kind: "diagram", category: "data", title: "Data flow diagram", summary: "Yourdon/DeMarco-style flows between processes and stores.", source: "Yourdon/DeMarco DFD", sections: ["Processes", "Stores", "External entities", "Flows", "Unknowns"] },
  { id: "diag-bpmn", kind: "diagram", category: "process", title: "BPMN process", summary: "One real process with lanes if roles exist.", source: "BPMN 2.0", sections: ["Start", "Tasks", "Gateways", "Lanes if known", "End", "Unknowns"] },
  { id: "diag-flowchart", kind: "diagram", category: "process", title: "Control-flow flowchart", summary: "Branching logic of one function or handler.", source: "ISO 5807 flowchart practice", sections: ["Entry", "Decisions", "Side effects", "Exits", "Unknowns"] },
  { id: "diag-swimlane", kind: "diagram", category: "process", title: "Swimlane flowchart", summary: "Who does what, if roles exist in this flow.", source: "swimlane process mapping", sections: ["Lanes", "Handoffs", "Waits", "Unknowns"] },
  { id: "diag-hex-ports", kind: "diagram", category: "architecture", title: "Ports and adapters", summary: "Hexagon with real adapters from the repo.", source: "Cockburn hexagonal architecture", sections: ["Domain", "Inbound adapters", "Outbound adapters", "Unknowns"] },
  { id: "diag-layers", kind: "diagram", category: "architecture", title: "Layered architecture", summary: "Layers as the folders and imports actually form them.", source: "layered architecture view", sections: ["Layers", "Allowed calls", "Violations if visible", "Unknowns"] },
  { id: "diag-microservices", kind: "diagram", category: "architecture", title: "Service map", summary: "Deployables and how they talk.", source: "microservices landscape diagram", sections: ["Services", "Sync calls", "Async calls", "Data stores", "Unknowns"] },
  { id: "diag-saga", kind: "diagram", category: "architecture", title: "Saga choreography", summary: "Compensation path for one long-running flow.", source: "saga pattern diagrams", sections: ["Steps", "Events", "Compensations", "Unknowns"] },
  { id: "diag-cqrs", kind: "diagram", category: "architecture", title: "CQRS diagram", summary: "Command and query stacks as they exist.", source: "CQRS topology diagram", sections: ["Commands", "Writes", "Reads", "Sync", "Unknowns"] },
  { id: "diag-strangler", kind: "diagram", category: "architecture", title: "Strangler-fig map", summary: "Old vs new paths if a migration exists.", source: "strangler fig pattern", sections: ["Legacy", "Facade", "New", "Traffic split", "Unknowns"] },
  { id: "diag-oauth-sequence", kind: "diagram", category: "security", title: "OAuth / OIDC sequence", summary: "Login sequence from this codebase.", source: "OAuth 2.1 / OIDC sequence diagrams", sections: ["Actors", "Redirects/tokens", "Failures", "Unknowns"] },
  { id: "diag-threat-dfd", kind: "diagram", category: "security", title: "STRIDE data-flow diagram", summary: "Trust boundaries for threat modeling.", source: "Microsoft threat modeling DFD", sections: ["Processes", "Stores", "Actors", "Trust boundaries", "Unknowns"] },
  { id: "diag-zero-trust", kind: "diagram", category: "security", title: "Trust zones", summary: "Network/identity zones this app actually uses.", source: "zero-trust network diagrams", sections: ["Zones", "Identities", "Allowed paths", "Unknowns"] },
  { id: "diag-cicd-pipeline", kind: "diagram", category: "delivery", title: "CI/CD pipeline", summary: "Jobs and artifacts from the pipeline files.", source: "pipeline-as-code diagrams", sections: ["Triggers", "Jobs", "Artifacts", "Deploys", "Unknowns"] },
  { id: "diag-git-branching", kind: "diagram", category: "delivery", title: "Git branching", summary: "Branch flow this repo documents or uses.", source: "GitHub Flow / trunk-based diagrams", sections: ["Branches", "Merges", "Releases", "Unknowns"] },
  { id: "diag-k8s", kind: "diagram", category: "operations", title: "Kubernetes deploy", summary: "Workloads, services, and ingress if manifests exist.", source: "Kubernetes resource diagrams", sections: ["Workloads", "Services", "Config/secrets", "Ingress", "Unknowns"] },
  { id: "diag-network", kind: "diagram", category: "operations", title: "Network topology", summary: "Listeners, proxies, and upstreams from config.", source: "deployment network diagrams", sections: ["Edges", "Listeners", "Upstreams", "Unknowns"] },
  { id: "diag-cache-aside", kind: "diagram", category: "data", title: "Cache-aside flow", summary: "Read/write path through cache if present.", source: "cache-aside pattern diagram", sections: ["Client", "Cache", "Store", "Invalidation", "Unknowns"] },
  { id: "diag-replication", kind: "diagram", category: "data", title: "Replication topology", summary: "Primary/replica if the repo configures it.", source: "database replication diagrams", sections: ["Primary", "Replicas", "Failover", "Unknowns"] },
  { id: "diag-queue-workers", kind: "diagram", category: "backend", title: "Queue and workers", summary: "Producers, brokers, and consumers in this repo.", source: "messaging topology diagrams", sections: ["Producers", "Queues", "Consumers", "DLQ", "Unknowns"] },
  { id: "diag-api-gateway", kind: "diagram", category: "api", title: "API gateway", summary: "Edge routing into services if a gateway exists.", source: "API gateway topology", sections: ["Clients", "Gateway", "Upstreams", "Auth", "Unknowns"] },
  { id: "diag-sequence-error", kind: "diagram", category: "api", title: "Error-path sequence", summary: "What happens when a real endpoint fails.", source: "UML sequence (failure path)", sections: ["Happy path briefly", "Failure", "Retries", "Client-visible error", "Unknowns"] },
  { id: "diag-frontend-tree", kind: "diagram", category: "frontend", title: "Component tree", summary: "React/view tree for one real screen.", source: "UI component tree diagrams", sections: ["Screen", "Components", "Data down", "Events up", "Unknowns"] },
  { id: "diag-context-map", kind: "diagram", category: "architecture", title: "Context map", summary: "DDD contexts and relationships.", source: "DDD context mapping", sections: ["Contexts", "Relationships", "Translations", "Unknowns"] },
  { id: "diag-observability", kind: "diagram", category: "operations", title: "Observability pipeline", summary: "How logs/metrics/traces leave the process.", source: "OpenTelemetry pipeline diagrams", sections: ["App", "SDK", "Collector/backends", "Unknowns"] },
  { id: "diag-multi-region", kind: "diagram", category: "operations", title: "Multi-region", summary: "Regions and failover if the repo defines them.", source: "multi-region architecture diagrams", sections: ["Regions", "Data", "Failover", "Unknowns"] },
  { id: "diag-request-flow", kind: "diagram", category: "backend", title: "Request flow", summary: "One inbound request through middleware to storage.", source: "request lifecycle diagrams", sections: ["Entry", "Auth", "Handler", "Storage", "Response", "Unknowns"] },
  { id: "diag-module-deps", kind: "diagram", category: "backend", title: "Module dependency graph", summary: "Packages that import each other in this repo.", source: "module dependency graphs", sections: ["Modules", "Imports", "Cycles", "Unknowns"] },
  { id: "diag-state-order", kind: "diagram", category: "backend", title: "Order/state machine", summary: "A real lifecycle enum or status field in code.", source: "UML state machine applied to domain status", sections: ["Statuses", "Transitions", "Terminal states", "Unknowns"] },
  { id: "diag-event-storm", kind: "diagram", category: "architecture", title: "Event-storming board", summary: "Commands, events, and aggregates visible in the domain.", source: "Event Storming (Alberto Brandolini)", sections: ["Commands", "Events", "Aggregates", "Policies", "Unknowns"] },
  { id: "diag-authz-flow", kind: "diagram", category: "security", title: "Authorization flow", summary: "How a permission check actually runs.", source: "authz sequence diagrams", sections: ["Caller", "Policy", "Resource", "Deny/allow", "Unknowns"] },
  { id: "diag-backup-topology", kind: "diagram", category: "data", title: "Backup topology", summary: "What copies where, if backup is configured.", source: "backup topology diagrams", sections: ["Primary data", "Backup target", "Retention", "Unknowns"] },
  { id: "diag-uml-communication", kind: "diagram", category: "backend", title: "UML communication diagram", summary: "Object links and messages for one collaboration.", source: "UML 2.5 communication diagram", sections: ["Objects", "Links", "Numbered messages", "Unknowns"] },
  { id: "diag-sequence-webhook", kind: "diagram", category: "api", title: "Webhook delivery sequence", summary: "How this app sends or receives a signed webhook.", source: "UML sequence + webhook signing practice", sections: ["Sender", "Receiver", "Signature", "Retry", "Unknowns"] },
  { id: "diag-sequence-login", kind: "diagram", category: "security", title: "Login sequence", summary: "The real login path in this repo.", source: "OIDC / session login sequence diagrams", sections: ["Browser", "App", "IdP if any", "Session", "Unknowns"] },
  { id: "diag-circuit-breaker", kind: "diagram", category: "backend", title: "Circuit breaker states", summary: "Closed, open, half-open for a real downstream.", source: "Release It! circuit breaker diagram", sections: ["Downstream", "States", "Trip conditions", "Unknowns"] },
  { id: "diag-healthcheck", kind: "diagram", category: "operations", title: "Health-check graph", summary: "What each probe calls.", source: "Kubernetes probe topology", sections: ["Probes", "Dependencies", "Fail-closed edges", "Unknowns"] },
]

function compileAll(seeds: readonly CatalogSeed[]): MarketplaceCatalogItem[] {
  const compiled: MarketplaceCatalogItem[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const item = compileSeed(seed);
    if (seen.has(item.id)) {
      throw new Error(`duplicate catalog id ${item.id}`);
    }
    seen.add(item.id);
    compiled.push(item);
  }
  return compiled;
}

export const MARKETPLACE_CATALOG: readonly MarketplaceCatalogItem[] = compileAll(
  DOCUMENT_SEEDS.map(knowledgeToSeed)
    .concat(DIAGRAM_SEEDS.map(knowledgeToSeed))
    .concat(SCRIPT_SEEDS)
    .concat(TASK_SEEDS),
);

export function marketplaceItemById(id: string): MarketplaceCatalogItem | null {
  for (const item of MARKETPLACE_CATALOG) {
    if (item.id === id) {
      return item;
    }
  }
  return null;
}

export function marketplaceCategoryLabel(id: string): string {
  for (const listed of MARKETPLACE_CATEGORIES) {
    if (listed.id === id) {
      return listed.label;
    }
  }
  return id;
}

export const MARKETPLACE_PACK_FORMAT = "lotaru.marketplace";
export const MARKETPLACE_PACK_VERSION = 1;

const marketplaceTaskNodeSchema: z.ZodType<MarketplaceTaskNode> = z.lazy(() => {
  return z
    .object({
      id: catalogIdSchema,
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().min(1).max(8000),
      children: z.array(marketplaceTaskNodeSchema).max(20),
    })
    .strict();
});

const packItemSchema = z
  .object({
    id: catalogIdSchema,
    kind: kindSchema,
    category: categorySchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(400),
    source: z.string().trim().min(1).max(400),
    description: z.string().trim().min(1).max(50000),
    command: z.string().max(4000),
    triggerType: z.string().max(40),
    triggerGlob: z.string().max(400),
    triggerBusEvent: z.string().max(200),
    concurrency: z.string().max(40),
    stageTitle: z.string().max(200),
    stageRules: z.array(z.string().trim().min(1).max(400)).max(20),
    taskNodes: z.array(marketplaceTaskNodeSchema).max(20),
  })
  .strict();

const packSchema = z
  .object({
    format: z.literal(MARKETPLACE_PACK_FORMAT),
    version: z.literal(MARKETPLACE_PACK_VERSION),
    items: z.array(packItemSchema).min(1).max(400),
  })
  .strict();

export type MarketplacePack = z.infer<typeof packSchema>;

function requireKindFields(item: z.infer<typeof packItemSchema>): void {
  if (item.kind === "script") {
    if (item.command.trim().length === 0) {
      throw new Error(`pack ${item.id} needs a command`);
    }
    return;
  }
  if (item.kind === "task") {
    if (item.stageTitle.trim().length === 0) {
      throw new Error(`pack ${item.id} needs a stage title`);
    }
    if (item.taskNodes.length === 0) {
      throw new Error(`pack ${item.id} needs tasks`);
    }
    return;
  }
  if (item.description.trim().length === 0) {
    throw new Error(`pack ${item.id} needs a description`);
  }
}

export function parseMarketplacePack(raw: unknown): MarketplacePack {
  const parsed = packSchema.safeParse(raw);
  if (parsed.success !== true) {
    throw new Error("Invalid marketplace pack");
  }
  for (const item of parsed.data.items) {
    requireKindFields(item);
  }
  return parsed.data;
}

export function marketplacePackFromItems(
  items: readonly MarketplaceCatalogItem[],
): MarketplacePack {
  const packed: z.infer<typeof packItemSchema>[] = [];
  for (const item of items) {
    packed.push({
      id: item.id,
      kind: item.kind,
      category: item.category,
      title: item.title,
      summary: item.summary,
      source: item.source,
      description: item.description,
      command: item.command,
      triggerType: item.triggerType,
      triggerGlob: item.triggerGlob,
      triggerBusEvent: item.triggerBusEvent,
      concurrency: item.concurrency,
      stageTitle: item.stageTitle,
      stageRules: item.stageRules.slice(),
      taskNodes: item.taskNodes.slice(),
    });
  }
  if (packed.length === 0) {
    throw new Error("marketplace pack needs items");
  }
  return parseMarketplacePack({
    format: MARKETPLACE_PACK_FORMAT,
    version: MARKETPLACE_PACK_VERSION,
    items: packed,
  });
}

export function isBuiltinMarketplaceId(id: string): boolean {
  for (const item of MARKETPLACE_CATALOG) {
    if (item.id === id) {
      return true;
    }
  }
  return false;
}
