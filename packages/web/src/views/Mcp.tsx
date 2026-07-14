import { McpSetup } from '@/components/mcp-setup';

export function McpView(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8 max-w-xl">
      <header className="pb-6 border-b">
        <h1 className="text-3xl font-semibold tracking-tight">MCP</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Cursor to Lotaru with the Model Context Protocol.
        </p>
      </header>
      <McpSetup />
    </div>
  );
}
