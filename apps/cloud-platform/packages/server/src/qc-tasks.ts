export type TaskInboxLine = {
  id: number;
  title: string;
  parentId: number | null;
  stageId: string | null;
  claimedBy: string | null;
  workStatus: string | null;
};

export type QcEpicPick = {
  id: number;
  parentId: number | null;
  title: string;
  createdAt: string;
};

export function qcTitleHasPrefix(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 3) {
    return false;
  }
  if (trimmed.startsWith("QC ") !== true) {
    return false;
  }
  return true;
}

export function ensureQcTitle(title: string, slug: string): string {
  const trimmed = title.trim();
  if (slug !== "qc") {
    return trimmed;
  }
  if (qcTitleHasPrefix(trimmed) === true) {
    return trimmed;
  }
  if (trimmed.length === 0) {
    return "QC gate";
  }
  return `QC ${trimmed}`;
}

export function pickLatestQcEpic(tasks: readonly QcEpicPick[]): QcEpicPick | null {
  const hits: QcEpicPick[] = [];
  for (const task of tasks) {
    if (task.parentId !== null) {
      continue;
    }
    if (qcTitleHasPrefix(task.title) !== true) {
      continue;
    }
    hits.push(task);
  }
  if (hits.length === 0) {
    return null;
  }
  const ranked = hits.slice().sort((left, right) => {
    if (left.createdAt < right.createdAt) {
      return 1;
    }
    if (left.createdAt > right.createdAt) {
      return -1;
    }
    return 0;
  });
  const latest = ranked[0];
  if (latest === undefined) {
    return null;
  }
  return latest;
}

export type QcStageLock = {
  id: string;
  position: number;
};

export type QcWorkRow = {
  id: number;
  title: string;
  parentId: number | null;
  epicId: number | null;
  stageId: string | null;
  workStatus: string | null;
};

function childBelongsToEpic(child: QcWorkRow, epicId: number): boolean {
  if (child.epicId === epicId) {
    return true;
  }
  if (child.parentId === epicId) {
    return true;
  }
  return false;
}

function workRowIsOpen(row: QcWorkRow): boolean {
  if (row.workStatus === "done") {
    return false;
  }
  return true;
}

export function pickActiveQcStageOpenIds(
  epicId: number,
  stages: readonly QcStageLock[],
  tasks: readonly QcWorkRow[],
): number[] {
  const ordered = stages.slice().toSorted((left, right) => left.position - right.position);
  const children: QcWorkRow[] = [];
  for (const row of tasks) {
    if (row.parentId === null) {
      continue;
    }
    if (childBelongsToEpic(row, epicId) !== true) {
      continue;
    }
    children.push(row);
  }
  for (const stage of ordered) {
    const openIds: number[] = [];
    let spawnedOnStage = 0;
    for (const child of children) {
      if (child.stageId !== stage.id) {
        continue;
      }
      spawnedOnStage += 1;
      if (workRowIsOpen(child) !== true) {
        continue;
      }
      openIds.push(child.id);
    }
    if (openIds.length > 0) {
      return openIds;
    }
    if (spawnedOnStage === 0) {
      return [];
    }
  }
  return [];
}

export function formatTaskInbox(lines: readonly TaskInboxLine[]): string {
  if (lines.length === 0) {
    return "";
  }
  const out: string[] = [
    "OPEN TASKS (inbox → claim → work → complete; AI output is not shipped until complete):",
  ];
  for (const line of lines) {
    let claim = "unclaimed";
    if (line.claimedBy !== null && line.claimedBy.length > 0) {
      claim = `claimed:${line.claimedBy}`;
    }
    let stage = "no-stage";
    if (line.stageId !== null && line.stageId.length > 0) {
      stage = line.stageId;
    }
    let kind = "epic";
    if (line.parentId !== null) {
      kind = "subtask";
    }
    let status = "todo";
    if (line.workStatus !== null && line.workStatus.length > 0) {
      status = line.workStatus;
    }
    out.push(`- #${String(line.id)} [${kind}/${stage}/${status}/${claim}] ${line.title}`);
  }
  return out.join("\n");
}
