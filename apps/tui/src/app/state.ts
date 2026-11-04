import type { ProjectId, ThreadId } from "@t3tools/contracts";

export const SHELL_ROUTES = ["projects", "threads", "conversation"] as const;
export type ShellRoute = (typeof SHELL_ROUTES)[number];
export const SIDEBAR_VIEWS = ["projects", "recent", "archived"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];
export function nextSidebarView(view: SidebarView = "projects", offset = 1): SidebarView {
  return SIDEBAR_VIEWS[
    (SIDEBAR_VIEWS.indexOf(view) + offset + SIDEBAR_VIEWS.length) % SIDEBAR_VIEWS.length
  ]!;
}

/** What sits above the workspace, bottom first. Esc removes exactly the top entry. */
export type ShellOverlay =
  | { readonly type: "help" }
  | { readonly type: "new-project" }
  | { readonly type: "new-thread" }
  | { readonly type: "palette" }
  | { readonly type: "favorite-models" }
  | { readonly type: "theme" }
  | { readonly type: "diff" }
  | { readonly type: "restore" }
  | { readonly type: "pull-request"; readonly cwd: string; readonly branch: string | null }
  | { readonly type: "rename"; readonly threadId: ThreadId }
  | {
      readonly type: "manage";
      readonly threadId: ThreadId;
      readonly initialAction?: "rename" | "delete";
    }
  | {
      readonly type: "thread-menu";
      readonly threadId: ThreadId;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "project-menu";
      readonly projectId: ProjectId;
      readonly x: number;
      readonly y: number;
    };

export interface ShellState {
  readonly sidebarView?: SidebarView;
  readonly showSubagents?: boolean;
  readonly route: ShellRoute;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId | null;
  readonly overlays: readonly ShellOverlay[];
  /** Projects showing their threads in the sidebar tree. */
  readonly expandedProjects?: readonly ProjectId[];
  readonly filter?: string;
}

export interface ShellRows {
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title?: string }>;
  readonly threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly title?: string;
    readonly archivedAt?: string | null;
    readonly lineage?: { readonly relationshipToParent: "fork" | "subagent" | null } | undefined;
  }>;
}

export function isSidebarThreadVisible(thread: ShellRows["threads"][number], state: ShellState) {
  return state.showSubagents || thread.lineage?.relationshipToParent !== "subagent";
}

const textMatchesFilter = (title: string | undefined, filter: string | undefined) =>
  !filter || (title ?? "").toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());

/** Threads the sidebar lists for this state, ignoring which project is selected. */
export function sidebarThreads<Thread extends ShellRows["threads"][number]>(
  threads: readonly Thread[],
  state: ShellState,
  keepThreadId: ThreadId | null = null,
): readonly Thread[] {
  return threads.filter(
    (thread) =>
      thread.id === keepThreadId ||
      (Boolean(thread.archivedAt) === (state.sidebarView === "archived") &&
        isSidebarThreadVisible(thread, state) &&
        textMatchesFilter(thread.title, state.filter)),
  );
}

/** A project stays listed under a filter when its name or any of its threads match. */
export function sidebarProjects<Project extends ShellRows["projects"][number]>(
  projects: readonly Project[],
  threads: ShellRows["threads"],
  state: ShellState,
): readonly Project[] {
  if (!state.filter) return projects;
  const matching = new Set(sidebarThreads(threads, state).map((thread) => thread.projectId));
  return projects.filter(
    (project) => matching.has(project.id) || textMatchesFilter(project.title, state.filter),
  );
}

export type ShellCommand =
  | { readonly type: "toggle-subagents" }
  | { readonly type: "set-sidebar-view"; readonly view: SidebarView }
  | { readonly type: "toggle-sidebar-view" }
  | { readonly type: "toggle-project-expanded"; readonly projectId?: ProjectId }
  | { readonly type: "set-filter"; readonly filter: string | undefined }
  | { readonly type: "move"; readonly offset: number; readonly wrap: boolean }
  | { readonly type: "activate" }
  | { readonly type: "back" }
  | { readonly type: "toggle-help" }
  | { readonly type: "new-project" }
  | { readonly type: "new-thread"; readonly projectId?: ProjectId }
  | { readonly type: "push-overlay"; readonly overlay: ShellOverlay }
  | { readonly type: "pop-overlay" }
  | { readonly type: "open-project"; readonly projectId: ProjectId }
  | { readonly type: "open-thread"; readonly projectId: ProjectId; readonly threadId: ThreadId }
  | { readonly type: "reconcile" };

