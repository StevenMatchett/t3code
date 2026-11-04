import type { TuiLatestTurn, TuiThreadShell } from "../connection/models.ts";
/** @jsxImportSource react */
import { useEffect, useReducer, useCallback, type ReactNode } from "react";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { threadActivityPhase, type ThreadActivityPhase } from "../features/chat/threadActivity.ts";
import { ThreadActivityIndicator } from "../ui/ThreadActivityIndicator.tsx";
import { TurnTiming } from "../ui/TurnTiming.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { useThemeColor } from "../ui/context.tsx";
import { calculateShellLayout } from "../ui/layout.ts";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { HotkeyBar } from "../ui/HotkeyBar.tsx";
import {
  isSidebarThreadVisible,
  createInitialShellState,
  dispatchShellCommand,
  type ShellCommand,
  type ShellRoute,
  type ShellRows,
  type ShellState,
} from "./state.ts";

/** One entry of the overlay stack. Lower entries stay mounted so they keep their state. */
export interface ShellOverlayView {
  readonly title?: string;
  /** Floating content positions itself; everything else fills the body in a panel. */
  readonly floating?: boolean;
  readonly content: ReactNode;
}

export interface AppShellViewProps {
  readonly environmentId: EnvironmentId;
  readonly live: boolean;
  readonly state: ShellState;
  readonly label: string;
  readonly status: string;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly threads: readonly TuiThreadShell[];
  readonly archivedStatus?: "loading" | "live" | "error";
  readonly loaded: boolean;
  readonly error: boolean;
  readonly width: number;
  readonly height: number;
  readonly notice?: {
    readonly text: string;
    readonly failed: boolean;
  } | null;
  readonly children?: ReactNode;
  readonly onOpenProject?: (projectId: ProjectId) => void;
  readonly onProjectContextMenu?: (
    projectId: ProjectId,
    position: { x: number; y: number },
  ) => void;
  readonly onThreadContextMenu?: (
    thread: TuiThreadShell,
    position: { x: number; y: number },
  ) => void;
  readonly onOpenThread?: (projectId: ProjectId, threadId: ThreadId) => void;
  readonly onNewProject?: () => void;
  readonly onNewThread?: () => void;
  readonly overlays?: ReadonlyArray<
    ShellOverlayView & { readonly key: string; readonly visible: boolean }
  >;
  readonly filtering?: boolean;
  readonly onFilterChange?: (filter: string) => void;
  readonly onToggleProject?: (projectId: ProjectId) => void;
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
  onContextMenu,
}: {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly subline?: string;
    readonly phase?: ThreadActivityPhase;
    readonly latestTurn?: TuiLatestTurn | null;
    readonly runningSince?: string | null;
  }>;
  readonly selectedId: string | null;
  readonly count: number;
  readonly empty: string;
  readonly active: boolean;
  readonly visible: boolean;
  readonly onContextMenu?: (id: string, position: { x: number; y: number }) => void;
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
              if (event.button === 2 && onContextMenu) {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(item.id, { x: event.x, y: event.y });
                return;
              }
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
                  <Stack flexDirection="row">
                    {item.phase === "running" || item.phase === "starting" ? (
                      <TurnTiming
                        turn={item.latestTurn ?? null}
                        runningSince={item.runningSince ?? null}
                        compact
                      />
                    ) : null}
                    <ThreadActivityIndicator phase={item.phase} compact visible={visible} />
                  </Stack>
                ) : undefined
              }
            />
            {item.subline ? (
              <Text
                height={1}
                tone="muted"
                dim
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
  notice,
  children,
  onOpenProject,
  onOpenThread,
  onThreadContextMenu,
  onProjectContextMenu,
  onNewProject,
  onNewThread,
  overlays = [],
  filtering = false,
  onFilterChange,
  onToggleProject,
  onOpenArchived,
  onManageThread,
  onOpenPalette,
  onToggleSidebarView,
}: AppShellViewProps) {
  const layout = calculateShellLayout(width, height);
  const overlayOpen = overlays.length > 0;
  // Floating dialogs keep the workspace visible behind them.
  const bodyCovered = overlays.some((overlay) => !overlay.floating);
  const background = useThemeColor("panel");
  const project = projects.find((item) => item.id === state.projectId);
  const archived = state.sidebarView === "archived";
  const recent = state.sidebarView === "recent" || archived;
  const projectThreads = threads.filter((item) => item.projectId === state.projectId);
  const selectedThread = projectThreads.find((item) => item.id === state.threadId);
  const browsingProjects = !recent && state.route === "projects";
  const visibleThreads = (recent ? threads : projectThreads).filter((thread) =>
    isSidebarThreadVisible(thread, state),
  );
  const conversation = state.route === "conversation";
  const title = recent
    ? `${archived ? "Archived" : "Recent"} threads (${visibleThreads.length})`
    : browsingProjects
      ? `Projects (${projects.length})`
      : `Threads (${visibleThreads.length}) - ${inlineTerminalText(project?.title ?? "")}`;
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
  const projectActivity = new Map<ProjectId, ThreadActivityPhase>();
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
        latestTurn: item.latestTurn,
        runningSince: item.session?.updatedAt ?? null,
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
        visible={!overlayOpen}
        onContextMenu={(id, position) => {
          if (browsingProjects) {
            const project = projects.find((item) => item.id === id);
            if (project) onProjectContextMenu?.(project.id, position);
            return;
          }
          const thread = visibleThreads.find((item) => item.id === id);
          if (thread) onThreadContextMenu?.(thread, position);
        }}
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
              if (event.button !== 0 || overlayOpen) return;
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
              if (event.button !== 0 || overlayOpen) return;
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
              if (event.button !== 0 || overlayOpen) return;
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
              if (event.button !== 0 || overlayOpen) return;
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
              if (event.button !== 0 || overlayOpen) return;
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
        <Stack visible={!bodyCovered} width="100%" height="100%" flexDirection="row" gap={1}>
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
        {overlays
          .filter((overlay) => !overlay.floating)
          .map((overlay) => (
            <Panel
              key={overlay.key}
              id="thread-management-overlay"
              visible={overlay.visible}
              position="absolute"
              top={0}
              left={0}
              width="100%"
              height="100%"
              {...(overlay.title ? { title: overlay.title } : {})}
              borderTone="borderFocused"
              flexDirection="column"
            >
              {overlay.content}
            </Panel>
          ))}
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
        <HotkeyBar width={Math.max(1, width - 2)} />
      )}
      {overlays
        .filter((overlay) => overlay.floating)
        .map((overlay) => (
          <Stack
            key={overlay.key}
            visible={overlay.visible}
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            zIndex={100}
          >
            {overlay.content}
          </Stack>
        ))}
    </Stack>
  );
}
