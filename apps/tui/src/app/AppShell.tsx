/** @jsxImportSource react */
import { useEffect, useReducer } from "react";

import { Stack, Text } from "../ui/primitives.tsx";
import {
  createInitialShellState,
  dispatchShellCommand,
  type ShellCommand,
  type ShellFocusTarget,
  type ShellRoute,
  type ShellState,
} from "./state.ts";

export interface AppShellViewProps {
  readonly narrow: boolean;
  readonly state: ShellState;
}

interface FocusRowProps {
  readonly current: ShellFocusTarget;
  readonly target: ShellFocusTarget;
  readonly label: string;
}

function FocusRow({ current, target, label }: FocusRowProps) {
  return <Text>{`${current === target ? ">" : " "} ${label}`}</Text>;
}

function ConnectionRoute({ focus }: { readonly focus: ShellFocusTarget }) {
  return (
    <Stack flexDirection="column">
      <Text>Connection</Text>
      <Text>Connect to an environment to begin.</Text>
      <Text> </Text>
      <FocusRow current={focus} target="connection-address" label="Server address" />
      <FocusRow current={focus} target="connection-submit" label="Connect" />
    </Stack>
  );
}

function ProjectsRoute({ focus }: { readonly focus: ShellFocusTarget }) {
  return (
    <Stack flexDirection="column">
      <Text>Projects</Text>
      <Text>Project data will come from client-runtime.</Text>
      <Text> </Text>
      <FocusRow current={focus} target="project-list" label="Project list" />
      <FocusRow current={focus} target="new-project" label="New project" />
    </Stack>
  );
}

function ThreadRoute({ focus }: { readonly focus: ShellFocusTarget }) {
  return (
    <Stack flexDirection="column">
      <Text>Thread</Text>
      <Text>Thread data will come from client-runtime.</Text>
      <Text> </Text>
      <FocusRow current={focus} target="thread-list" label="Thread list" />
      <FocusRow current={focus} target="conversation" label="Conversation" />
      <FocusRow current={focus} target="composer" label="Composer" />
    </Stack>
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
    <Stack flexDirection="column">
      <Text>Keyboard help</Text>
      <Text>1 Connection 2 Projects 3 Thread</Text>
      <Text>Tab Next focus Shift+Tab Previous focus</Text>
      <Text>Esc Close help or go back</Text>
      <Text>? Close help</Text>
    </Stack>
  );
}

export function useAppShellState(
  initialRoute: ShellRoute = "connection",
  onStateChange?: (state: ShellState) => void,
): readonly [ShellState, (command: ShellCommand) => void] {
  const [state, dispatch] = useReducer(dispatchShellCommand, initialRoute, createInitialShellState);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  return [state, dispatch];
}

export function AppShellView({ narrow, state }: AppShellViewProps) {
  return (
    <Stack flexDirection="column" width="100%" height="100%">
      <Text>T3 Code TUI</Text>
      <Text>
        {narrow
          ? "1 Conn  2 Proj  3 Chat  ? Help"
          : "1 Connection   2 Projects   3 Thread   ? Help"}
      </Text>
      <Text>
        {narrow ? `Route: ${state.route}` : `Route: ${state.route}   Focus: ${state.focus}`}
      </Text>
      {narrow ? <Text>{`Focus: ${state.focus}`}</Text> : null}
      <Text> </Text>
      {state.modal === "help" ? <Help /> : <RouteContent state={state} />}
      <Stack flexGrow={1} />
      <Text>{narrow ? "Tab focus | Esc back" : "Tab / Shift+Tab focus   Esc back"}</Text>
    </Stack>
  );
}
