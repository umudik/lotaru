import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ResizeHandle } from '@script/components/resize-handle';
import { useDragResize } from '@script/hooks/use-drag-resize';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyStatePanel } from '@/components/EmptyStatePanel';
import { PageContent } from '@/components/layout/PageContent';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@script/components/ui/switch';
import { ScriptTile } from '@script/components/script-tile';
import { ScriptDetailPanel } from '@script/components/script-detail-panel';
import { api } from '@script/api/client';
import { downloadProjectBundle, exportFileName } from '@script/lib/project-export';
import { BLANK_SCRIPT_BODY } from '@script/lib/project-templates';
import type { InspectTarget } from '@script/components/run-dots';
import { actions, useStore } from '@script/state/store';
import type { Script } from '@script/types';

type DetailTab = 'script' | 'logs';

function detailPanelWidth(open: boolean, size: number): number {
  if (open) {
    return size;
  }
  return 0;
}

interface Props {
  projectId: string;
  projectName: string;
}

const PENDING_SETTINGS = Object.freeze({
  project_id: '',
  paused: false,
  active_environment_id: null,
  created_at: 0,
});

export function ProjectScriptView(props: Props): React.JSX.Element {
  const settings = useStore((s) => s.settings) ?? PENDING_SETTINGS;
  const scripts = useStore((s) => s.scripts);
  const liveExec = useStore((s) => s.liveExecutions);
  const [creating, setCreating] = useState(false);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('script');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewportMaxDetail, setViewportMaxDetail] = useState(960);
  const detailResize = useDragResize({
    storageKey: 'script-workspace-detail-width',
    initial: 560,
    min: 400,
    max: viewportMaxDetail,
  });
  const [exporting, setExporting] = useState(false);

  const resetSelection = useCallback((): void => {
    setSelectedId(null);
    setInspect(null);
  }, []);

  useEffect(() => {
    resetSelection();
  }, [props.projectId, resetSelection]);

  useEffect(() => {
    function syncMax(): void {
      setViewportMaxDetail(Math.max(480, Math.floor(window.innerWidth * 0.78)));
    }
    syncMax();
    window.addEventListener('resize', syncMax);
    return () => {
      window.removeEventListener('resize', syncMax);
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    void actions.refreshExecutionsForScript(selectedId, 50);
  }, [selectedId]);

  let running = 0;
  for (const t of scripts) {
    for (const key of Object.keys(liveExec)) {
      const e = liveExec[key];
      if (e === undefined) {
        continue;
      }
      if (e.scriptId === t.id && e.status === 'running') {
        running += 1;
      }
    }
  }

  let selectedScript: Script | null = null;
  if (selectedId !== null) {
    for (const t of scripts) {
      if (t.id === selectedId) {
        selectedScript = t;
      }
    }
    if (selectedScript === null) {
      for (const key of Object.keys(liveExec)) {
        const e = liveExec[key];
        if (e === undefined) {
          continue;
        }
        if (e.scriptId === selectedId) {
          selectedScript = {
            id: selectedId,
            project_id: props.projectId,
            name: 'Script',
            command: '',
            runtime: 'shell',
            docker_image: '',
            docker_platform: '',
            trigger_type: 'manual',
            trigger_glob: '',
            trigger_cron: '',
            trigger_bus_event: '',
            concurrency: 'restart',
            enabled: true,
            created_at: Date.now(),
          };
        }
      }
    }
  }

  let inspectId: string | null = null;
  if (inspect !== null) {
    inspectId = inspect.executionId;
  }

  function selectScript(scriptId: string): void {
    if (selectedId === scriptId) {
      resetSelection();
      setDetailTab('script');
      return;
    }
    setSelectedId(scriptId);
    setInspect(null);
    setDetailTab('script');
  }

  function onInspect(target: InspectTarget): void {
    setSelectedId(target.scriptId);
    setInspect(target);
    setDetailTab('logs');
  }

  async function exportProject(): Promise<void> {
    setExporting(true);
    try {
      const bundle = await api.exportProject(props.projectId);
      downloadProjectBundle(bundle, exportFileName(props.projectName));
      toast.success('Project exported');
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function setProjectLive(live: boolean): Promise<void> {
    try {
      const r = live
        ? await api.resumeProject(props.projectId)
        : await api.pauseProject(props.projectId);
      actions.setSettings(r.settings);
      toast.success('Saved');
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  function adoptCreatedScript(script: Script): void {
    actions.upsertScript(script);
    setSelectedId(script.id);
    setInspect(null);
    setDetailTab('script');
  }

  async function createScript(): Promise<void> {
    setCreating(true);
    try {
      const r = await api.createScript(props.projectId, BLANK_SCRIPT_BODY);
      adoptCreatedScript(r.script);
      toast.success('Script created');
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  }

  let stateBadge: React.JSX.Element;
  if (settings.paused) {
    stateBadge = <Badge variant="warn">Paused</Badge>;
  } else if (running > 0) {
    stateBadge = <Badge variant="running">{`${String(running)} running`}</Badge>;
  } else {
    stateBadge = <Badge variant="success">Live</Badge>;
  }

  let detailOpen = false;
  if (selectedId !== null && selectedScript !== null) {
    detailOpen = true;
  }

  let detailBody: React.JSX.Element;
  if (selectedScript !== null) {
    detailBody = (
      <ScriptDetailPanel
        script={selectedScript}
        inspectId={inspectId}
        inspect={inspect}
        detailTab={detailTab}
        onDetailTabChange={setDetailTab}
        existingScriptNames={scripts.map((row) => row.name)}
        onInspect={onInspect}
        onCancelExecution={(id) => {
          void api.cancelExecution(id);
        }}
        onClosePanel={() => {
          resetSelection();
          setDetailTab('script');
        }}
        onDuplicated={(script) => {
          adoptCreatedScript(script);
        }}
        onDeleted={() => {
          resetSelection();
          setDetailTab('script');
        }}
      />
    );
  } else {
    detailBody = (
      <div className="flex items-center justify-center h-full p-6 text-sm text-muted-foreground text-center">
        Select a script tile to edit and browse run history.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Scripts"
        info="Scripts run in this project. Pause stops new runs. Open a tile to edit the command and browse run history."
        actions={
          <>
            {stateBadge}
            <div className="flex items-center gap-2">
              <Switch
                id="scripts-resume"
                checked={!settings.paused}
                onCheckedChange={(v) => {
                  void setProjectLive(v);
                }}
              />
              <label htmlFor="scripts-resume" className="text-sm text-muted-foreground whitespace-nowrap">
                Resume
              </label>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => {
                void exportProject();
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </Button>
            <Button
              type="button"
              onClick={() => {
                void createScript();
              }}
              disabled={creating}
              size="sm"
            >
              New script
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <PageContent>
          {scripts.length === 0 ? (
            <EmptyStatePanel
              plain
              title="No scripts yet"
              description="Create a script to run commands on this project. Pause the workspace when you want no new runs."
              action={
                <Button
                  type="button"
                  size="sm"
                  disabled={creating}
                  onClick={() => {
                    void createScript();
                  }}
                >
                  New script
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {scripts.map((t) => (
                <ScriptTile
                  key={t.id}
                  script={t}
                  selected={selectedId === t.id}
                  workspacePaused={settings.paused}
                  onSelect={() => {
                    selectScript(t.id);
                  }}
                />
              ))}
            </div>
          )}
        </PageContent>
        </div>

        {detailOpen && (
          <ResizeHandle
            onMouseDown={detailResize.onHandleMouseDown}
            active={detailResize.dragging}
          />
        )}

        <div
          className={cn(
            'shrink-0 bg-card/20 flex flex-col overflow-hidden',
            detailOpen && !detailResize.dragging && 'transition-[width] duration-200 ease-out',
          )}
          style={{ width: detailPanelWidth(detailOpen, detailResize.size) }}
        >
          {detailBody}
        </div>
      </div>
    </div>
  );
}
