import { toast } from 'sonner';
import { api } from '@script/api/client';
import { actions } from '@script/state/store';
import type { Script } from '@script/types';

export type UpdateScriptBody = Omit<Script, 'id' | 'project_id' | 'created_at'>;

export function buildScriptPatchBody(script: Script, partial: Partial<Script>): UpdateScriptBody {
  const merged: Script = Object.assign({}, script, partial);
  let glob = '';
  if (merged.trigger_type === 'save') {
    glob = merged.trigger_glob;
  }
  let busEvent = '';
  if (merged.trigger_type === 'event') {
    busEvent = merged.trigger_bus_event;
  }
  return {
    name: merged.name,
    command: merged.command,
    runtime: 'shell',
    docker_image: '',
    docker_platform: '',
    trigger_type: merged.trigger_type,
    trigger_glob: glob,
    trigger_bus_event: busEvent,
    trigger_cron: merged.trigger_cron,
    concurrency: merged.concurrency,
    enabled: merged.enabled,
  };
}

export async function patchScript(script: Script, partial: Partial<Script>): Promise<Script> {
  const body = buildScriptPatchBody(script, partial);
  const r = await api.updateScript(script.id, body);
  actions.upsertScript(r.script);
  toast.success('Saved');
  return r.script;
}