export function createInitialShellState(route: ShellRoute = "projects"): ShellState {
  return { route, projectId: null, threadId: null, overlays: [] };
}

export function topOverlay(state: ShellState): ShellOverlay | null {
  return state.overlays.at(-1) ?? null;
}

/** Opening something already in the stack returns to it, so the stack can never grow in a loop. */
function pushOverlay(state: ShellState, overlay: ShellOverlay): ShellState {
  const existing = state.overlays.findIndex((entry) => entry.type === overlay.type);
  return {
    ...state,
    overlays:
      existing >= 0
        ? [...state.overlays.slice(0, existing), overlay]
        : [...state.overlays, overlay],
  };
}

function reconcile(state: ShellState, rows: ShellRows): ShellState {
  rows = {
    ...rows,
    threads: sidebarThreads(
      rows.threads,
      state,
      state.route === "conversation" ? state.threadId : null,
    ),
  };
  if (state.sidebarView === "recent" || state.sidebarView === "archived") {
    const threads = rows.threads.filter((thread) =>
      rows.projects.some((project) => project.id === thread.projectId),
    );
    const selected = threads.find((thread) => thread.id === state.threadId) ?? threads[0];
    const threadId = selected?.id ?? null;
    const projectId = selected?.projectId ?? rows.projects[0]?.id ?? null;
    const route =
      state.route === "conversation" && threadId === state.threadId ? "conversation" : "threads";
    return threadId === state.threadId && projectId === state.projectId && route === state.route
      ? state
      : { ...state, threadId, projectId, route };
  }
  const listed = sidebarProjects(rows.projects, rows.threads, state);
  const projectId = listed.some((project) => project.id === state.projectId)
    ? state.projectId
    : (listed[0]?.id ?? (state.filter ? state.projectId : null));
  const threads = rows.threads.filter((thread) => thread.projectId === projectId);
  const threadId = threads.some((thread) => thread.id === state.threadId)
    ? state.threadId
    : (threads[0]?.id ?? null);
  const route =
    state.projectId !== null && projectId !== state.projectId
      ? "projects"
      : state.route === "conversation" && threadId !== state.threadId
        ? "threads"
        : state.route;
  return projectId === state.projectId && threadId === state.threadId && route === state.route
    ? state
    : { ...state, projectId, threadId, route };
}

function withExpanded(state: ShellState, projectId: ProjectId | null): ShellState {
  if (projectId === null || state.expandedProjects?.includes(projectId)) return state;
  return { ...state, expandedProjects: [...(state.expandedProjects ?? []), projectId] };
}

