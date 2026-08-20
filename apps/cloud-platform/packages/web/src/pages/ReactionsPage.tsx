import { useParams } from "react-router-dom";
import { ProjectReactionsPanel } from "@/components/ProjectReactionsPanel";
import { PageHeader } from "@/components/layout/PageHeader";

export function ReactionsPage(): React.JSX.Element {
  const params = useParams();
  let projectId = "";
  if (typeof params["projectId"] === "string" && params["projectId"].length > 0) {
    projectId = params["projectId"];
  }
  if (projectId.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Open a project to configure reactions.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Reactions"
        subtitle="Turn catalog events into tasks — including voice intents from Listen."
      />
      <div className="flex-1 overflow-y-auto p-5">
        <ProjectReactionsPanel projectId={projectId} />
      </div>
    </div>
  );
}
