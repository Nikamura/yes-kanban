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
import { cn } from "@/ui/lib/utils";

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
      <div className="flex h-full flex-col">
        <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 py-2.5 backdrop-blur-md lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h1 className="font-mono text-[15px] font-bold tracking-tight whitespace-nowrap lg:text-base">
              Yes Kanban
            </h1>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden pb-[52px] lg:pb-0">
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground animate-in fade-in duration-300">
            <div
              className="size-6 animate-spin rounded-full border-2 border-border border-t-primary"
              aria-hidden
            />
            <span>Loading...</span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <ProjectSelector
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onCreateNew={() => setShowCreateProject(true)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 py-2.5 backdrop-blur-md lg:px-6">
          <div className="flex min-w-0 min-h-0 flex-1 items-center gap-3">
            <h1
              className="cursor-pointer font-mono text-[15px] font-bold tracking-tight whitespace-nowrap lg:text-base"
              onClick={() => {
                setView("board");
                closeIssue();
              }}
            >
              Yes Kanban
            </h1>
            {dispatchStatus && (
              <span
                title={dispatchStatus.workerConnected ? "Worker connected" : "Worker disconnected"}
                className="inline-block size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: dispatchStatus.workerConnected ? "#10b981" : "#ef4444",
                }}
              />
            )}
          </div>
          <nav className="fixed right-0 bottom-0 left-0 z-[90] flex gap-0 border-t border-border bg-card pb-[max(4px,env(safe-area-inset-bottom))] pt-1 lg:static lg:z-auto lg:ml-0 lg:flex lg:w-auto lg:shrink-0 lg:gap-1 lg:border-t-0 lg:bg-transparent lg:p-0">
            {(
              [
                ["board", "Board"] as const,
                ["list", "List"] as const,
                ["activity", "Activity"] as const,
                ["archive", "Archive"] as const,
                ["dashboard", "Dashboard"] as const,
                ["settings", "Settings"] as const,
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={cn(
                  "relative flex flex-1 cursor-pointer items-center justify-center border-0 bg-transparent px-1 py-2.5 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground",
                  "min-h-11",
                  "lg:flex-none lg:min-h-0 lg:rounded-full lg:border lg:border-border lg:px-4 lg:py-1.5 lg:text-xs lg:normal-case lg:tracking-normal",
                  view === v &&
                    "bg-primary/10 text-primary after:absolute after:bottom-0 after:left-[20%] after:right-[20%] after:h-0.5 after:rounded-t after:bg-primary lg:after:hidden lg:border-primary lg:shadow-[0_0_20px_rgba(37,99,235,0.15)]",
                  view === v && "lg:hover:bg-primary/10",
                  view !== v && "lg:hover:bg-secondary",
                )}
                onClick={() => {
                  setView(v as View);
                  closeIssue();
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden pb-[52px] lg:pb-0">
          {!selectedProjectId ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground animate-in fade-in duration-300">
              <h2 className="text-lg font-semibold text-foreground">No project selected</h2>
              <p className="max-w-[280px] text-center leading-relaxed">Create a project to get started.</p>
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
