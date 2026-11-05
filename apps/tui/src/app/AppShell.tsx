import type { TuiLatestTurn, TuiThreadShell } from "../connection/models.ts";
/** @jsxImportSource react */
import { useEffect, useReducer, useCallback, type ReactNode } from "react";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { threadActivityPhase, type ThreadActivityPhase } from "../features/chat/threadActivity.ts";
import {
  AnimationGate,
  ThreadActivityIndicator,
  useChangeHighlight,
} from "../ui/ThreadActivityIndicator.tsx";
import { TurnTiming } from "../ui/TurnTiming.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { useThemeColor, useUi } from "../ui/context.tsx";
import { BREAKPOINTS, calculateShellLayout, clampBox, MINIMUM_SIZE } from "../ui/layout.ts";
import { inlineTerminalText, truncateEnd } from "../ui/textLayout.ts";
import { HotkeyBar } from "../ui/HotkeyBar.tsx";
import { Button } from "../ui/Button.tsx";
import { ListView } from "../ui/ListView.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateMessage.tsx";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge.tsx";
import { FormInput } from "../ui/FormField.tsx";
import { resolveGlyph } from "../ui/glyphs.tsx";
import type { Toast } from "../ui/StatusLine.tsx";
import { ShelfSidebar } from "./ShelfSidebar.tsx";
import type { ShelfRow } from "./threadShelves.ts";
import {
  createInitialShellState,
  dispatchShellCommand,
  sidebarProjects,
  sidebarThreads,
  type ShellCommand,
  type ShellRoute,
  type ShellRows,
  type ShellState,
} from "./state.ts";

/** The GUI-style sidebar's rows, built once by the owner because keys need them too. */
export interface ShelvesView {
  readonly rows: readonly ShelfRow[];
  readonly cursor: number;
  readonly marked: ReadonlySet<TuiThreadShell["id"]>;
  readonly scopeTitle: string | null;
  readonly onActivate: (
    row: ShelfRow,
    modifiers: { readonly shift: boolean; readonly ctrl: boolean },
  ) => void;
  readonly onSearch: () => void;
  readonly onChooseScope: () => void;
}

