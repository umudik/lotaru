import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { StageInspectorPanel } from "@/components/workflow/StageInspectorPanel";
import { WorkflowCanvas } from "@/components/workflow/WorkflowCanvas";
import { WorkflowInspectorSidebar } from "@/components/workflow/WorkflowInspectorSidebar";
import {
  addChildTemplate,
  createStageTaskTemplate,
  createSubtaskTemplate,
  findTemplateInTree,
  moveTemplateAmongSiblings,
} from "@/components/workflow/template-graph-utils";
import {
  createEmptyStage,
  insertStageAt,
  moveStageBy,
  syncStageTemplates,
} from "@/components/workflow/workflow-utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { fetchProjectWorkflow, saveProjectWorkflow, type WorkflowStage } from "@/lib/api";

export function WorkflowPage() {
  const params = useParams();
  let projectId = "";
  if (typeof params["projectId"] === "string" && params["projectId"].length > 0) {
    projectId = params["projectId"];
  }
  const session = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [editorIndex, setEditorIndex] = useState<number | null>(null);
  const [selectedTaskTemplateId, setSelectedTaskTemplateId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPulse, setSidebarPulse] = useState(0);
  const sidebarPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(async () => {
    if (!session || !projectId) return;
    setLoading(true);
    try {
      const workflow = await fetchProjectWorkflow(session, projectId);
      setStages(workflow.stages);
      setDirty(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, [session, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return () => {
      if (sidebarPulseTimerRef.current) clearTimeout(sidebarPulseTimerRef.current);
    };
  }, []);

  function revealSidebar() {
    if (sidebarPulseTimerRef.current) clearTimeout(sidebarPulseTimerRef.current);
    setSidebarOpen(false);
    sidebarPulseTimerRef.current = setTimeout(() => {
      setSidebarOpen(true);
      setSidebarPulse((value) => value + 1);
      sidebarPulseTimerRef.current = null;
    }, 130);
  }

  function markDirty(next: WorkflowStage[]) {
    setStages(next.slice().sort((a, b) => a.position - b.position));
    setDirty(true);
  }

  function selectNewStage(next: WorkflowStage[], index: number, taskTemplateId: string | null = null) {
    markDirty(next);
    setEditorIndex(index);
    setSelectedTaskTemplateId(taskTemplateId);
    revealSidebar();
  }

  function addStageAtEnd() {
    const next = stages.concat([createEmptyStage(stages.length)]);
    selectNewStage(next, next.length - 1);
  }

  function insertStageAfter(afterIndex: number) {
    const stage = createEmptyStage(afterIndex + 1);
    const next = insertStageAt(stages, afterIndex, stage);
    selectNewStage(next, afterIndex + 1);
  }

  function moveStage(index: number, delta: -1 | 1) {
    const next = moveStageBy(stages, index, delta);
    if (next === stages) return;
    markDirty(next);
    const target = index + delta;
    setEditorIndex(target);
  }

  async function handleSaveStages() {
    if (!session) return;
    setSaving(true);
    try {
      const workflow = await saveProjectWorkflow(session, projectId, { stages, roles: [] });
      setStages(workflow.stages);
      setDirty(false);
      toast.success("Pipeline saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save pipeline");
    } finally {
      setSaving(false);
    }
  }

  function updateStageAt(index: number, stage: WorkflowStage) {
    markDirty(stages.map((item, idx) => (idx === index ? syncStageTemplates(stage) : item)));
  }

  function removeStageAt(index: number) {
    if (stages.length <= 1) {
      toast.error("At least one pipeline step is required");
      return;
    }
    const stage = stages[index];
    if (!stage) {
      return;
    }
    const activeTasks = stage.activeTaskCount !== null ? stage.activeTaskCount : 0;
    if (activeTasks > 0) {
      toast.error(
        activeTasks === 1
          ? "1 task is on this step and it cannot be deleted"
          : `${activeTasks} tasks are on this step and it cannot be deleted`,
      );
      return;
    }
    markDirty(
      stages.filter((_, idx) => idx !== index).map((stage, position) => Object.assign({}, stage, { position })),
    );
    setEditorIndex(null);
    setSelectedTaskTemplateId(null);
    setSidebarOpen(false);
  }

  let editingStage: WorkflowStage | null = null;
  if (editorIndex !== null && editorIndex >= 0 && editorIndex < stages.length) {
    const stageAtIndex = stages[editorIndex];
    if (stageAtIndex) {
      editingStage = stageAtIndex;
    }
  }

  function setStageBySortedIndex(sortedIndex: number | null, taskTemplateId: string | null = null) {
    if (sortedIndex === null) {
      setEditorIndex(null);
      setSelectedTaskTemplateId(null);
      return;
    }
    const sorted = stages.slice().sort((a, b) => a.position - b.position);
    const stage = sorted[sortedIndex];
    if (!stage) return;
    const index = stages.findIndex((item) => item.id === stage.id);
    setEditorIndex(index >= 0 ? index : null);
    setSelectedTaskTemplateId(taskTemplateId);
  }

  function selectFromCanvas(sortedIndex: number, taskTemplateId: string | null = null) {
    setStageBySortedIndex(sortedIndex, taskTemplateId);
    revealSidebar();
  }

  function closeInspector() {
    setEditorIndex(null);
    setSelectedTaskTemplateId(null);
    setSidebarOpen(false);
  }

  function stageAtSortedIndex(sortedIndex: number) {
    const sorted = stages.slice().sort((a, b) => a.position - b.position);
    const stage = sorted[sortedIndex];
    if (!stage) return null;
    const index = stages.findIndex((item) => item.id === stage.id);
    if (index < 0) return null;
    return { stage, index };
  }

  function addStageTask(sortedIndex: number) {
    const entry = stageAtSortedIndex(sortedIndex);
    if (!entry) return;
    const templates = entry.stage.taskTemplates;
    const created = createStageTaskTemplate(entry.stage.title, templates.length);
    const next = stages.map((item, idx) =>
      idx === entry.index
        ? syncStageTemplates(Object.assign({}, item, { taskTemplates: templates.concat([created]) }))
        : item,
    );
    selectNewStage(next, entry.index, created.id);
  }

  function moveTaskTemplate(sortedIndex: number, templateId: string, delta: -1 | 1) {
    const entry = stageAtSortedIndex(sortedIndex);
    if (!entry) return;
    const templates = entry.stage.taskTemplates;
    const next = stages.map((item, idx) =>
      idx === entry.index
        ? syncStageTemplates(
            Object.assign({}, item, {
              taskTemplates: moveTemplateAmongSiblings(templates, templateId, delta),
            }),
          )
        : item,
    );
    markDirty(next);
  }

  function addSubtask(sortedIndex: number, parentTemplateId: string) {
    const entry = stageAtSortedIndex(sortedIndex);
    if (!entry) return;
    const templates = entry.stage.taskTemplates;
    const parent = findTemplateInTree(templates, parentTemplateId);
    if (!parent) return;
    const created = createSubtaskTemplate(parent.template.title, parent.template.children.length);
    const next = stages.map((item, idx) =>
      idx === entry.index
        ? syncStageTemplates(
            Object.assign({}, item, {
              taskTemplates: addChildTemplate(templates, parentTemplateId, created),
            }),
          )
        : item,
    );
    selectNewStage(next, entry.index, created.id);
  }

  if (!session) return null;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        title="Pipeline"
        actions={
          <>
            {dirty ? (
              <span className="rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-xs font-medium text-warn">
                Unsaved changes
              </span>
            ) : null}
            <Button onClick={() => void handleSaveStages()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save pipeline
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <WorkflowCanvas
          className="min-h-0 flex-1"
          stages={stages}
          selectedStageId={editingStage !== null ? editingStage.id : null}
          selectedTaskTemplateId={selectedTaskTemplateId}
          onAddStage={addStageAtEnd}
          onInsertStageAfter={insertStageAfter}
          onMoveStage={moveStage}
          onSelectStage={(flowIndex) => selectFromCanvas(flowIndex, null)}
          onSelectTaskTemplate={(flowIndex, templateId) => selectFromCanvas(flowIndex, templateId)}
          onAddStageTask={(flowIndex) => addStageTask(flowIndex)}
          onAddSubtask={(flowIndex, parentId) => addSubtask(flowIndex, parentId)}
          onMoveTaskTemplate={(flowIndex, templateId, delta) => moveTaskTemplate(flowIndex, templateId, delta)}
        />
        <WorkflowInspectorSidebar
          open={sidebarOpen && (editingStage !== null || selectedTaskTemplateId !== null)}
          pulseKey={sidebarPulse}
          onOpenChange={(next) => {
            if (!next) closeInspector();
            else if (editingStage) setSidebarOpen(true);
          }}
        >
          {editingStage ? (
            <StageInspectorPanel
              stage={editingStage}
              stageCount={stages.length}
              selectedTaskTemplateId={selectedTaskTemplateId}
              onChange={(stage) => {
                if (editorIndex === null) return;
                updateStageAt(editorIndex, stage);
              }}
              onSelectTaskTemplate={setSelectedTaskTemplateId}
              onDeleteStage={() => {
                if (editorIndex === null) return;
                removeStageAt(editorIndex);
              }}
              onClose={closeInspector}
            />
          ) : null}
        </WorkflowInspectorSidebar>
      </div>
    </div>
  );
}
