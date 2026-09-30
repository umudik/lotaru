import {
  allocateTaskId,
  listBridgeTasksForProject,
  upsertBridgeTask,
} from "../../../../task-bridge/apps/backend/dist/services/task-service.js";
import { completeBridgeTask } from "../../../../task-bridge/apps/backend/dist/services/task-context-service.js";
import { createEpicRecords } from "../../../../task-bridge/apps/backend/dist/services/workflow-state-service.js";
import { spawnEpicWorkflow, syncEpicStage } from "../../../../task-bridge/apps/backend/dist/services/epic-service.js";
import { resolveNewTaskPlacement } from "../../../../task-bridge/apps/backend/dist/services/workflow-service.js";
import { getProjectById } from "../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { emitTaskCreated } from "./project-events.js";
import { pickActiveQcStageOpenIds, pickLatestQcEpic, type QcWorkRow } from "./qc-tasks.js";
import { listWorkflowStageRows } from "../../../../task-bridge/apps/backend/dist/db/workflow-db.js";

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

function workflowStageLocks(projectId: string): { id: string; position: number }[] {
  const rows = listWorkflowStageRows({ projectId, stageId: "" });
  const locks: { id: string; position: number }[] = [];
  for (const row of rows) {
    locks.push({
      id: row.id,
      position: row.position,
    });
  }
  return locks;
}

function asQcWorkRows(tasks: ReturnType<typeof listBridgeTasksForProject>): QcWorkRow[] {
  const rows: QcWorkRow[] = [];
  for (const task of tasks) {
    rows.push({
      id: task.id,
      title: task.title,
      parentId: task.parentId,
      epicId: task.epicId,
      stageId: task.stageId,
      workStatus: task.workStatus,
    });
  }
  return rows;
}

export function closeOpenQcTasks(input: {
  projectId: string;
  by: string;
  summary: string;
}): number {
  const tasks = listBridgeTasksForProject(input.projectId);
  const epic = pickLatestQcEpic(tasks);
  if (epic === null) {
    return 0;
  }
  const openIds = pickActiveQcStageOpenIds(epic.id, workflowStageLocks(input.projectId), asQcWorkRows(tasks));
  let closed = 0;
  for (const openId of openIds) {
    const result = completeBridgeTask(openId, {
      by: input.by,
      summary: input.summary,
      prUrl: null,
    });
    if (result === null) {
      break;
    }
    closed += 1;
  }
  return closed;
}

export function openOrNudgeQcTask(input: {
  projectId: string;
  title: string;
  description: string;
  createdBy: string;
  slug: string;
}): number {
  if (input.slug !== "qc") {
    return createProjectTask({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      createdBy: input.createdBy,
    });
  }
  const tasks = listBridgeTasksForProject(input.projectId);
  const epic = pickLatestQcEpic(tasks);
  if (epic !== null) {
    const openIds = pickActiveQcStageOpenIds(epic.id, workflowStageLocks(input.projectId), asQcWorkRows(tasks));
    if (openIds.length > 0) {
      const firstId = openIds[0];
      if (firstId !== undefined) {
        let nudgeTitle = input.title;
        for (const row of tasks) {
          if (row.id === firstId) {
            nudgeTitle = row.title;
            break;
          }
        }
        emitTaskCreated({
          projectId: input.projectId,
          taskId: firstId,
          title: nudgeTitle,
        });
        return firstId;
      }
    }
  }
  return createProjectTask({
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    createdBy: input.createdBy,
  });
}

