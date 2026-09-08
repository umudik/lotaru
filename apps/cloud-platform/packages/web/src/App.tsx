import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { TasksPage } from "@/pages/TasksPage";
import { TaskPage } from "@/pages/TaskPage";
import { ScriptFeature } from "@/features/script/ScriptFeature";
import { KnowledgeFeature } from "@/features/knowledge/KnowledgeFeature";
import { NotesFeature } from "@/features/notes/NotesFeature";
import { AgentsFeature } from "@/features/agents/AgentsFeature";
import { RulesFeature } from "@/features/rules/RulesFeature";
import { TerminalFeature } from "@/features/terminal/TerminalFeature";
import { VoiceListenProvider } from "@/features/voice/VoiceListenContext";
import { SettingsPage } from "@/pages/SettingsPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { EventsPage } from "@/pages/EventsPage";
import { VoicePage } from "@/pages/VoicePage";
import { WorkflowPage } from "@/pages/WorkflowPage";
import { MarketplacePage } from "@/pages/MarketplacePage";
import { loadSession } from "@/lib/session";

export function App() {
  return (
    <div className="h-full">
      <VoiceListenProvider>
        <Routes>
        <Route element={<AppLayout />}>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<ProjectIndexRedirect />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="tasks/workflow" element={<LegacyPipelineRedirect />} />
            <Route path="pipeline" element={<WorkflowPage />} />
            <Route path="rules" element={<ProjectRulesRoute />} />
            <Route path="agents" element={<ProjectAgentsRoute />} />
            <Route path="chat" element={<LegacyRulesRedirect />} />
            <Route path="terminal" element={<ProjectTerminalRoute />} />
            <Route path="tasks/:taskId" element={<TaskPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="logs" element={<EventsPage />} />
            <Route path="events" element={<LegacyLogsRedirect />} />
            <Route path="voice" element={<ProjectVoiceRoute />} />
            <Route path="scripts/*" element={<ProjectScriptsRoute />} />
            <Route path="notes/*" element={<ProjectNotesRoute />} />
            <Route path="knowledge/*" element={<ProjectKnowledgeRoute />} />
            <Route path="marketplace" element={<MarketplacePage />} />
          </Route>
        </Route>
        <Route path="/setup" element={<Navigate to="/projects" replace />} />
        <Route path="/login" element={<Navigate to="/projects" replace />} />
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      </VoiceListenProvider>
    </div>
  );
}

function LegacyLogsRedirect(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <Navigate to={`/projects/${projectId}/logs`} replace />;
}

function LegacyPipelineRedirect(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <Navigate to={`/projects/${projectId}/pipeline`} replace />;
}

function ProjectIndexRedirect(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <Navigate to={`/projects/${projectId}/tasks`} replace />;
}

function ProjectScriptsRoute(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  const session = loadSession();
  let projectName = projectId;
  if (session.projectId === projectId && session.projectName !== null) {
    projectName = session.projectName;
  }
  return <ScriptFeature projectId={projectId} projectName={projectName} />;
}

function ProjectKnowledgeRoute(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <KnowledgeFeature projectId={projectId} />;
}

function ProjectNotesRoute(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <NotesFeature projectId={projectId} />;
}

function ProjectAgentsRoute(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <AgentsFeature projectId={projectId} />;
}

function ProjectRulesRoute(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <RulesFeature projectId={projectId} />;
}

function LegacyRulesRedirect(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <Navigate to={`/projects/${projectId}/rules`} replace />;
}

function ProjectTerminalRoute(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <TerminalFeature projectId={projectId} />;
}

function ProjectVoiceRoute(): React.JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined) {
    return <Navigate to="/projects" replace />;
  }
  return <VoicePage projectId={projectId} />;
}
