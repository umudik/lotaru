import { z } from "zod";
import {
  deleteWorkflowStageRow,
  insertWorkflowStageRow,
  listWorkflowStageRows,
} from "../../../../task-bridge/apps/backend/dist/db/workflow-db.js";
import { countSpawnableTemplates } from "../../../../task-bridge/apps/backend/dist/domain/task-template-graph.js";
import {
  serializeTaskTemplates,
  type StageTaskTemplate,
} from "../../../../task-bridge/apps/backend/dist/domain/workflow-stage.js";
import { cachedSqlite } from "./sqlite-cache.js";
import type { MarketplaceCatalogItem, MarketplaceTaskNode } from "./marketplace-catalog.js";

const installRowSchema = z.object({
  marketplace_id: z.string().min(1),
  stage_id: z.string().min(1),
});

const marketplaceIdRowSchema = z.object({
  marketplace_id: z.string().min(1),
});

function openTaskInstallDb(databasePath: string) {
  return cachedSqlite("marketplace-tasks", databasePath, (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_task_installs (
        project_id TEXT NOT NULL,
        marketplace_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        PRIMARY KEY (project_id, marketplace_id)
      );
    `);
  });
}

function stageIdFor(marketplaceId: string): string {
  const trimmed = marketplaceId.trim();
  if (trimmed.length === 0) {
    throw new Error("marketplace id required");
  }
  return `mkt-${trimmed}`;
}

function toStageTask(node: MarketplaceTaskNode): StageTaskTemplate {
  const children: StageTaskTemplate[] = [];
  for (const child of node.children) {
    children.push(toStageTask(child));
  }
  return {
    id: node.id,
    title: node.title,
    description: node.description,
    assigneeRole: null,
    dependsOn: [],
    children,
  };
}

function nextStagePosition(projectId: string): number {
  const rows = listWorkflowStageRows({ projectId, stageId: "" });
  let maxPosition = -1;
  for (const row of rows) {
    if (row.position > maxPosition) {
      maxPosition = row.position;
    }
  }
  return maxPosition + 1;
}

export function listMarketplaceTaskIds(databasePath: string, projectId: string): string[] {
  const db = openTaskInstallDb(databasePath);
  const raw = db
    .prepare("SELECT marketplace_id FROM marketplace_task_installs WHERE project_id = ?")
    .all(projectId);
  const ids: string[] = [];
  if (Array.isArray(raw) !== true) {
    return ids;
  }
  for (const entry of raw) {
    const parsed = marketplaceIdRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    ids.push(parsed.data.marketplace_id);
  }
  return ids;
}

export function findMarketplaceTask(
  databasePath: string,
  projectId: string,
  marketplaceId: string,
): { marketplaceId: string; stageId: string } | null {
  const trimmed = marketplaceId.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const db = openTaskInstallDb(databasePath);
  const parsed = installRowSchema.safeParse(
    db
      .prepare(
        "SELECT marketplace_id, stage_id FROM marketplace_task_installs WHERE project_id = ? AND marketplace_id = ?",
      )
      .get(projectId, trimmed),
  );
  if (parsed.success !== true) {
    return null;
  }
  return { marketplaceId: parsed.data.marketplace_id, stageId: parsed.data.stage_id };
}

export function insertMarketplaceTask(input: {
  databasePath: string;
  projectId: string;
  item: MarketplaceCatalogItem;
}): { marketplaceId: string; stageId: string } {
  const existing = findMarketplaceTask(input.databasePath, input.projectId, input.item.id);
  if (existing !== null) {
    return existing;
  }
  if (input.item.taskNodes.length === 0) {
    throw new Error("task pack needs tasks");
  }
  const stageId = stageIdFor(input.item.id);
  const already = listWorkflowStageRows({ projectId: input.projectId, stageId });
  if (already.length > 0) {
    const db = openTaskInstallDb(input.databasePath);
    db.prepare(
      "INSERT INTO marketplace_task_installs (project_id, marketplace_id, stage_id) VALUES (?, ?, ?)",
    ).run(input.projectId, input.item.id, stageId);
    return { marketplaceId: input.item.id, stageId };
  }
  const nodes: StageTaskTemplate[] = [];
  for (const node of input.item.taskNodes) {
    nodes.push(toStageTask(node));
  }
  insertWorkflowStageRow({
    id: stageId,
    projectId: input.projectId,
    title: input.item.stageTitle,
    description: input.item.summary,
    purpose: input.item.stageTitle,
    rulesJson: JSON.stringify(input.item.stageRules.slice()),
    position: nextStagePosition(input.projectId),
    autoAssignRole: "",
    layoutX: null,
    layoutY: null,
    spawnTaskCount: countSpawnableTemplates(nodes),
    taskTemplatesJson: serializeTaskTemplates(nodes),
  });
  const db = openTaskInstallDb(input.databasePath);
  db.prepare(
    "INSERT INTO marketplace_task_installs (project_id, marketplace_id, stage_id) VALUES (?, ?, ?)",
  ).run(input.projectId, input.item.id, stageId);
  return { marketplaceId: input.item.id, stageId };
}

export function deleteMarketplaceTask(
  databasePath: string,
  projectId: string,
  marketplaceId: string,
): { marketplaceId: string; stageId: string } | null {
  const existing = findMarketplaceTask(databasePath, projectId, marketplaceId);
  if (existing === null) {
    return null;
  }
  deleteWorkflowStageRow(projectId, existing.stageId);
  const db = openTaskInstallDb(databasePath);
  db.prepare(
    "DELETE FROM marketplace_task_installs WHERE project_id = ? AND marketplace_id = ?",
  ).run(projectId, existing.marketplaceId);
  return existing;
}
