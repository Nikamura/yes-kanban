import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/ui/components/ui/button";
import { BoardView } from "./components/BoardView";
import { ProjectSelector } from "./components/ProjectSelector";
import { CreateProjectDialog } from "./components/CreateProjectDialog";
import { SettingsView } from "./components/SettingsView";
import { ListView } from "./components/ListView";
import { DashboardView } from "./components/DashboardView";
import { ActivityFeed } from "./components/ActivityFeed";
import { ArchiveView } from "./components/ArchiveView";
import { useNotifications } from "./hooks/useNotifications";
import type { Id } from "../../convex/_generated/dataModel";

type View = "board" | "list" | "dashboard" | "settings" | "activity" | "archive";

const VALID_VIEWS = new Set<string>(["board", "list", "dashboard", "settings", "activity", "archive"]);

interface HashState {
  slug: string | null;
  view: View;
  issueSimpleId: string | null;
  workspaceId: string | null;
}

function parseHash(): HashState {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/");
  const slug = parts[0] ?? null;
  const viewPart = parts[1] ?? "board";
  const view = VALID_VIEWS.has(viewPart) ? (viewPart as View) : "board";
  const issueSimpleId = parts[2] && parts[2].length > 0 ? parts[2] : null;
  // parts[3] should be "ws", parts[4] is the workspace ID
  const workspaceId = parts[3] === "ws" && parts[4] ? parts[4] : null;
  return { slug: slug && slug.length > 0 ? slug : null, view, issueSimpleId, workspaceId };
}

function buildHash(slug: string | null, view: View, issueSimpleId?: string | null, workspaceId?: string | null): string {
  if (!slug) return "";
  let hash = `#/${slug}/${view}`;
  if (issueSimpleId) {
    hash += `/${issueSimpleId}`;
    if (workspaceId) {
      hash += `/ws/${workspaceId}`;
    }
  }
  return hash;
}

