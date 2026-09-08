import type { CatalogSeed, MarketplaceCategory, MarketplaceTaskNode } from "./marketplace-catalog.js";

function emptyWork(): {
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

function scriptSeed(input: {
  id: string;
  category: MarketplaceCategory;
  title: string;
  summary: string;
  source: string;
  command: string;
  sections: readonly string[];
}): CatalogSeed {
  const work = emptyWork();
  return {
    id: input.id,
    kind: "script",
    category: input.category,
    title: input.title,
    summary: input.summary,
    source: input.source,
    sections: input.sections,
    command: input.command,
    triggerType: "manual",
    triggerGlob: "",
    triggerBusEvent: "",
    concurrency: "ignore",
    stageTitle: work.stageTitle,
    stageRules: work.stageRules,
    taskNodes: work.taskNodes,
  };
}

function taskNode(
  id: string,
  title: string,
  description: string,
  children: readonly MarketplaceTaskNode[],
): MarketplaceTaskNode {
  const trimmedId = id.trim();
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  if (trimmedId.length === 0 || trimmedTitle.length === 0) {
    throw new Error("task node needs id and title");
  }
  if (trimmedDescription.length === 0) {
    throw new Error(`task node ${trimmedId} needs a description`);
  }
  return {
    id: trimmedId,
    title: trimmedTitle,
    description: trimmedDescription,
    children,
  };
}

function leaf(
  id: string,
  title: string,
  description: string,
): MarketplaceTaskNode {
  return taskNode(id, title, description, []);
}

function taskSeed(input: {
  id: string;
  category: MarketplaceCategory;
  title: string;
  summary: string;
  source: string;
  stageTitle: string;
  stageRules: readonly string[];
  tasks: readonly MarketplaceTaskNode[];
  sections: readonly string[];
}): CatalogSeed {
  const work = emptyWork();
  return {
    id: input.id,
    kind: "task",
    category: input.category,
    title: input.title,
    summary: input.summary,
    source: input.source,
    sections: input.sections,
    command: work.command,
    triggerType: work.triggerType,
    triggerGlob: work.triggerGlob,
    triggerBusEvent: work.triggerBusEvent,
    concurrency: work.concurrency,
    stageTitle: input.stageTitle,
    stageRules: input.stageRules,
    taskNodes: input.tasks,
  };
}

export const SCRIPT_SEEDS: readonly CatalogSeed[] = [
  scriptSeed({
    id: "script-npm-test",
    category: "quality",
    title: "Run tests",
    summary: "npm test — the repo's unit and integration suite.",
    source: "npm test / Node.js test runner convention",
    command: "npm test",
    sections: ["Run the test script", "Fail closed if npm test is missing", "No extra flags", "Read the log"],
  }),
  scriptSeed({
    id: "script-npm-lint",
    category: "quality",
    title: "Lint",
    summary: "npm run lint — static checks this repo actually defines.",
    source: "ESLint / Ruff / repo lint script convention",
    command: "npm run lint",
    sections: ["Run lint", "Fail closed if the script is missing", "No auto-fix unless the script does", "Read the log"],
  }),
  scriptSeed({
    id: "script-npm-typecheck",
    category: "quality",
    title: "Typecheck",
    summary: "npm run typecheck — TypeScript or equivalent, no emit.",
    source: "tsc --noEmit / package typecheck script",
    command: "npm run typecheck",
    sections: ["Run typecheck", "Fail closed if missing", "No emit", "Read the log"],
  }),
  scriptSeed({
    id: "script-npm-build",
    category: "delivery",
    title: "Build",
    summary: "npm run build — production compile this repo ships.",
    source: "package.json build script convention",
    command: "npm run build",
    sections: ["Run build", "Fail closed if missing", "No deploy", "Read the log"],
  }),
  scriptSeed({
    id: "script-npm-audit",
    category: "security",
    title: "Dependency audit",
    summary: "npm audit — known holes in the lockfile.",
    source: "npm audit / OpenSSF dependency scanning",
    command: "npm audit --omit=dev",
    sections: ["Run audit", "Production deps only", "Fail closed on npm missing", "Read advisories"],
  }),
  scriptSeed({
    id: "script-git-status",
    category: "process",
    title: "Git status",
    summary: "Short porcelain status of the working tree.",
    source: "git status porcelain",
    command: "git status --short --untracked-files=normal",
    sections: ["Show status", "No mutations", "Include untracked", "Fail closed if not a repo"],
  }),
  scriptSeed({
    id: "script-todo-scan",
    category: "process",
    title: "TODO scan",
    summary: "git grep for TODO/FIXME outside node_modules.",
    source: "in-repo TODO debt scan",
    command: "git grep -n -e TODO -e FIXME -- :!node_modules :!dist",
    sections: ["Search TODO", "Search FIXME", "Skip node_modules", "Fail closed if git missing"],
  }),
  scriptSeed({
    id: "script-last-commit",
    category: "delivery",
    title: "Last commit message",
    summary: "Show HEAD subject for Conventional Commits review.",
    source: "Conventional Commits 1.0.0",
    command: "git log -1 --pretty=format:%s%n%n%b",
    sections: ["Print HEAD subject", "Print body", "No rewrite", "Fail closed if git missing"],
  }),
  scriptSeed({
    id: "script-npm-outdated",
    category: "delivery",
    title: "Outdated dependencies",
    summary: "npm outdated — what can move without inventing upgrades.",
    source: "npm outdated",
    command: "npm outdated",
    sections: ["List outdated", "No install", "No upgrade", "Read the table"],
  }),
  scriptSeed({
    id: "script-git-changelog",
    category: "delivery",
    title: "Recent git log",
    summary: "Last 20 commits as a Keep a Changelog draft input.",
    source: "Keep a Changelog + git log",
    command: "git log -20 --pretty=format:%h %ad %s --date=short",
    sections: ["Last 20 commits", "Hash and subject", "No pretty invention", "Fail closed if git missing"],
  }),
];

export const TASK_SEEDS: readonly CatalogSeed[] = [
  taskSeed({
    id: "task-feature",
    category: "process",
    title: "Feature slice",
    summary: "Design, implement, test, and document one change.",
    source: "Google Engineering Practices / trunk-based feature work",
    stageTitle: "Feature",
    stageRules: ["Scope is one user-visible slice", "Tests before merge", "Docs match the code"],
    sections: ["Write the change", "Cover it with tests", "Update docs", "Ready for review"],
    tasks: [
      leaf("feature-design", "Name the change", "One paragraph: who it is for and what is out of scope."),
      leaf("feature-build", "Implement", "Change only the files this slice needs. No drive-by refactors."),
      leaf("feature-test", "Prove it", "Add or update tests that fail without this change."),
      leaf("feature-docs", "Document", "README, API, or changelog entry that matches the code."),
    ],
  }),
  taskSeed({
    id: "task-bugfix",
    category: "quality",
    title: "Bugfix",
    summary: "Reproduce, fix, and lock with a regression test.",
    source: "Google testing blog — bug then test then fix",
    stageTitle: "Bugfix",
    stageRules: ["Reproduce first", "Regression test required", "No silent behavior change"],
    sections: ["Reproduce", "Failing test", "Fix", "Check blast radius"],
    tasks: [
      leaf("bug-repro", "Reproduce", "Steps, expected, actual. Link the event or log if it exists."),
      leaf("bug-test", "Regression test", "A test that fails on the bug and passes after the fix."),
      leaf("bug-fix", "Fix", "Smallest change that makes the test pass."),
      leaf("bug-radius", "Blast radius", "What else could this have broken. Say Unknown if you did not check."),
    ],
  }),
  taskSeed({
    id: "task-incident",
    category: "operations",
    title: "Incident",
    summary: "Mitigate, communicate, then a blameless postmortem.",
    source: "Google SRE Workbook / PagerDuty incident response",
    stageTitle: "Incident",
    stageRules: ["Mitigate before root-cause theatre", "Blameless writeup", "Actions have owners"],
    sections: ["Mitigate", "Timeline", "Postmortem", "Actions"],
    tasks: [
      leaf("inc-mitigate", "Mitigate", "Stop the bleeding. Rollback or feature-flag if that is safer."),
      leaf("inc-timeline", "Timeline", "UTC timestamps from first signal to recovery."),
      leaf("inc-postmortem", "Postmortem", "Impact, cause, what went well/poorly, no blame."),
      leaf("inc-actions", "Action items", "Preventative work with an owner and a due date."),
    ],
  }),
  taskSeed({
    id: "task-rfc",
    category: "architecture",
    title: "Engineering RFC",
    summary: "Proposal, alternatives, and a recorded decision.",
    source: "IETF / Rust RFC process for product engineering",
    stageTitle: "RFC",
    stageRules: ["Decision is written down", "Alternatives are real", "No silent architecture"],
    sections: ["Motivation", "Design", "Alternatives", "Decision"],
    tasks: [
      leaf("rfc-motivation", "Motivation", "What is expensive today and who pays."),
      leaf("rfc-design", "Proposed design", "The change, APIs, and failure modes."),
      leaf("rfc-alts", "Alternatives", "At least two real options and why they lose."),
      leaf("rfc-decide", "Decision", "Accept, reject, or defer. Link the ADR if one is written."),
    ],
  }),
  taskSeed({
    id: "task-security-review",
    category: "security",
    title: "Security review",
    summary: "Authn, authz, secrets, injection, and supply chain for one change.",
    source: "OWASP ASVS engineering review slice",
    stageTitle: "Security review",
    stageRules: ["Findings are evidence from the repo", "No invented threats", "Secrets never in git"],
    sections: ["Authn/authz", "Secrets", "Injection", "Dependencies"],
    tasks: [
      leaf("sec-auth", "Authn and authz", "Who can call what after this change. Gaps listed."),
      leaf("sec-secrets", "Secrets", "Where credentials enter and where they must not land."),
      leaf("sec-inject", "Injection", "SQL, command, template, and path risks in the diff."),
      leaf("sec-deps", "Dependencies", "New packages and known advisories."),
    ],
  }),
  taskSeed({
    id: "task-release",
    category: "delivery",
    title: "Release",
    summary: "Changelog, checks, ship, and verify.",
    source: "Keep a Changelog + GitHub Releases + SRE rollback-first",
    stageTitle: "Release",
    stageRules: ["Changelog is human", "Abort is written", "Verify in production terms"],
    sections: ["Changelog", "Preflight", "Ship", "Verify"],
    tasks: [
      leaf("rel-notes", "Changelog", "Added, Changed, Fixed, Security from the actual diff."),
      leaf("rel-preflight", "Preflight", "Tests, migrations, and abort plan ticked."),
      leaf("rel-ship", "Ship", "The release command this repo actually uses."),
      leaf("rel-verify", "Verify", "SLIs or smoke checks. Rollback if they fail."),
    ],
  }),
  taskSeed({
    id: "task-spike",
    category: "process",
    title: "Spike",
    summary: "Time-boxed research with a recommendation.",
    source: "XP spike practice",
    stageTitle: "Spike",
    stageRules: ["Time box is real", "Evidence from the repo", "Recommendation is one sentence"],
    sections: ["Question", "Time box", "Evidence", "Recommend"],
    tasks: [
      leaf("spike-question", "Question", "What we need to know before writing production code."),
      leaf("spike-timebox", "Time box", "Hours or a date. Stop when it hits."),
      leaf("spike-evidence", "Evidence", "Files, APIs, and measurements from this repo."),
      leaf("spike-recommend", "Recommendation", "Build, don't, or spike again — with why."),
    ],
  }),
  taskSeed({
    id: "task-hotfix",
    category: "delivery",
    title: "Hotfix",
    summary: "Patch production, then the follow-up that prevents a repeat.",
    source: "incident hotfix engineering notes",
    stageTitle: "Hotfix",
    stageRules: ["Patch is small", "Follow-up is scheduled", "No silent config"],
    sections: ["Symptom", "Patch", "Ship", "Follow-up"],
    tasks: [
      leaf("hf-symptom", "Symptom", "What users see and since when."),
      leaf("hf-patch", "Patch", "The smallest production-safe change."),
      leaf("hf-ship", "Ship hotfix", "The hotfix branch or revert this repo uses."),
      leaf("hf-follow", "Follow-up", "The proper fix and the test that was missing."),
    ],
  }),
  taskSeed({
    id: "task-api-change",
    category: "api",
    title: "API change",
    summary: "Contract, compatibility, and caller notes for one endpoint change.",
    source: "OpenAPI / Stripe-style API versioning practice",
    stageTitle: "API change",
    stageRules: ["Contract is in the repo", "Breaking changes are named", "Examples match code"],
    sections: ["Contract", "Compatibility", "Errors", "Callers"],
    tasks: [
      leaf("api-contract", "Contract", "Request, response, and status codes as the code implements them."),
      leaf("api-compat", "Compatibility", "Additive vs breaking. Sunset if breaking."),
      leaf("api-errors", "Errors", "Stable codes and retry guidance."),
      leaf("api-callers", "Callers", "Who still depends on the old shape. Unknown is allowed."),
    ],
  }),
  taskSeed({
    id: "task-schema-migration",
    category: "data",
    title: "Schema migration",
    summary: "Expand, migrate, contract — with a rollback.",
    source: "expand/contract database migration practice",
    stageTitle: "Schema migration",
    stageRules: ["Expand before contract", "Rollback is tested or marked Unknown", "No dual-write invention"],
    sections: ["Expand", "Migrate", "Contract", "Rollback"],
    tasks: [
      leaf("mig-expand", "Expand", "Add columns/tables that old code can ignore."),
      leaf("mig-data", "Migrate data", "Backfill. Dual-write only if the repo already does."),
      leaf("mig-contract", "Contract", "Remove the old shape after readers are gone."),
      leaf("mig-rollback", "Rollback", "How to undo without data loss. Unknown if untested."),
    ],
  }),
  taskSeed({
    id: "task-requirements",
    category: "process",
    title: "Requirements",
    summary: "One change: who it is for, what done looks like, what is out.",
    source: "INVEST (Bill Wake) / Agile Alliance user-story criteria",
    stageTitle: "Requirements",
    stageRules: ["One slice, not a backlog dump", "Acceptance is testable", "No invented users"],
    sections: ["Who and why", "Acceptance", "Out of scope", "Ready to build"],
    tasks: [
      leaf("req-who", "Who and why", "The person this helps and the expensive thing today. Unknown if unknown."),
      leaf("req-accept", "Acceptance", "Two to five checks that would fail today and pass after. Testable, not slogans."),
      leaf("req-out", "Out of scope", "What this slice will not do. Split if it is bigger than one change."),
      leaf("req-ready", "Ready", "Independent of other unfinished work, or name the blocker."),
    ],
  }),
  taskSeed({
    id: "task-code-review",
    category: "quality",
    title: "Code review",
    summary: "Design, behavior, tests, then LGTM — one change.",
    source: "Google eng-practices — What to look for in a code review",
    stageTitle: "Code review",
    stageRules: ["Review this diff, not a wishlist", "Tests in the same change unless emergency", "No drive-by restyle"],
    sections: ["Design", "Behavior", "Tests", "LGTM"],
    tasks: [
      leaf("rev-design", "Design", "Does this belong here. Too generic or speculative? Smallest shape that works now."),
      leaf("rev-behavior", "Behavior", "Does it do what the author intended for real users. Edge cases named."),
      leaf("rev-tests", "Tests", "Will they fail if this change is broken. Same CL unless this is an emergency."),
      leaf("rev-lgtm", "LGTM or block", "Looks good, or the concrete defect. Nits do not block."),
    ],
  }),
  taskSeed({
    id: "task-test-plan",
    category: "quality",
    title: "Test plan",
    summary: "What we will prove for one change, and what we will not.",
    source: "Google testing blog / test pyramid — plan for one change",
    stageTitle: "Test plan",
    stageRules: ["Cases map to this change", "Pass/fail is observable", "No invented coverage numbers"],
    sections: ["In scope", "Cases", "Pass/fail", "Out of scope"],
    tasks: [
      leaf("tp-scope", "In scope", "The paths this change actually touches."),
      leaf("tp-cases", "Cases", "Happy path, one failure, one edge. From the code, not a generic matrix."),
      leaf("tp-pass", "Pass/fail", "What you will run and what green means. Command this repo has."),
      leaf("tp-out", "Out of scope", "What we are not testing and why. Unknown is allowed."),
    ],
  }),
  taskSeed({
    id: "task-rollback",
    category: "delivery",
    title: "Rollback",
    summary: "Undo a bad ship without making it worse.",
    source: "Google SRE — rollback to a known-good change",
    stageTitle: "Rollback",
    stageRules: ["Known-good is named", "Data compatibility is written", "Verify after undo"],
    sections: ["When", "How", "Data", "Verify"],
    tasks: [
      leaf("rb-when", "When to roll back", "The signal that means undo, not sit and watch."),
      leaf("rb-how", "How", "The revert, flag, or previous artifact this repo actually uses."),
      leaf("rb-data", "Data", "Migrations and writes that cannot go back. Unknown if untested."),
      leaf("rb-verify", "Verify", "Smoke or SLI after undo. What green looks like."),
    ],
  }),
  taskSeed({
    id: "task-ai-change",
    category: "quality",
    title: "AI change",
    summary: "Eval first: a few real cases, then the prompt/model/tooling change.",
    source: "Eval-driven development (OpenAI / Anthropic evaluation practice)",
    stageTitle: "AI change",
    stageRules: ["Cases before the prompt edit", "A handful of real examples, not a 50-step MLOps play", "Fail closed if evals are worse"],
    sections: ["Objective", "Cases", "Change", "Compare"],
    tasks: [
      leaf("ai-objective", "Objective", "What success looks like in one sentence. The user-visible failure today."),
      leaf("ai-cases", "Cases", "A handful of real inputs and expected properties from this product. No invented corpus."),
      leaf("ai-change", "Change", "The prompt, model id, or tool call this repo actually has. Nothing extra."),
      leaf("ai-compare", "Compare", "Run the cases before and after. Ship only if they hold or the miss is named."),
    ],
  }),
];
