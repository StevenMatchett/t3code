import type { ProjectId, ThreadId } from "@t3tools/contracts";

export const SHELL_ROUTES = ["projects", "threads", "conversation"] as const;
export type ShellRoute = (typeof SHELL_ROUTES)[number];
export type ShellFocusTarget = "project-list" | "thread-list" | "conversation";
export type ShellModal = "help" | "new-thread";

export interface ShellState {
  readonly route: ShellRoute;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId | null;
  readonly modal: ShellModal | null;
}

export interface ShellRows {
  readonly projects: ReadonlyArray<{ readonly id: ProjectId }>;
  readonly threads: ReadonlyArray<{ readonly id: ThreadId; readonly projectId: ProjectId }>;
}

export type ShellCommand =
  | { readonly type: "move"; readonly offset: number; readonly wrap: boolean }
  | { readonly type: "activate" }
  | { readonly type: "back" }
  | { readonly type: "toggle-help" }
  | { readonly type: "new-thread" }
  | { readonly type: "close-modal" }
  | { readonly type: "open-thread"; readonly projectId: ProjectId; readonly threadId: ThreadId }
  | { readonly type: "reconcile" };

export interface ShellKey {
  readonly name: string;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly option?: boolean;
}

const focusTargets = {
  projects: ["project-list"],
  threads: ["thread-list"],
  conversation: ["conversation"],
} as const satisfies Record<ShellRoute, readonly ShellFocusTarget[]>;

export function getRouteFocusTargets(route: ShellRoute): readonly ShellFocusTarget[] {
  return focusTargets[route];
}

export function createInitialShellState(route: ShellRoute = "projects"): ShellState {
  return { route, projectId: null, threadId: null, modal: null };
}

export function shellCommandFromKey(key: ShellKey): ShellCommand | undefined {
  if (key.ctrl || key.meta || key.option) return undefined;
  switch (key.name) {
    case "down":
      return { type: "move", offset: 1, wrap: false };
    case "up":
      return { type: "move", offset: -1, wrap: false };
    case "tab":
      return { type: "move", offset: key.shift ? -1 : 1, wrap: true };
    case "return":
    case "enter":
    case "right":
      return { type: "activate" };
    case "escape":
    case "left":
    case "backspace":
      return { type: "back" };
    case "?":
      return { type: "toggle-help" };
    case "n":
      return { type: "new-thread" };
    default:
      return undefined;
  }
}

function reconcile(state: ShellState, rows: ShellRows): ShellState {
  const projectId = rows.projects.some((project) => project.id === state.projectId)
    ? state.projectId
    : (rows.projects[0]?.id ?? null);
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

export function dispatchShellCommand(
  previous: ShellState,
  command: ShellCommand,
  rows: ShellRows,
): ShellState {
  const state = reconcile(previous, rows);
  if (command.type === "reconcile") return state;
  if (command.type === "close-modal") return { ...state, modal: null };
  if (command.type === "new-thread")
    return state.projectId ? { ...state, modal: "new-thread" } : state;
  if (command.type === "open-thread")
    return rows.threads.some(
      (thread) => thread.id === command.threadId && thread.projectId === command.projectId,
    )
      ? {
          route: "conversation",
          projectId: command.projectId,
          threadId: command.threadId,
          modal: null,
        }
      : state;
  if (command.type === "toggle-help") return { ...state, modal: state.modal ? null : "help" };
  if (state.modal)
    return command.type === "back" || command.type === "activate"
      ? { ...state, modal: null }
      : state;
  if (command.type === "back")
    return state.route === "projects"
      ? state
      : { ...state, route: state.route === "conversation" ? "threads" : "projects" };
  if (command.type === "activate") {
    if (state.route === "projects" && state.projectId !== null)
      return { ...state, route: "threads" };
    if (state.route === "threads" && state.threadId !== null)
      return { ...state, route: "conversation" };
    return state;
  }
  if (state.route === "conversation") return state;
  const items =
    state.route === "projects"
      ? rows.projects
      : rows.threads.filter((thread) => thread.projectId === state.projectId);
  if (items.length === 0) return state;
  const current = items.findIndex(
    (item) => item.id === (state.route === "projects" ? state.projectId : state.threadId),
  );
  const next = command.wrap
    ? (((current + command.offset) % items.length) + items.length) % items.length
    : Math.max(0, Math.min(items.length - 1, current + command.offset));
  if (state.route === "projects") {
    const projectId = rows.projects[next]!.id;
    return projectId === state.projectId
      ? state
      : reconcile({ ...state, projectId, threadId: null }, rows);
  }
  const threadId = rows.threads.filter((thread) => thread.projectId === state.projectId)[next]!.id;
  return threadId === state.threadId ? state : { ...state, threadId };
}