export function App() {
  const projects = useQuery(api.projects.list);
  const dispatchStatus = useQuery(api.dispatch.status);

  // Initialize from hash
  const initialHash = parseHash();
  const [view, setView] = useState<View>(() => initialHash.view);
  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [resolved, setResolved] = useState(false);

  // Modal state synced to URL
  const [activeIssueSimpleId, setActiveIssueSimpleId] = useState<string | null>(() => initialHash.issueSimpleId);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => initialHash.workspaceId);

  // Notifications: subscribe to workspace statuses for the selected project
  const workspaceStatuses = useQuery(
    api.workspaces.latestByProject,
    selectedProjectId ? { projectId: selectedProjectId } : "skip"
  );
  const notificationIssues = useQuery(
    api.issues.list,
    selectedProjectId ? { projectId: selectedProjectId } : "skip"
  );
  useNotifications(workspaceStatuses, notificationIssues);

  // Resolve project from hash slug once projects load
  // Using setState-during-render pattern (synchronous, before first paint)
  if (projects && projects.length > 0 && !selectedProjectId && !resolved) {
    const { slug } = parseHash();
    const match = slug ? projects.find((p) => p.slug === slug) : null;
    const project = match ?? projects[0];
    if (project) {
      setSelectedProjectId(project._id);
      if (!match) {
        window.history.replaceState(null, "", buildHash(project.slug, view));
      }
    }
    setResolved(true);
  }

  // Reset if selected project was deleted
  const selectedProject = projects?.find((p) => p._id === selectedProjectId);
  if (resolved && selectedProjectId && projects && !selectedProject) {
    const fallback = projects[0];
    if (fallback) {
      setSelectedProjectId(fallback._id);
      setView("board");
    } else {
      setSelectedProjectId(null);
    }
  }

  // Callbacks for child components to update modal state
  const openIssue = useCallback((simpleId: string) => {
    setActiveIssueSimpleId(simpleId);
    setActiveWorkspaceId(null);
  }, []);

  const closeIssue = useCallback(() => {
    setActiveIssueSimpleId(null);
    setActiveWorkspaceId(null);
  }, []);

  const openWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
  }, []);

  const closeWorkspace = useCallback(() => {
    setActiveWorkspaceId(null);
  }, []);

  // Update URL hash when view, project, or modal state changes
  useEffect(() => {
    if (!resolved || !selectedProject) return;
    const newHash = buildHash(selectedProject.slug, view, activeIssueSimpleId, activeWorkspaceId);
    if (window.location.hash !== newHash) {
      window.history.pushState(null, "", newHash);
    }
  }, [view, selectedProject, resolved, activeIssueSimpleId, activeWorkspaceId]);

  // Listen for browser back/forward
  const handlePopState = useCallback(() => {
    if (!projects) return;
    const { slug, view: hashView, issueSimpleId, workspaceId } = parseHash();
    if (slug) {
      const match = projects.find((p) => p.slug === slug);
      if (match) {
        setSelectedProjectId(match._id);
        setView(hashView);
        setActiveIssueSimpleId(issueSimpleId);
        setActiveWorkspaceId(workspaceId);
      }
    }
  }, [projects]);

  useEffect(() => {
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [handlePopState]);

  // Show nothing until projects load to avoid "No project" flash
  if (!projects) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-left">
            <h1 className="app-title">Yes Kanban</h1>
          </div>
        </header>
        <main className="app-main">
          <div className="loading">Loading...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <ProjectSelector
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onCreateNew={() => setShowCreateProject(true)}
      />

      <div className="app-body">
        <header className="app-header">
          <div className="header-left">
            <h1 className="app-title" onClick={() => { setView("board"); closeIssue(); }} style={{ cursor: "pointer" }}>Yes Kanban</h1>
          </div>
          {dispatchStatus && (
            <span
              className="worker-status-dot"
              title={dispatchStatus.workerConnected ? "Worker connected" : "Worker disconnected"}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                display: "inline-block",
                backgroundColor: dispatchStatus.workerConnected ? "#10b981" : "#ef4444",
                marginRight: 8,
                flexShrink: 0,
              }}
            />
          )}
          <nav className="header-nav">
            <button
              className={`nav-btn ${view === "board" ? "active" : ""}`}
              onClick={() => { setView("board"); closeIssue(); }}
            >
              Board
            </button>
            <button
              className={`nav-btn ${view === "list" ? "active" : ""}`}
              onClick={() => { setView("list"); closeIssue(); }}
            >
              List
            </button>
            <button
              className={`nav-btn ${view === "activity" ? "active" : ""}`}
              onClick={() => { setView("activity"); closeIssue(); }}
            >
              Activity
            </button>
            <button
              className={`nav-btn ${view === "archive" ? "active" : ""}`}
              onClick={() => { setView("archive"); closeIssue(); }}
            >
              Archive
            </button>
            <button
              className={`nav-btn ${view === "dashboard" ? "active" : ""}`}
              onClick={() => { setView("dashboard"); closeIssue(); }}
            >
              Dashboard
            </button>
            <button
              className={`nav-btn ${view === "settings" ? "active" : ""}`}
              onClick={() => { setView("settings"); closeIssue(); }}
            >
              Settings
            </button>
          </nav>
        </header>

        <main className="app-main">
          {!selectedProjectId ? (
            <div className="empty-state">
              <h2>No project selected</h2>
              <p>Create a project to get started.</p>
              <Button onClick={() => setShowCreateProject(true)}>Create Project</Button>
            </div>
          ) : view === "board" ? (
            <BoardView
              projectId={selectedProjectId}
              activeIssueSimpleId={activeIssueSimpleId}
              activeWorkspaceId={activeWorkspaceId}
              onOpenIssue={openIssue}
              onCloseIssue={closeIssue}
              onOpenWorkspace={openWorkspace}
              onCloseWorkspace={closeWorkspace}
            />
          ) : view === "list" ? (
            <ListView
              projectId={selectedProjectId}
              activeIssueSimpleId={activeIssueSimpleId}
              activeWorkspaceId={activeWorkspaceId}
              onOpenIssue={openIssue}
              onCloseIssue={closeIssue}
              onOpenWorkspace={openWorkspace}
              onCloseWorkspace={closeWorkspace}
            />
          ) : view === "activity" ? (
            <ActivityFeed projectId={selectedProjectId} onOpenIssue={openIssue} />
          ) : view === "archive" ? (
            <ArchiveView
              projectId={selectedProjectId}
              activeIssueSimpleId={activeIssueSimpleId}
              activeWorkspaceId={activeWorkspaceId}
              onOpenIssue={openIssue}
              onCloseIssue={closeIssue}
              onOpenWorkspace={openWorkspace}
              onCloseWorkspace={closeWorkspace}
            />
          ) : view === "dashboard" ? (
            <DashboardView projectId={selectedProjectId} />
          ) : (
            <SettingsView projectId={selectedProjectId} />
          )}
        </main>
      </div>

      {showCreateProject && (
        <CreateProjectDialog
          onClose={() => setShowCreateProject(false)}
          onCreated={(id) => {
            setSelectedProjectId(id);
            setShowCreateProject(false);
          }}
        />
      )}
    </div>
  );
}
