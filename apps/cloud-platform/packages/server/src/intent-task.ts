import {
  allocateTaskId,
  upsertBridgeTask,
} from "../../../../task-bridge/apps/backend/dist/services/task-service.js";
import { createEpicRecords } from "../../../../task-bridge/apps/backend/dist/services/workflow-state-service.js";
import { spawnEpicWorkflow, syncEpicStage } from "../../../../task-bridge/apps/backend/dist/services/epic-service.js";
import { resolveNewTaskPlacement } from "../../../../task-bridge/apps/backend/dist/services/workflow-service.js";
import { getProjectById } from "../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import type { LotaruEvent } from "./events.js";
import { fillReactionTitle, type TaskReaction } from "./reactions.js";

export function createIntentTask(event: LotaruEvent, reaction: TaskReaction): number {
  const project = getProjectById(event.projectId);
  if (project === null) {
    throw new Error("Unknown project");
  }
  const title = fillReactionTitle(reaction.titleTemplate, event);
  const description = `${event.type}\n${event.path}\n${event.detail}`;
  const placement = resolveNewTaskPlacement(project.id);
  const id = allocateTaskId();
  createEpicRecords({
    id,
    projectId: project.id,
    title,
    description,
    stageId: placement.stageId,
    createdBy: "lotaru",
  });
  const epic = upsertBridgeTask({
    id,
    projectId: project.id,
    projectName: project.name,
    title,
    description,
    createdBy: "lotaru",
    createdAt: null,
    stageId: placement.stageId,
    assignee: placement.assignee,
    assigneeRole: null,
    assigneeKind: null,
    parentId: null,
    epicId: null,
    templateId: null,
    workStatus: "todo",
  });
  spawnEpicWorkflow(epic);
  syncEpicStage(epic.id);
  return epic.id;
}
