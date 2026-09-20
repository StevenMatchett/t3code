/** @jsxImportSource react */
import { useEffect, useReducer, useCallback, type ReactNode } from "react";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { threadActivityPhase, type ThreadActivityPhase } from "../features/chat/threadActivity.ts";
import { ThreadActivityIndicator } from "../ui/ThreadActivityIndicator.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { useThemeColor } from "../ui/context.tsx";
import { calculateShellLayout } from "../ui/layout.ts";
import { inlineTerminalText } from "../ui/textLayout.ts";
import {
  createInitialShellState,
  dispatchShellCommand,
  type ShellCommand,
  type ShellRoute,
  type ShellRows,
  type ShellState,
} from "./state.ts";

export interface AppShellViewProps {
  readonly environmentId: EnvironmentId;
  readonly live: boolean;
  readonly state: ShellState;
  readonly label: string;
  readonly status: string;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly threads: readonly OrchestrationThreadShell[];
  readonly loaded: boolean;
  readonly error: boolean;
  readonly width: number;
  readonly height: number;
  readonly hints?: string;
  readonly notice?: {
    readonly text: string;
    readonly failed: boolean;
  } | null;
  readonly children?: ReactNode;
  readonly onNewThread?: () => void;
  readonly modalContent?: ReactNode;
}

export function useAppShellState(
  rows: ShellRows,
  loaded: boolean,
  initialRoute: ShellRoute = "projects",
  onStateChange?: (state: ShellState) => void,
): readonly [ShellState, (command: ShellCommand) => void] {
  const [state, dispatch] = useReducer(
    (current: ShellState, input: { readonly command: ShellCommand; readonly rows: ShellRows }) =>
      dispatchShellCommand(current, input.command, input.rows),
    initialRoute,
    createInitialShellState,
  );
  useEffect(() => {
    if (loaded) dispatch({ command: { type: "reconcile" }, rows });
  }, [rows, loaded]);
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);
  const send = useCallback((command: ShellCommand) => dispatch({ command, rows }), [rows]);
  return [state, send];
}

function List({
  items,
  selectedId,
  count,
  empty,
  active,
  visible,
}: {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly phase?: ThreadActivityPhase;
  }>;
  readonly selectedId: string | null;
  readonly count: number;
  readonly empty: string;
  readonly active: boolean;
  readonly visible: boolean;
}) {
  const selected = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const visibleCount = items.length > count ? Math.max(1, count - 1) : count;
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(visibleCount / 2), items.length - visibleCount),
  );
  return (
    <Stack flexDirection="column" flexGrow={1} overflow="hidden">
      {items.length === 0 ? (
        <Text tone="muted">{empty}</Text>
      ) : (
        items
          .slice(start, start + visibleCount)
          .map((item) => (
            <SelectionRow
              key={item.id}
              selected={item.id === selectedId}
              active={active}
              label={item.text}
              trailing={
                item.phase ? (
                  <ThreadActivityIndicator phase={item.phase} compact visible={visible} />
                ) : undefined
              }
            />
          ))
      )}
      <Stack flexGrow={1} />
      {items.length > count ? (
        <Text
          height={1}
          tone="muted"
        >{`${start + 1}-${Math.min(items.length, start + visibleCount)} of ${items.length}`}</Text>
      ) : null}
    </Stack>
  );
}

function Help() {
  return (
    <Stack flexDirection="column" gap={1}>
      <Text strong>Keyboard help</Text>
      <Text tone="accent">NAVIGATION</Text>
      <Text>Up/Down or Tab Select Enter / Right Open</Text>
      <Text>Esc / Left Back R Reconnect</Text>
      <Text tone="accent">CONVERSATION</Text>
      <Text>Enter / i Write prompt Esc Return to history</Text>
      <Text>Enter Send Ctrl+J New line</Text>
      <Text>Click model/reasoning or Tab then Enter</Text>
      <Text>/ Search skills Enter Choose Esc Dismiss</Text>
      <Text>Up/Down / PgUp/PgDn Scroll End Follow latest</Text>
      <Text>A Requests T Tool detail Ctrl+X Stop turn</Text>
      <Text>Ctrl+T Open thread shell Ctrl+\ Release shell focus</Text>
      <Text>N New thread (from navigation or history)</Text>
      <Text tone="muted">Ctrl+C quits the TUI, not the shared server.</Text>
      <Text tone="muted">
        Provider switching in existing threads and Git actions remain pending.
      </Text>
    </Stack>
  );
}

