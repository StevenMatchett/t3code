import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { SETTLED_FIRST_PAGE, SETTLED_NEXT_PAGE, type CollapsibleShelf } from "./threadShelves.ts";

export const SHELL_ROUTES = ["projects", "threads", "conversation"] as const;
export type ShellRoute = (typeof SHELL_ROUTES)[number];
export const SIDEBAR_VIEWS = ["projects", "recent", "archived"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];
export function nextSidebarView(view: SidebarView = "projects", offset = 1): SidebarView {
  return SIDEBAR_VIEWS[
    (SIDEBAR_VIEWS.indexOf(view) + offset + SIDEBAR_VIEWS.length) % SIDEBAR_VIEWS.length
  ]!;
}

/** "tree" is the TUI's project tree. "shelves" copies the GUI sidebar: one list across projects. */
export type SidebarLayout = "tree" | "shelves";

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
  | { readonly type: "plan"; readonly threadId: ThreadId }
  | { readonly type: "pull-requests"; readonly threadId: ThreadId }
  | {
      readonly type: "git";
      readonly cwd: string;
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
    }
  | { readonly type: "git-branches"; readonly cwd: string; readonly threadId: ThreadId }
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
    }
  | {
      readonly type: "snooze-menu";
      readonly threadIds: readonly ThreadId[];
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "snooze-custom"; readonly threadIds: readonly ThreadId[] }
  | { readonly type: "bulk-menu"; readonly x: number; readonly y: number }
  | { readonly type: "bulk-delete"; readonly x: number; readonly y: number }
  | { readonly type: "project-scope" };

export interface ShellState {
  readonly sidebarView?: SidebarView;
  readonly showSubagents?: boolean;
  /** While one of its subagents is open, the sidebar lists this parent and its subagents instead. */
  readonly subagentsOf?: ThreadId;
  readonly route: ShellRoute;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId | null;
  readonly overlays: readonly ShellOverlay[];
  /** Projects showing their threads in the sidebar tree. */
  readonly expandedProjects?: readonly ProjectId[];
  readonly filter?: string;
  readonly sidebarLayout?: SidebarLayout;
  /** The highlighted row in the shelves layout, which may be a shelf header rather than a thread. */
  readonly shelfCursor?: string;
  readonly expandedShelves?: readonly CollapsibleShelf[];
  /** The one project the shelves layout is narrowed to. Absent lists all of them. */
  readonly projectScope?: ProjectId;
  readonly settledLimit?: number;
  /** Threads selected for a bulk action. Never saved: a selection belongs to one sitting. */
  readonly markedThreads?: readonly ThreadId[];
  /** Where a Shift range starts: the thread last added to the selection. */
  readonly markAnchor?: ThreadId;
}

export interface ShellRows {
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title?: string }>;
  readonly threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly title?: string;
    readonly archivedAt?: string | null;
    readonly lineage?:
      | {
          readonly relationshipToParent: "fork" | "subagent" | null;
          readonly parentThreadId?: ThreadId | null;
        }
      | undefined;
  }>;
}

const subagentParentOf = (thread: ShellRows["threads"][number] | undefined) =>
  thread?.lineage?.relationshipToParent === "subagent"
    ? (thread.lineage.parentThreadId ?? null)
    : null;

/** The parent first, then its live subagents. Empty once the parent is gone. */
export function subagentFamily<Thread extends ShellRows["threads"][number]>(
  threads: readonly Thread[],
  parentId: ThreadId,
): readonly Thread[] {
  const parent = threads.find((thread) => thread.id === parentId);
  if (!parent) return [];
  return [
    parent,
    ...threads.filter((thread) => !thread.archivedAt && subagentParentOf(thread) === parentId),
  ];
}

export function isSidebarThreadVisible(thread: ShellRows["threads"][number], state: ShellState) {
  return state.showSubagents || thread.lineage?.relationshipToParent !== "subagent";
}

