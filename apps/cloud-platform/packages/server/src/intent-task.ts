import {
  allocateTaskId,
  upsertBridgeTask,
} from "../../../../task-bridge/apps/backend/dist/services/task-service.js";
import { createEpicRecords } from "../../../../task-bridge/apps/backend/dist/services/workflow-state-service.js";
import { spawnEpicWorkflow, syncEpicStage } from "../../../../task-bridge/apps/backend/dist/services/epic-service.js";
import { resolveNewTaskPlacement } from "../../../../task-bridge/apps/backend/dist/services/workflow-service.js";
import { getProjectById } from "../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { emitTaskCreated } from "./project-events.js";

/** Shared path for anything that turns a bus event into a task. */
export function createProjectTask(input: {
  projectId: string;
  title: string;
  description: string;
  createdBy: string;
}): number {
  const project = getProjectById(input.projectId);
  if (project === null) {
    throw new Error("Unknown project");
  }
  const placement = resolveNewTaskPlacement(project.id);
  const id = allocateTaskId();
  createEpicRecords({
    id,
    projectId: project.id,
    title: input.title,
    description: input.description,
    stageId: placement.stageId,
    createdBy: input.createdBy,
  });
  const epic = upsertBridgeTask({
    id,
    projectId: project.id,
    projectName: project.name,
    title: input.title,
    description: input.description,
    createdBy: input.createdBy,
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
  emitTaskCreated({
    projectId: project.id,
    taskId: epic.id,
    title: input.title,
  });
  return epic.id;
}

