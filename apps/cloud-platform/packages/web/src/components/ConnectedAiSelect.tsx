import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { AiToolRow } from "@/lib/api";

export function connectedAiTools(tools: readonly AiToolRow[]): AiToolRow[] {
  const connected: AiToolRow[] = [];
  for (const tool of tools) {
    if (tool.connected !== true) {
      continue;
    }
    connected.push(tool);
  }
  return connected;
}

function staleAiOption(value: string, listed: readonly AiToolRow[]): string[] {
  if (value.length === 0) {
    return [];
  }
  for (const tool of listed) {
    if (tool.id === value) {
      return [];
    }
  }
  return [value];
}

type Props = {
  id: string;
  value: string;
  tools: readonly AiToolRow[];
  onChange(next: string): void;
};

export function ConnectedAiSelect(props: Props): React.JSX.Element {
  const listed = connectedAiTools(props.tools);
  const stale = staleAiOption(props.value, listed);
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>AI</Label>
      <Select
        id={props.id}
        required
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        <option value="">Choose a connected AI</option>
        {listed.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.label}
          </option>
        ))}
        {stale.map((toolId) => (
          <option key={toolId} value={toolId}>
            {toolId}
          </option>
        ))}
      </Select>
      {listed.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Connect an AI in Settings, then pick it here.
        </p>
      ) : null}
    </div>
  );
}
