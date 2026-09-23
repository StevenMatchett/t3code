/** @jsxImportSource react */
import { useEffect, useReducer, useCallback, type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { threadActivityPhase, type ThreadActivityPhase } from "../features/chat/threadActivity.ts";
import { ThreadActivityIndicator } from "../ui/ThreadActivityIndicator.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { useThemeColor } from "../ui/context.tsx";
import { calculateShellLayout } from "../ui/layout.ts";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { HotkeyBar, type HotkeyHint, type HotkeyState } from "../ui/HotkeyBar.tsx";
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
  readonly archivedStatus?: "loading" | "live" | "error";
  readonly loaded: boolean;
  readonly error: boolean;
  readonly width: number;
  readonly height: number;
  readonly hotkeys?: HotkeyState;
  readonly notice?: {
    readonly text: string;
    readonly failed: boolean;
  } | null;
  readonly children?: ReactNode;
  readonly onOpenProject?: (projectId: ProjectId) => void;
  readonly onOpenThread?: (projectId: ProjectId, threadId: ThreadId) => void;
  readonly onNewProject?: () => void;
  readonly onNewThread?: () => void;
  readonly modalContent?: ReactNode;
  readonly managementOverlay?: {
    readonly title: string;
    readonly context: string;
    readonly hints: readonly HotkeyHint[];
    readonly content: ReactNode;
  } | null;
  readonly onOpenArchived?: () => void;
  readonly onManageThread?: () => void;
  readonly onOpenPalette?: () => void;
  readonly onToggleSidebarView?: () => void;
}