/** One entry of the overlay stack. Lower entries stay mounted so they keep their state. */
export interface ShellOverlayView {
  readonly title?: string;
  /** Floating content positions itself; everything else opens in a panel over the body. */
  readonly floating?: boolean;
  /** Preferred size, clamped to the body. Omitted panels fill the body. */
  readonly size?: { readonly width: number; readonly height: number };
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
  readonly notice?: Toast | null;
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
  /** Another dialog sits above the shell. Only matters when panels have no background to cover it. */
  readonly behindDialog?: boolean;
  readonly filtering?: boolean;
  readonly onFilterChange?: (filter: string) => void;
  readonly onOpenArchived?: () => void;
  readonly onManageThread?: () => void;
  readonly onOpenPalette?: () => void;
  readonly onToggleSidebarView?: () => void;
  /** Present while the shelves layout lists threads; the archived view keeps the flat list. */
  readonly shelves?: ShelvesView | null;
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

const SIDEBAR_TABS = [
  { id: "projects", label: "Projects" },
  { id: "recent", label: "Recent" },
  { id: "archived", label: "Archived" },
] as const;

const PHASE_PRIORITY: { readonly [Phase in ThreadActivityPhase]: number } = {
  idle: 0,
  completed: 1,
  stale: 2,
  starting: 3,
  running: 4,
  failed: 5,
  waiting_for_input: 6,
  waiting_for_approval: 7,
};

type SidebarRow =
  | {
      readonly kind: "project";
      readonly id: ProjectId;
      readonly project: OrchestrationProjectShell;
      readonly phase: ThreadActivityPhase;
      readonly count: number;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "thread";
      readonly id: ThreadId;
      readonly thread: TuiThreadShell;
      readonly phase: ThreadActivityPhase;
      readonly indent: boolean;
      readonly subline?: string;
    }
  | { readonly kind: "placeholder"; readonly id: string };

/** A row flashes once when its state changes, so a thread needing attention is noticed. */
function ChangeHighlight({
  value,
  children,
}: {
  readonly value: string;
  readonly children?: ReactNode;
}) {
  const highlighted = useChangeHighlight(value);
  const color = useThemeColor("hover");
  return (
    <Stack
      flexDirection="column"
      width="100%"
      {...(highlighted && color ? { backgroundColor: color } : {})}
    >
      {children}
    </Stack>
  );
}

function ThreadRowTrailing({
  phase,
  latestTurn,
  runningSince,
  visible,
}: {
  readonly phase: ThreadActivityPhase;
  readonly latestTurn: TuiLatestTurn | null;
  readonly runningSince: string | null;
  readonly visible: boolean;
}) {
  // An idle row keeps the whole width for its title.
  if (phase === "idle") return null;
  return (
    <Stack flexDirection="row" flexShrink={0}>
      {phase === "running" || phase === "starting" ? (
        <TurnTiming turn={latestTurn} runningSince={runningSince} compact />
      ) : null}
      <ThreadActivityIndicator phase={phase} compact visible={visible} />
    </Stack>
  );
}

// Fits the longest status with the widest glyph, "... Reconnecting", so it never clips or shifts.
const STATUS_WIDTH = 16;

function Header({
  width,
  breadcrumb,
  unicode,
  label,
  status,
  error,
  overlayOpen,
  onNewProject,
  onNewThread,
  onOpenPalette,
  onManageThread,
  onOpenArchived,
}: {
  readonly width: number;
  readonly breadcrumb: string;
  readonly unicode: boolean;
  readonly label: string;
  readonly status: string;
  readonly error: boolean;
  readonly overlayOpen: boolean;
  readonly onNewProject: (() => void) | undefined;
  readonly onNewThread: (() => void) | undefined;
  readonly onOpenPalette: (() => void) | undefined;
  readonly onManageThread: (() => void) | undefined;
  readonly onOpenArchived: (() => void) | undefined;
}) {
  const tone: StatusTone = error
    ? "danger"
    : status === "Connected"
      ? "success"
      : status === "Offline"
        ? "warning"
        : "pending";
  // Buttons appear in priority order as width allows, and their order never changes.
  // The location comes first: a button only appears once the breadcrumb has its room.
  const available =
    width -
    8 -
    STATUS_WIDTH -
    2 -
    Math.max(16, Math.min(breadcrumb.length, Math.floor(width * 0.6)));
  const candidates = [
    { id: "new-thread-action", label: "[+ New thread]", onPress: onNewThread },
    { id: "new-project-action", label: "[+ New project]", onPress: onNewProject },
    { id: "open-command-palette", label: "[ Search ]", onPress: onOpenPalette },
    { id: "manage-thread-action", label: "[ Manage ]", onPress: onManageThread },
    { id: "archived-threads-action", label: "[ Archived ]", onPress: onOpenArchived },
  ];
  const shown = new Set();
  let used = 0;
  for (const candidate of candidates) {
    if (!candidate.onPress) continue;
    if (used + candidate.label.length + 1 > available) break;
    used += candidate.label.length + 1;
    shown.add(candidate.id);
  }
  // Where you are matters more than which environment this is, so the label takes only spare room.
  const showLabel =
    width >= BREAKPOINTS.wide &&
    label.length > 0 &&
    width - 8 - STATUS_WIDTH - 1 - used - breadcrumb.length - 1 >= label.length;
  return (
    <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
      <Text strong tone="accent" flexShrink={0} height={1}>
        T3 TUI
      </Text>
      <Text
        tone="text"
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minWidth={0}
        height={1}
        wrapMode="none"
      >
        {truncateEnd(breadcrumb, width - 8 - STATUS_WIDTH - 2 - used, unicode)}
      </Text>
      {showLabel ? (
        <Text
          tone="muted"
          flexShrink={1}
          minWidth={0}
          maxWidth={24}
          height={1}
          wrapMode="none"
          truncate
        >
          {inlineTerminalText(label)}
        </Text>
      ) : null}
      {candidates.map((candidate) =>
        shown.has(candidate.id) ? (
          <Button
            key={candidate.id}
            id={candidate.id}
            label={candidate.label}
            tone="accent"
            disabled={overlayOpen}
            {...(candidate.onPress ? { onPress: candidate.onPress } : {})}
          />
        ) : null,
      )}
      <StatusBadge
        id="connection-status"
        label={status}
        tone={tone}
        width={STATUS_WIDTH}
        flexShrink={0}
      />
    </Stack>
  );
}

function TooSmall({ width, height }: { readonly width: number; readonly height: number }) {
  return (
    <Stack
      id="terminal-too-small"
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={500}
      flexDirection="column"
    >
      <Text tone="warning" strong wrapMode="word">
        Terminal too small
      </Text>
      <Text tone="muted" wrapMode="word">
        {`${width}x${height}. Resize to at least ${MINIMUM_SIZE.width}x${MINIMUM_SIZE.height}.`}
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
  notice,
  children,
  onOpenProject,
  onOpenThread,
  onThreadContextMenu,
  onProjectContextMenu,
  onNewProject,
  onNewThread,
  overlays = [],
  behindDialog = false,
  filtering = false,
  onFilterChange,
  onOpenArchived,
  onManageThread,
  onOpenPalette,
  onToggleSidebarView,
  shelves = null,
}: AppShellViewProps) {
  const layout = calculateShellLayout(width, height);
  const { capabilities } = useUi();
  const overlayOpen = overlays.length > 0;
  // A sized or floating overlay leaves the workspace visible around it, so it keeps animating too.
  // Without color a panel has no background to cover it, so any overlay hides the body instead.
  const bodyCovered =
    behindDialog ||
    overlays.some((overlay) => !capabilities.color || (!overlay.floating && !overlay.size));
  const background = useThemeColor("panel");
  const project = projects.find((item) => item.id === state.projectId);
  const archived = state.sidebarView === "archived";
  const recent = state.sidebarView === "recent" || archived;
  const allProjectThreads = threads.filter((item) => item.projectId === state.projectId);
  const shelfRow = shelves?.rows[shelves.cursor];
  // On a shelf header nothing is selected, so nothing below may claim a thread is.
  const selectedThread =
    shelves && state.route !== "conversation"
      ? shelfRow?.kind === "thread"
        ? shelfRow.thread
        : undefined
      : allProjectThreads.find((item) => item.id === state.threadId);
  const browsingProjects = !recent && state.route === "projects";
  const visibleThreads = sidebarThreads(threads, state);
  const projectThreads = visibleThreads.filter((item) => item.projectId === state.projectId);
  const conversation = state.route === "conversation";
  const listedProjects = sidebarProjects(projects, threads, state);
  const title = shelves
    ? `Inbox (${shelves.rows.filter((row) => row.kind === "thread" && (row.shelf === "active" || row.shelf === "pinned")).length})${shelves.marked.size > 0 ? ` - ${shelves.marked.size} selected` : ""}`
    : recent
      ? `${archived ? "Archived" : "Recent"} threads (${visibleThreads.length})`
      : browsingProjects
        ? `Projects (${listedProjects.length})`
        : `Threads (${projectThreads.length}) - ${inlineTerminalText(project?.title ?? "")}`;
  const projectActivity = new Map<ProjectId, ThreadActivityPhase>();
  const phases = new Map(
    threads.map((thread) => {
      const phase = threadActivityPhase(environmentId, thread, live);
      if (PHASE_PRIORITY[phase] > PHASE_PRIORITY[projectActivity.get(thread.projectId) ?? "idle"])
        projectActivity.set(thread.projectId, phase);
      return [thread.id, phase] as const;
    }),
  );
  const expanded = new Set(state.expandedProjects ?? []);
  const threadRow = (thread: TuiThreadShell, indent: boolean, subline?: string): SidebarRow => ({
    kind: "thread",
    id: thread.id,
    thread,
    phase: phases.get(thread.id) ?? "idle",
    indent,
    ...(subline === undefined ? {} : { subline }),
  });
  const rows: readonly SidebarRow[] = recent
    ? visibleThreads.map((thread) =>
        threadRow(
          thread,
          false,
          projects.find((item) => item.id === thread.projectId)?.title ?? "Unknown project",
        ),
      )
    : listedProjects.flatMap((item): readonly SidebarRow[] => {
        const children = visibleThreads.filter((thread) => thread.projectId === item.id);
        // Entering a project shows its threads. A filter also opens everything it matched.
        const isExpanded =
          expanded.has(item.id) ||
          Boolean(state.filter) ||
          (item.id === state.projectId && state.route !== "projects");
        return [
          {
            kind: "project",
            id: item.id,
            project: item,
            // A finished turn is not news at the project level.
            phase:
              projectActivity.get(item.id) === "completed"
                ? "idle"
                : (projectActivity.get(item.id) ?? "idle"),
            count: children.length,
            expanded: isExpanded,
          },
          ...(isExpanded
            ? children.length > 0
              ? children.map((thread) => threadRow(thread, true))
              : [{ kind: "placeholder" as const, id: `empty-${item.id}` }]
            : []),
        ];
      });
  const selectedRowId = browsingProjects ? state.projectId : state.threadId;
  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === selectedRowId),
  );
  const emptyList = archived ? (
    archivedStatus === "loading" ? (
      <LoadingState title="Loading archived threads..." />
    ) : archivedStatus === "error" ? (
      <ErrorState title="Could not load archives. R retries." />
    ) : (
      <EmptyState title="No archived threads." />
    )
  ) : error ? (
    <ErrorState title="Connection unavailable. R retries." />
  ) : !loaded ? (
    <LoadingState title="Loading your workspace..." />
  ) : state.filter ? (
    <EmptyState title="Nothing matches the filter." description="Esc clears it." />
  ) : browsingProjects ? (
    <EmptyState title="No projects in this environment." description="Press P to add one." />
  ) : recent ? (
    <EmptyState
      title="No active threads in this environment."
      description="Open a project and press N."
    />
  ) : (
    <EmptyState title="No active threads in this project." description="Press N to start one." />
  );
  const showFilter = filtering || Boolean(state.filter);
  const navigation = shelves ? (
    <ShelfSidebar
      rows={shelves.rows}
      cursor={shelves.cursor}
      marked={shelves.marked}
      height={layout.contentHeight}
      width={Math.max(1, (layout.split ? layout.sidebarWidth : layout.mainWidth) - 4)}
      hasProjects={projects.length > 0}
      loaded={loaded}
      error={error}
      filter={state.filter}
      filtering={filtering && !overlayOpen && !conversation}
      scopeTitle={shelves.scopeTitle}
      focused={!conversation}
      projectTitle={(thread) =>
        projects.find((item) => item.id === thread.projectId)?.title ?? "Unknown project"
      }
      onFilterChange={onFilterChange}
      onSearch={shelves.onSearch}
      onChooseScope={shelves.onChooseScope}
      onNewThread={onNewThread}
      onActivate={shelves.onActivate}
      onThreadContextMenu={onThreadContextMenu}
    />
  ) : (
    <Stack flexDirection="column" height="100%">
      {state.sidebarLayout === "shelves" ? (
        <Button
          id="sidebar-back-to-threads"
          label="[< Back to threads]"
          tone="accent"
          {...(onToggleSidebarView ? { onPress: onToggleSidebarView } : {})}
        />
      ) : (
        <Tabs
          id="sidebar-view-toggle"
          tabs={SIDEBAR_TABS}
          selected={state.sidebarView ?? "projects"}
          {...(onToggleSidebarView ? { onPress: onToggleSidebarView } : {})}
        />
      )}
      <Stack height={1} flexShrink={0} flexDirection="row">
        {showFilter ? (
          <>
            <Text height={1} flexShrink={0} tone="accent">
              {"/ "}
            </Text>
            <FormInput
              id="sidebar-filter"
              value={state.filter ?? ""}
              placeholder="Filter..."
              focused={filtering && !overlayOpen && !conversation}
              onInput={(value) => onFilterChange?.(value)}
            />
          </>
        ) : null}
      </Stack>
      <ListView
        items={rows}
        selected={selectedIndex}
        height={Math.max(1, layout.contentHeight - 2)}
        rowHeight={recent ? 2 : 1}
        itemKey={(row) => `${row.kind}:${row.id}`}
        itemId={(row) => `navigation-${row.id}`}
        empty={emptyList}
        onActivate={(row) => {
          if (row.kind === "project") onOpenProject?.(row.id);
          else if (row.kind === "thread") onOpenThread?.(row.thread.projectId, row.id);
        }}
        onContextMenu={(row, position) => {
          if (row.kind === "project") onProjectContextMenu?.(row.id, position);
          else if (row.kind === "thread") onThreadContextMenu?.(row.thread, position);
        }}
        renderItem={(row) =>
          row.kind === "placeholder" ? (
            <Text height={1} tone="muted" dim wrapMode="none" truncate>
              {"    No active threads. N starts one."}
            </Text>
          ) : row.kind === "project" ? (
            <SelectionRow
              selected={browsingProjects && row.id === state.projectId}
              active={!conversation}
              label={inlineTerminalText(row.project.title)}
              trailing={
                <Stack flexDirection="row" flexShrink={0}>
                  <ThreadActivityIndicator phase={row.phase} compact visible={!overlayOpen} />
                  <Text height={1} flexShrink={0} tone="muted" wrapMode="none">
                    {` ${row.count} ${resolveGlyph(row.expanded ? "expanded" : "collapsed", capabilities.unicode)}`}
                  </Text>
                </Stack>
              }
            />
          ) : (
            <ChangeHighlight value={row.phase}>
              <Stack
                flexDirection="column"
                width="100%"
                {...(row.indent ? { paddingLeft: 2 } : {})}
              >
                <SelectionRow
                  selected={row.id === state.threadId && !browsingProjects}
                  active={!conversation}
                  label={`${row.thread.title}${row.thread.worktreePath ? " [WT]" : ""}`}
                  trailing={
                    <ThreadRowTrailing
                      phase={row.phase}
                      latestTurn={row.thread.latestTurn}
                      runningSince={row.thread.session?.updatedAt ?? null}
                      visible={!overlayOpen}
                    />
                  }
                />
                {row.subline ? (
                  <Text height={1} tone="muted" dim wrapMode="none" truncate>
                    {`    ${inlineTerminalText(row.subline)}`}
                  </Text>
                ) : null}
              </Stack>
            </ChangeHighlight>
          )
        }
      />
    </Stack>
  );
  // Says only what is true right now: no promises about opening things that are not there.
  const previewFacts: readonly string[] = browsingProjects
    ? project
      ? [`${projectThreads.length} active threads`, "Enter opens the project. N starts a thread."]
      : !loaded
        ? []
        : ["P adds a project."]
    : selectedThread
      ? [
          `Model  ${inlineTerminalText(selectedThread.modelSelection.model)}`,
          ...(shelves && selectedThread.branch
            ? [`Branch  ${inlineTerminalText(selectedThread.branch)}`]
            : []),
          ...(shelves
            ? visibleThreadPullRequests(selectedThread.pullRequests).map(
                (link) =>
                  `PR #${link.number}  ${inlineTerminalText(link.snapshot?.title ?? link.url)}`,
              )
            : []),
          ...(shelves && selectedThread.session?.lastError
            ? [`Error  ${inlineTerminalText(selectedThread.session.lastError)}`]
            : []),
          archived ? "Enter restores or deletes it." : "Enter opens the conversation.",
        ]
      : [
          archived
            ? "Nothing is archived."
            : shelfRow?.kind === "shelf"
              ? "Enter or Space opens this shelf."
              : shelfRow?.kind === "more"
                ? "Enter shows more."
                : shelfRow?.kind === "project-scope"
                  ? "Enter chooses a project."
                  : "No thread selected.",
        ];
  const preview = (
    <Stack flexDirection="column" paddingTop={1} gap={1}>
      <Text strong tone="accent" wrapMode="none" truncate>
        {inlineTerminalText(
          browsingProjects
            ? (project?.title ?? "Your workspace")
            : (selectedThread?.title ?? (archived ? "Archived threads" : "Choose a thread")),
        )}
      </Text>
      {project && (browsingProjects || selectedThread) ? (
        <Text tone="muted" wrapMode="none" truncate>
          {inlineTerminalText(project.workspaceRoot)}
        </Text>
      ) : null}
      {previewFacts.map((fact) => (
        <Text key={fact} tone="muted">
          {fact}
        </Text>
      ))}
      <Text tone="muted">
        Shared with your T3 environment. Agents keep running when this client closes.
      </Text>
    </Stack>
  );
  const breadcrumb = inlineTerminalText(
    [project?.title, conversation || !browsingProjects ? selectedThread?.title : undefined]
      .filter(Boolean)
      .join(capabilities.unicode ? " › " : " > "),
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
      <Stack visible={!layout.tooSmall} width="100%" height="100%" flexDirection="column">
        <Header
          width={Math.max(1, width - 2)}
          breadcrumb={breadcrumb}
          unicode={capabilities.unicode}
          label={label}
          status={status}
          error={error}
          overlayOpen={overlayOpen}
          onNewProject={onNewProject}
          onNewThread={project ? onNewThread : undefined}
          onOpenPalette={onOpenPalette}
          onManageThread={selectedThread ? onManageThread : undefined}
          onOpenArchived={onOpenArchived}
        />
        {layout.headerGap ? <Stack height={1} flexShrink={0} /> : null}
        <Stack height={layout.bodyHeight} flexShrink={0} flexDirection="row" gap={1}>
          <AnimationGate visible={!bodyCovered}>
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
          </AnimationGate>
          {overlays
            .filter((overlay) => !overlay.floating)
            .map((overlay) => {
              const box = overlay.size
                ? clampBox(
                    { width: Math.max(1, width - 2), height: layout.bodyHeight },
                    overlay.size,
                  )
                : { left: 0, top: 0, width: "100%" as const, height: "100%" as const };
              return (
                <Panel
                  key={overlay.key}
                  id="thread-management-overlay"
                  visible={overlay.visible}
                  position="absolute"
                  top={box.top}
                  left={box.left}
                  width={box.width}
                  height={box.height}
                  zIndex={50}
                  {...(overlay.title ? { title: overlay.title } : {})}
                  borderTone="borderFocused"
                  flexDirection="column"
                >
                  {overlay.content}
                </Panel>
              );
            })}
        </Stack>
        <HotkeyBar width={Math.max(1, width - 2)} notice={notice ?? null} />
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
      {layout.tooSmall ? <TooSmall width={width} height={height} /> : null}
    </Stack>
  );
}