/** The shelves list is on screen. Archived threads keep their flat list in either layout. */
export const shelvesBrowsing = (state: ShellState) =>
  state.sidebarLayout === "shelves" && state.sidebarView !== "archived" && !state.subagentsOf;

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
        // The shelves layout also searches message text, which only the rows know about.
        (shelvesBrowsing(state) || textMatchesFilter(thread.title, state.filter))),
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
  | { readonly type: "set-sidebar-layout"; readonly layout: SidebarLayout }
  | {
      readonly type: "select-shelf-row";
      readonly rowId: string;
      readonly thread?: { readonly id: ThreadId; readonly projectId: ProjectId };
    }
  | {
      readonly type: "mark-threads";
      readonly threadIds: readonly ThreadId[];
      readonly anchor?: ThreadId;
    }
  | { readonly type: "toggle-shelf"; readonly shelf: CollapsibleShelf }
  | { readonly type: "show-more-settled" }
  | { readonly type: "set-project-scope"; readonly projectId: ProjectId | null }
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

function withoutSubagents({ subagentsOf: _parent, ...rest }: ShellState): ShellState {
  return rest;
}

function reconcile(state: ShellState, rows: ShellRows): ShellState {
  // A subagent opened any other way, such as a restored session, still lists its family.
  const parentId =
    state.subagentsOf ??
    (state.route === "conversation"
      ? subagentParentOf(rows.threads.find((thread) => thread.id === state.threadId))
      : null);
  if (parentId) {
    const family = subagentFamily(rows.threads, parentId);
    const selected = family.find((thread) => thread.id === state.threadId) ?? family[0];
    if (selected) {
      const route =
        state.route === "conversation" && selected.id === state.threadId
          ? "conversation"
          : "threads";
      return parentId === state.subagentsOf &&
        selected.id === state.threadId &&
        selected.projectId === state.projectId &&
        route === state.route
        ? state
        : {
            ...state,
            subagentsOf: parentId,
            threadId: selected.id,
            projectId: selected.projectId,
            route,
          };
    }
    state = withoutSubagents(state);
  }
  rows = {
    ...rows,
    threads: sidebarThreads(
      rows.threads,
      state,
      state.route === "conversation" ? state.threadId : null,
    ),
  };
  if (state.sidebarView === "recent" || state.sidebarView === "archived") {
    const scope = shelvesBrowsing(state) ? (state.projectScope ?? null) : null;
    const threads = rows.threads.filter(
      (thread) =>
        rows.projects.some((project) => project.id === thread.projectId) &&
        (scope === null ||
          thread.projectId === scope ||
          (state.route === "conversation" && thread.id === state.threadId)),
    );
    const selected = threads.find((thread) => thread.id === state.threadId) ?? threads[0];
    const threadId = selected?.id ?? null;
    const projectId = selected?.projectId ?? scope ?? rows.projects[0]?.id ?? null;
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

function withoutMarks({
  markedThreads: _marked,
  markAnchor: _anchor,
  ...rest
}: ShellState): ShellState {
  return rest;
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
  const reconciled = reconcile(previous, rows);
  // Switching what the sidebar lists leaves the subagent list behind.
  const state =
    command.type === "set-sidebar-layout" ||
    command.type === "set-project-scope" ||
    command.type === "set-sidebar-view" ||
    command.type === "toggle-sidebar-view" ||
    command.type === "open-project"
      ? withoutSubagents(reconciled)
      : reconciled;
  if (command.type === "mark-threads") {
    const rest = withoutMarks(state);
    return command.threadIds.length === 0
      ? rest
      : {
          ...rest,
          markedThreads: command.threadIds,
          ...(command.anchor ? { markAnchor: command.anchor } : {}),
        };
  }
  if (command.type === "set-sidebar-layout") {
    const { filter: _filter, shelfCursor: _cursor, ...rest } = withoutMarks(state);
    const shelves = command.layout === "shelves";
    return reconcile(
      {
        ...rest,
        sidebarLayout: command.layout,
        sidebarView: shelves ? "recent" : "projects",
        route: state.route === "conversation" ? "conversation" : shelves ? "threads" : "projects",
      },
      rows,
    );
  }
  if (command.type === "select-shelf-row")
    return {
      ...state,
      shelfCursor: command.rowId,
      ...(command.thread
        ? { threadId: command.thread.id, projectId: command.thread.projectId }
        : {}),
    };
  if (command.type === "toggle-shelf") {
    const expanded = state.expandedShelves ?? [];
    return {
      ...state,
      expandedShelves: expanded.includes(command.shelf)
        ? expanded.filter((shelf) => shelf !== command.shelf)
        : [...expanded, command.shelf],
    };
  }
  if (command.type === "show-more-settled")
    return {
      ...state,
      settledLimit: (state.settledLimit ?? SETTLED_FIRST_PAGE) + SETTLED_NEXT_PAGE,
    };
  if (command.type === "set-project-scope") {
    const {
      projectScope: _scope,
      settledLimit: _limit,
      shelfCursor: _cursor,
      ...rest
    } = withoutMarks(state);
    return reconcile(command.projectId ? { ...rest, projectScope: command.projectId } : rest, rows);
  }
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
  if (command.type === "toggle-sidebar-view" && state.sidebarLayout === "shelves")
    return reconcile(
      {
        ...withoutMarks(state),
        sidebarView: state.sidebarView === "archived" ? "recent" : "archived",
        route: "threads",
        threadId: null,
      },
      rows,
    );
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
  // The GUI has no project rows: choosing a project narrows the one list to it.
  if (command.type === "open-project" && state.sidebarLayout === "shelves") {
    if (!rows.projects.some((project) => project.id === command.projectId)) return state;
    const { shelfCursor: _cursor, settledLimit: _limit, ...rest } = state;
    return reconcile(
      {
        ...rest,
        sidebarView: "recent",
        route: "threads",
        projectId: command.projectId,
        projectScope: command.projectId,
        threadId: null,
        overlays: [],
      },
      rows,
    );
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
  if (command.type === "open-thread") {
    const thread = rows.threads.find(
      (item) => item.id === command.threadId && item.projectId === command.projectId,
    );
    const parentId = subagentParentOf(thread);
    return thread
      ? withExpanded(
          {
            ...withoutSubagents(withoutMarks(state)),
            ...(parentId ? { subagentsOf: parentId } : {}),
            ...(state.sidebarView === "archived" ? { sidebarView: "recent" as const } : {}),
            route: "conversation",
            projectId: command.projectId,
            threadId: command.threadId,
            overlays: [],
            ...(state.sidebarLayout === "shelves" ? { shelfCursor: command.threadId } : {}),
          },
          command.projectId,
        )
      : state;
  }
  if (command.type === "toggle-help")
    return topOverlay(state)?.type === "help"
      ? { ...state, overlays: state.overlays.slice(0, -1) }
      : pushOverlay(state, { type: "help" });
  // The top overlay owns navigation until it is dismissed.
  if (state.overlays.length > 0)
    return command.type === "back" || command.type === "activate"
      ? { ...state, overlays: state.overlays.slice(0, -1) }
      : state;
  // The subagent list's way out, and its rows open as any thread does.
  const openListed = (threadId: ThreadId | null | undefined) => {
    const thread = rows.threads.find((item) => item.id === threadId);
    return thread
      ? dispatchShellCommand(
          state,
          { type: "open-thread", projectId: thread.projectId, threadId: thread.id },
          rows,
        )
      : state;
  };
  if (state.subagentsOf && state.route !== "conversation") {
    if (command.type === "back") return openListed(state.subagentsOf);
    if (command.type === "activate") return openListed(state.threadId);
  }
  if (command.type === "back") {
    if (state.markedThreads && state.route !== "conversation") return withoutMarks(state);
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
    if (state.route === "threads" && state.threadId !== null) {
      const parentId = subagentParentOf(
        rows.threads.find((thread) => thread.id === state.threadId),
      );
      return { ...state, route: "conversation", ...(parentId ? { subagentsOf: parentId } : {}) };
    }
    return state;
  }
  if (state.route === "conversation") return state;
  const threads = sidebarThreads(rows.threads, state);
  const items = state.subagentsOf
    ? subagentFamily(rows.threads, state.subagentsOf)
    : state.route === "projects"
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
