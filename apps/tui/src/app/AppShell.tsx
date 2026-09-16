import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useReducer } from "react";

import {
  createInitialShellState,
  dispatchShellCommand,
  shellCommandFromKey,
  type ShellFocusTarget,
  type ShellRoute,
  type ShellState,
} from "./state.ts";

export interface AppShellProps {
  readonly initialRoute?: ShellRoute;
  readonly onStateChange?: (state: ShellState) => void;
}

interface FocusRowProps {
  readonly current: ShellFocusTarget;
  readonly target: ShellFocusTarget;
  readonly label: string;
}

function FocusRow({ current, target, label }: FocusRowProps) {
  return <text>{`${current === target ? ">" : " "} ${label}`}</text>;
}

function ConnectionRoute({ focus }: { readonly focus: ShellFocusTarget }) {
  return (
    <box flexDirection="column">
      <text>Connection</text>
      <text>Connect to an environment to begin.</text>
      <text> </text>
      <FocusRow current={focus} target="connection-address" label="Server address" />
      <FocusRow current={focus} target="connection-submit" label="Connect" />
    </box>
  );
}

function ProjectsRoute({ focus }: { readonly focus: ShellFocusTarget }) {
  return (
    <box flexDirection="column">
      <text>Projects</text>
      <text>Project data will come from client-runtime.</text>
      <text> </text>
      <FocusRow current={focus} target="project-list" label="Project list" />
      <FocusRow current={focus} target="new-project" label="New project" />
    </box>
  );
}

function ThreadRoute({ focus }: { readonly focus: ShellFocusTarget }) {
  return (
    <box flexDirection="column">
      <text>Thread</text>
      <text>Thread data will come from client-runtime.</text>
      <text> </text>
      <FocusRow current={focus} target="thread-list" label="Thread list" />
      <FocusRow current={focus} target="conversation" label="Conversation" />
      <FocusRow current={focus} target="composer" label="Composer" />
    </box>
  );
}

function RouteContent({ state }: { readonly state: ShellState }) {
  switch (state.route) {
    case "connection":
      return <ConnectionRoute focus={state.focus} />;
    case "projects":
      return <ProjectsRoute focus={state.focus} />;
    case "thread":
      return <ThreadRoute focus={state.focus} />;
  }
}

function Help() {
  return (
    <box flexDirection="column">
      <text>Keyboard help</text>
      <text>1 Connection 2 Projects 3 Thread</text>
      <text>Tab Next focus Shift+Tab Previous focus</text>
      <text>Esc Close help or go back</text>
      <text>? Close help</text>
    </box>
  );
}

export function AppShell({ initialRoute = "connection", onStateChange }: AppShellProps) {
  const [state, dispatch] = useReducer(dispatchShellCommand, initialRoute, createInitialShellState);
  const { width } = useTerminalDimensions();
  const narrow = width < 48;

  useKeyboard((key) => {
    const command = shellCommandFromKey(key);
    if (command === undefined) return;

    key.preventDefault();
    key.stopPropagation();
    dispatch(command);
  });

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  return (
    <box flexDirection="column" width="100%" height="100%">
      <text>T3 Code TUI</text>
      <text>
        {narrow
          ? "1 Conn  2 Proj  3 Chat  ? Help"
          : "1 Connection   2 Projects   3 Thread   ? Help"}
      </text>
      <text>
        {narrow ? `Route: ${state.route}` : `Route: ${state.route}   Focus: ${state.focus}`}
      </text>
      {narrow ? <text>{`Focus: ${state.focus}`}</text> : null}
      <text> </text>
      {state.modal === "help" ? <Help /> : <RouteContent state={state} />}
      <box flexGrow={1} />
      <text>{narrow ? "Tab focus | Esc back" : "Tab / Shift+Tab focus   Esc back"}</text>
    </box>
  );
}