export function AppShellView({
  environmentId,
  live,
  state,
  label,
  status,
  projects,
  threads,
  loaded,
  error,
  width,
  height,
  hints,
  notice,
  children,
  onNewThread,
  modalContent,
}: AppShellViewProps) {
  const layout = calculateShellLayout(width, height);
  const background = useThemeColor("panel");
  const project = projects.find((item) => item.id === state.projectId);
  const projectThreads = threads.filter((item) => item.projectId === state.projectId);
  const selectedThread = projectThreads.find((item) => item.id === state.threadId);
  const browsingProjects = state.route === "projects";
  const conversation = state.route === "conversation";
  const title = browsingProjects
    ? `Projects (${projects.length})`
    : `Threads (${projectThreads.length}) - ${inlineTerminalText(project?.title ?? "")}`;
  const priorities: Record<ThreadActivityPhase, number> = {
    idle: 0,
    completed: 1,
    stale: 2,
    starting: 3,
    running: 4,
    failed: 5,
    waiting_for_input: 6,
    waiting_for_approval: 7,
  };
  const projectActivity = new Map<string, ThreadActivityPhase>();
  const phases = new Map(
    threads.map((thread) => {
      const phase = threadActivityPhase(environmentId, thread, live);
      if (priorities[phase] > priorities[projectActivity.get(thread.projectId) ?? "idle"])
        projectActivity.set(thread.projectId, phase);
      return [thread.id, phase] as const;
    }),
  );
  const items = browsingProjects
    ? projects.map((item) => ({
        id: item.id,
        text: item.title,
        phase: projectActivity.get(item.id) ?? "idle",
      }))
    : projectThreads.map((item) => ({
        id: item.id,
        text: `${item.title}${item.worktreePath ? " [WT]" : ""}`,
        phase: phases.get(item.id)!,
      }));
  const empty = error
    ? "Connection unavailable. R retries."
    : !loaded
      ? "Loading your workspace..."
      : browsingProjects
        ? "No projects in this environment."
        : "No active threads in this project.";
  const navigation = (
    <Stack flexDirection="column" height="100%" gap={1}>
      <Text height={1} tone="muted" wrapMode="none" truncate>
        {browsingProjects
          ? "Choose a workspace"
          : inlineTerminalText(project?.title ?? "Workspace")}
      </Text>
      <List
        items={items}
        selectedId={browsingProjects ? state.projectId : state.threadId}
        count={Math.max(1, layout.contentHeight - 4)}
        empty={empty}
        active={!conversation}
        visible={state.modal === null}
      />
      <Text height={1} tone="muted" wrapMode="none" truncate>
        {browsingProjects
          ? "Enter to browse threads"
          : conversation
            ? "Esc to browse threads"
            : "Esc to projects"}
      </Text>
    </Stack>
  );
  const preview = (
    <Stack flexDirection="column" paddingTop={2} gap={1}>
      <Text strong tone="accent">
        {inlineTerminalText(
          browsingProjects
            ? (project?.title ?? "Your workspace")
            : (selectedThread?.title ?? "Choose a thread"),
        )}
      </Text>
      {project ? <Text tone="muted">{inlineTerminalText(project.workspaceRoot)}</Text> : null}
      <Text>
        {browsingProjects
          ? `${projectThreads.length} active threads`
          : selectedThread
            ? `Model  ${inlineTerminalText(selectedThread.modelSelection.model)}`
            : empty}
      </Text>
      <Text tone="muted">
        {browsingProjects
          ? "Open a project to choose a conversation."
          : "Press Enter to open the conversation."}
      </Text>
      <Stack height={1} />
      <Text tone="muted">Shared with your existing T3 environment.</Text>
      <Text tone="muted">Your agents keep running when this client closes.</Text>
    </Stack>
  );
  return (
    <Stack
      width="100%"
      height="100%"
      paddingX={1}
      flexDirection="column"
      overflow="hidden"
      {...(background ? { backgroundColor: background } : {})}
    >
      <Stack height={1} flexShrink={0} flexDirection="row">
        <Text strong tone="accent" width={9}>
          T3 TUI
        </Text>
        <Text tone="muted" flexGrow={1} wrapMode="none" truncate>
          {inlineTerminalText(label)}
        </Text>
        {project && onNewThread ? (
          <Stack
            id="new-thread-action"
            height={1}
            width={16}
            flexShrink={0}
            onMouseDown={(event) => {
              if (event.button !== 0 || state.modal !== null) return;
              event.preventDefault();
              event.stopPropagation();
              onNewThread();
            }}
          >
            <Text tone="accent" strong height={1}>
              [+ New thread]
            </Text>
          </Stack>
        ) : null}
        <Text
          tone={error ? "danger" : status === "Connected" ? "success" : "warning"}
          flexShrink={0}
        >{` ${status}`}</Text>
      </Stack>
      <Stack height={1} flexShrink={0} />
      <Stack height={layout.bodyHeight} flexShrink={0} flexDirection="row" gap={1}>
        <Stack
          visible={state.modal === null}
          width="100%"
          height="100%"
          flexDirection="row"
          gap={1}
        >
          {layout.split ? (
            <Panel
              title={title}
              width={layout.sidebarWidth}
              height="100%"
              borderTone={conversation ? "border" : "borderFocused"}
              flexDirection="column"
            >
              {navigation}
            </Panel>
          ) : null}
          <Panel
            width={layout.mainWidth}
            height="100%"
            title={
              conversation
                ? inlineTerminalText(selectedThread?.title ?? "Conversation")
                : layout.split
                  ? "Workspace"
                  : title
            }
            borderTone={conversation || !layout.split ? "borderFocused" : "border"}
            flexDirection="column"
          >
            {conversation ? children : layout.split ? preview : navigation}
          </Panel>
        </Stack>
        {state.modal ? (
          <Panel
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            title={state.modal === "new-thread" ? "New thread" : "Help"}
            borderTone="borderFocused"
            flexDirection="column"
          >
            {state.modal === "new-thread" ? modalContent : <Help />}
          </Panel>
        ) : null}
      </Stack>
      <Text
        height={1}
        flexShrink={0}
        tone={notice?.failed ? "danger" : notice ? "success" : "muted"}
        wrapMode="none"
        truncate
      >
        {notice?.text ??
          (state.modal === "new-thread"
            ? "Tab Select field  Enter Activate  Esc Close"
            : state.modal
              ? "Enter / Esc  Close help"
              : conversation
                ? (hints ?? "Enter  Compose   A  Requests   Esc  Threads   ?  Help")
                : "Up/Down Select  Enter Open  N New thread  Esc Back  ? Help")}
      </Text>
    </Stack>
  );
}