export function useAppShellState(
  rows: ShellRows,
  loaded: boolean,
  initialRoute: ShellRoute = "projects",
  onStateChange?: (state: ShellState) => void,
  initialState?: ShellState,
): readonly [ShellState, (command: ShellCommand) => void] {
  const [state, dispatch] = useReducer(
    (current: ShellState, input: { readonly command: ShellCommand; readonly rows: ShellRows }) =>
      dispatchShellCommand(current, input.command, input.rows),
    initialState ?? createInitialShellState(initialRoute),
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
  onActivate,
}: {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly subline?: string;
    readonly phase?: ThreadActivityPhase;
  }>;
  readonly selectedId: string | null;
  readonly count: number;
  readonly empty: string;
  readonly active: boolean;
  readonly visible: boolean;
  readonly onActivate?: (id: string) => void;
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
        items.slice(start, start + visibleCount).map((item) => (
          <Stack
            key={item.id}
            id={`navigation-${item.id}`}
            width="100%"
            height={item.subline ? 2 : 1}
            flexDirection="column"
            flexShrink={0}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              onActivate?.(item.id);
            }}
          >
            <SelectionRow
              selected={item.id === selectedId}
              active={active}
              label={item.text}
              trailing={
                item.phase ? (
                  <ThreadActivityIndicator phase={item.phase} compact visible={visible} />
                ) : undefined
              }
            />
            {item.subline ? (
              <Text
                height={1}
                tone="muted"
                attributes={TextAttributes.DIM}
                wrapMode="none"
                truncate
              >{`    ${inlineTerminalText(item.subline)}`}</Text>
            ) : null}
          </Stack>
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
      <Text>Up/Down or Tab Select Enter Open</Text>
      <Text>Left Projects Right Recent threads (sidebar)</Text>
      <Text>Esc Back R Reconnect</Text>
      <Text>Ctrl+B Cycle Projects / Recent / Archived sidebar</Text>
      <Text>Ctrl+K Search conversation output, projects, threads, and commands</Text>
      <Text tone="accent">CONVERSATION</Text>
      <Text>Enter / i Write prompt Esc Return to history</Text>
      <Text>Enter Send Shift+Enter New line</Text>
      <Text>Up in an empty message recalls prompts; Down moves forward</Text>
      <Text>Click model/reasoning or Tab then Enter</Text>
      <Text>/ Find in thread · In message box: search skills</Text>
      <Text>Mouse wheel / Up/Down / PgUp/PgDn Scroll End Follow latest</Text>
      <Text>A Requests T Tool detail Ctrl+X Stop turn</Text>
      <Text>E Edit from checkpoint: rewind chat, optionally revert files</Text>
      <Text>Ctrl+T Open thread shell Ctrl+\ Release shell focus</Text>
      <Text>N New thread (from navigation or history)</Text>
      <Text>P New project</Text>
      <Text>M Manage thread Shift+A Archived threads (navigation)</Text>
      <Text>D View saved thread changes (navigation or history)</Text>
      <Text>O Open branch pull request in browser (navigation or history)</Text>
      <Text tone="muted">Ctrl+C asks before closing the TUI; the shared server keeps running.</Text>
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
  archivedStatus,
  loaded,
  error,
  width,
  height,
  hotkeys,
  notice,
  children,
  onOpenProject,
  onOpenThread,
  onNewProject,
  onNewThread,
  modalContent,
  managementOverlay,
  onOpenArchived,
  onManageThread,
  onOpenPalette,
  onToggleSidebarView,
}: AppShellViewProps) {
  const layout = calculateShellLayout(width, height);
  const background = useThemeColor("panel");
  const project = projects.find((item) => item.id === state.projectId);
  const archived = state.sidebarView === "archived";
  const recent = state.sidebarView === "recent" || archived;
  const projectThreads = threads.filter((item) => item.projectId === state.projectId);
  const selectedThread = projectThreads.find((item) => item.id === state.threadId);
  const browsingProjects = !recent && state.route === "projects";
  const visibleThreads = recent ? threads : projectThreads;
  const conversation = state.route === "conversation";
  const navigationHints: readonly HotkeyHint[] = browsingProjects
    ? [
        { key: "↑↓", label: "Select" },
        { key: "Enter", label: "Open" },
        { key: "←/→", label: "View" },
        { key: "Ctrl+B", label: "Toggle view" },
        { key: "P", label: "New project" },
        { key: "⇧A", label: "Archived" },
        { key: "Ctrl+K", label: "Search" },
        { key: "?", label: "Help" },
      ]
    : archived
      ? [
          { key: "↑↓", label: "Select" },
          { key: "Enter", label: "Manage / restore" },
          { key: "←/→", label: "View" },
          { key: "Ctrl+B", label: "Cycle view" },
          { key: "R", label: "Refresh" },
        ]
      : [
          { key: "↑↓", label: "Select" },
          { key: "Enter", label: "Open" },
          { key: "←/→", label: "View" },
          { key: "Ctrl+B", label: "Toggle view" },
          { key: "N", label: "New thread" },
          { key: "M", label: "Manage" },
          { key: "D", label: "Diff" },
          { key: "O", label: "Open PR" },
          { key: "⇧A", label: "Archived" },
          { key: "Ctrl+K", label: "Search" },
          { key: "Esc", label: "Projects" },
        ];
  const title = recent
    ? `${archived ? "Archived" : "Recent"} threads (${threads.length})`
    : browsingProjects
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
    : visibleThreads.map((item) => ({
        id: item.id,
        text: `${item.title}${item.worktreePath ? " [WT]" : ""}`,
        phase: phases.get(item.id)!,
        ...(recent
          ? {
              subline:
                projects.find((project) => project.id === item.projectId)?.title ??
                "Unknown project",
            }
          : {}),
      }));
  const empty = archived
    ? archivedStatus === "loading"
      ? "Loading archived threads..."
      : archivedStatus === "error"
        ? "Could not load archives. R retries."
        : "No archived threads."
    : error
      ? "Connection unavailable. R retries."
      : !loaded
        ? "Loading your workspace..."
        : browsingProjects
          ? "No projects in this environment."
          : recent
            ? "No active threads in this environment."
            : "No active threads in this project.";
  const navigation = (
    <Stack flexDirection="column" height="100%" gap={1}>
      <Text
        id="sidebar-view-toggle"
        height={1}
        tone="accent"
        wrapMode="none"
        truncate
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onToggleSidebarView?.();
        }}
      >
        {archived
          ? "Projects Recent [Archived]"
          : recent
            ? "Projects [Recent] Archived"
            : "[Projects] Recent Archived"}
      </Text>
      <List
        items={items}
        selectedId={browsingProjects ? state.projectId : state.threadId}
        count={Math.max(1, Math.floor((layout.contentHeight - 4) / (recent ? 2 : 1)))}
        empty={empty}
        active={!conversation}
        visible={state.modal === null}
        onActivate={(id) => {
          if (browsingProjects) {
            const selected = projects.find((item) => item.id === id);
            if (selected) onOpenProject?.(selected.id);
            return;
          }
          const selected = visibleThreads.find((item) => item.id === id);
          if (selected) onOpenThread?.(selected.projectId, selected.id);
        }}
      />
      <Text height={1} tone="muted" wrapMode="none" truncate>
        {browsingProjects
          ? "Enter to browse threads"
          : conversation
            ? "Esc to browse threads"
            : archived
              ? "Enter to manage / restore"
              : recent
                ? "Ctrl+B to archived"
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
        {onNewProject ? (
          <Stack
            id="new-project-action"
            height={1}
            width={17}
            flexShrink={0}
            onMouseDown={(event) => {
              if (event.button !== 0 || state.modal !== null) return;
              event.preventDefault();
              event.stopPropagation();
              onNewProject();
            }}
          >
            <Text tone="accent" strong height={1}>
              [+ New project]
            </Text>
          </Stack>
        ) : null}
        {onOpenPalette && width >= 90 ? (
          <Stack
            id="open-command-palette"
            height={1}
            width={12}
            flexShrink={0}
            onMouseDown={(event) => {
              if (event.button !== 0 || state.modal !== null || managementOverlay) return;
              event.preventDefault();
              event.stopPropagation();
              onOpenPalette();
            }}
          >
            <Text tone="accent" strong height={1}>
              [ Search ]
            </Text>
          </Stack>
        ) : null}
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
        {selectedThread && onManageThread ? (
          <Stack
            id="manage-thread-action"
            height={1}
            width={11}
            flexShrink={0}
            onMouseDown={(event) => {
              if (event.button !== 0 || state.modal !== null || managementOverlay) return;
              event.preventDefault();
              event.stopPropagation();
              onManageThread();
            }}
          >
            <Text tone="accent" strong height={1}>
              [ Manage ]
            </Text>
          </Stack>
        ) : null}
        {onOpenArchived ? (
          <Stack
            id="archived-threads-action"
            height={1}
            width={12}
            flexShrink={0}
            onMouseDown={(event) => {
              if (event.button !== 0 || state.modal !== null || managementOverlay) return;
              event.preventDefault();
              event.stopPropagation();
              onOpenArchived();
            }}
          >
            <Text tone="accent" strong height={1}>
              [ Archived ]
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
          visible={state.modal === null && !managementOverlay}
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
            title={
              state.modal === "new-thread"
                ? "New thread"
                : state.modal === "new-project"
                  ? "New project"
                  : "Help"
            }
            borderTone="borderFocused"
            flexDirection="column"
          >
            {state.modal === "new-thread" || state.modal === "new-project" ? (
              modalContent
            ) : (
              <Help />
            )}
          </Panel>
        ) : null}
        {managementOverlay ? (
          <Panel
            id="thread-management-overlay"
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            title={managementOverlay.title}
            borderTone="borderFocused"
            flexDirection="column"
          >
            {managementOverlay.content}
          </Panel>
        ) : null}
      </Stack>
      {notice ? (
        <Stack height={2} flexShrink={0}>
          <Text
            height={1}
            flexShrink={0}
            tone={notice.failed ? "danger" : "success"}
            wrapMode="none"
            truncate
          >
            {notice.text}
          </Text>
        </Stack>
      ) : (
        <HotkeyBar
          width={Math.max(1, width - 2)}
          context={
            managementOverlay?.context ??
            (state.modal === "new-thread"
              ? "New thread"
              : state.modal === "new-project"
                ? "New project"
                : state.modal
                  ? "Help"
                  : conversation
                    ? (hotkeys?.context ?? "Conversation")
                    : browsingProjects
                      ? "Projects"
                      : "Threads")
          }
          hints={
            managementOverlay?.hints ??
            (state.modal === "new-thread" || state.modal === "new-project"
              ? [
                  { key: "Tab", label: "Next field" },
                  { key: "Enter", label: "Activate" },
                  { key: "Esc", label: "Close" },
                ]
              : state.modal
                ? [{ key: "Esc", label: "Close" }]
                : conversation
                  ? (hotkeys?.hints ?? [
                      { key: "Enter", label: "Write" },
                      { key: "Esc", label: "Threads" },
                    ])
                  : navigationHints)
          }
        />
      )}
    </Stack>
  );
}
