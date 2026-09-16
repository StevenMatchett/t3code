export const SHELL_ROUTES = ["connection", "projects", "thread"] as const;

export type ShellRoute = (typeof SHELL_ROUTES)[number];

export type ShellFocusTarget =
  | "connection-address"
  | "connection-submit"
  | "project-list"
  | "new-project"
  | "thread-list"
  | "conversation"
  | "composer";

export type ShellModal = "help";

export interface ShellState {
  readonly route: ShellRoute;
  readonly focus: ShellFocusTarget;
  readonly modal: ShellModal | null;
}

export type ShellCommand =
  | { readonly type: "navigate"; readonly route: ShellRoute }
  | { readonly type: "cycle-focus"; readonly direction: "forward" | "backward" }
  | { readonly type: "back" }
  | { readonly type: "escape" }
  | { readonly type: "toggle-help" };

export interface ShellKey {
  readonly name: string;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly option?: boolean;
}

const focusTargets = {
  connection: ["connection-address", "connection-submit"],
  projects: ["project-list", "new-project"],
  thread: ["thread-list", "conversation", "composer"],
} as const satisfies Record<ShellRoute, readonly ShellFocusTarget[]>;

const parentRoute = {
  connection: undefined,
  projects: "connection",
  thread: "projects",
} as const satisfies Record<ShellRoute, ShellRoute | undefined>;

export function getRouteFocusTargets(route: ShellRoute): readonly ShellFocusTarget[] {
  return focusTargets[route];
}

export function createInitialShellState(route: ShellRoute = "connection"): ShellState {
  return {
    route,
    focus: focusTargets[route][0],
    modal: null,
  };
}

export function shellCommandFromKey(key: ShellKey): ShellCommand | undefined {
  if (key.ctrl || key.meta || key.option) return undefined;

  switch (key.name) {
    case "1":
      return { type: "navigate", route: "connection" };
    case "2":
      return { type: "navigate", route: "projects" };
    case "3":
      return { type: "navigate", route: "thread" };
    case "?":
      return { type: "toggle-help" };
    case "tab":
      return { type: "cycle-focus", direction: key.shift ? "backward" : "forward" };
    case "escape":
      return { type: "escape" };
    case "backspace":
      return { type: "back" };
    default:
      return undefined;
  }
}

export function dispatchShellCommand(state: ShellState, command: ShellCommand): ShellState {
  if (command.type === "toggle-help") {
    return { ...state, modal: state.modal === "help" ? null : "help" };
  }

  if (state.modal !== null) {
    return command.type === "escape" || command.type === "back" ? { ...state, modal: null } : state;
  }

  if (command.type === "escape" || command.type === "back") {
    const route = parentRoute[state.route];
    return route === undefined ? state : createInitialShellState(route);
  }

  if (command.type === "navigate") {
    return command.route === state.route ? state : createInitialShellState(command.route);
  }

  const targets = focusTargets[state.route];
  const currentIndex = targets.findIndex((target) => target === state.focus);
  const offset = command.direction === "forward" ? 1 : -1;
  const nextIndex = (Math.max(0, currentIndex) + offset + targets.length) % targets.length;
  return { ...state, focus: targets[nextIndex]! };
}