export function dispatchShellCommand(
  previous: ShellState,
  command: ShellCommand,
  rows: ShellRows,
): ShellState {
  const state = reconcile(previous, rows);
  if (command.type === "set-sidebar-view") {
    return reconcile(
      {
        ...state,
        sidebarView: command.view,
        route: command.view === "projects" ? "projects" : "threads",
        ...((state.sidebarView ?? "projects") !== command.view
          ? { projectId: null, threadId: null }
          : {}),
      },
      rows,
    );
  }
  if (command.type === "toggle-sidebar-view")
    return reconcile(
      {
        ...state,
        sidebarView: nextSidebarView(state.sidebarView),
        ...(state.route !== "conversation" ? { projectId: null, threadId: null } : {}),
        route:
          state.route === "conversation" &&
          state.sidebarView !== "recent" &&
          state.sidebarView !== "archived"
            ? "conversation"
            : state.sidebarView === "archived"
              ? "projects"
              : "threads",
      },
      rows,
    );
  if (command.type === "toggle-subagents")
    return reconcile({ ...state, showSubagents: !state.showSubagents }, rows);
  if (command.type === "toggle-project-expanded") {
    const projectId = command.projectId ?? state.projectId;
    if (projectId === null) return state;
    const expanded = state.expandedProjects ?? [];
    return {
      ...state,
      expandedProjects: expanded.includes(projectId)
        ? expanded.filter((id) => id !== projectId)
        : [...expanded, projectId],
    };
  }
  if (command.type === "set-filter") {
    const { filter: _previous, ...rest } = state;
    return reconcile(command.filter ? { ...rest, filter: command.filter } : rest, rows);
  }
  if (command.type === "reconcile") return state;
  if (command.type === "push-overlay") return pushOverlay(state, command.overlay);
  if (command.type === "pop-overlay") return { ...state, overlays: state.overlays.slice(0, -1) };
  if (command.type === "new-project") return pushOverlay(state, { type: "new-project" });
  if (command.type === "new-thread") {
    const projectId = command.projectId ?? state.projectId;
    return projectId && rows.projects.some((project) => project.id === projectId)
      ? pushOverlay(reconcile({ ...state, projectId }, rows), { type: "new-thread" })
      : state;
  }
  if (command.type === "open-project")
    return rows.projects.some((project) => project.id === command.projectId)
      ? withExpanded(
          reconcile(
            {
              ...state,
              sidebarView: "projects",
              route: "threads",
              projectId: command.projectId,
              threadId: null,
              overlays: [],
            },
            rows,
          ),
          command.projectId,
        )
      : state;
  if (command.type === "open-thread")
    return rows.threads.some(
      (thread) => thread.id === command.threadId && thread.projectId === command.projectId,
    )
      ? withExpanded(
          {
            ...state,
            ...(state.sidebarView === "archived" ? { sidebarView: "recent" as const } : {}),
            route: "conversation",
            projectId: command.projectId,
            threadId: command.threadId,
            overlays: [],
          },
          command.projectId,
        )
      : state;
  if (command.type === "toggle-help")
    return topOverlay(state)?.type === "help"
      ? { ...state, overlays: state.overlays.slice(0, -1) }
      : pushOverlay(state, { type: "help" });
  // The top overlay owns navigation until it is dismissed.
  if (state.overlays.length > 0)
    return command.type === "back" || command.type === "activate"
      ? { ...state, overlays: state.overlays.slice(0, -1) }
      : state;
  if (command.type === "back") {
    if (state.filter && state.route !== "conversation") {
      const { filter: _cleared, ...rest } = state;
      return reconcile(rest, rows);
    }
    return state.route === "projects" ||
      (state.sidebarView !== undefined &&
        state.sidebarView !== "projects" &&
        state.route === "threads")
      ? state
      : reconcile(
          { ...state, route: state.route === "conversation" ? "threads" : "projects" },
          rows,
        );
  }
  if (command.type === "activate") {
    if (state.route === "projects" && state.projectId !== null)
      return withExpanded({ ...state, route: "threads" }, state.projectId);
    if (state.route === "threads" && state.threadId !== null)
      return { ...state, route: "conversation" };
    return state;
  }
  if (state.route === "conversation") return state;
  const threads = sidebarThreads(rows.threads, state);
  const items =
    state.route === "projects"
      ? sidebarProjects(rows.projects, rows.threads, state)
      : threads.filter(
          (thread) =>
            (state.sidebarView ?? "projects") !== "projects" ||
            thread.projectId === state.projectId,
        );
  if (items.length === 0) return state;
  const current = items.findIndex(
    (item) => item.id === (state.route === "projects" ? state.projectId : state.threadId),
  );
  const next = command.wrap
    ? (((current + command.offset) % items.length) + items.length) % items.length
    : Math.max(0, Math.min(items.length - 1, current + command.offset));
  if (state.route === "projects") {
    const projectId = items[next]!.id as ProjectId;
    return projectId === state.projectId
      ? state
      : reconcile({ ...state, projectId, threadId: null }, rows);
  }
  const selected = items[next] as ShellRows["threads"][number];
  return selected.id === state.threadId
    ? state
    : { ...state, threadId: selected.id, projectId: selected.projectId };
}
