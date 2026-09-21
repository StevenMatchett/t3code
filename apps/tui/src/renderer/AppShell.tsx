import { useAtomValue, RegistryContext } from "@effect/atom-react";
import {
  useKeyboard,
  useRenderer,
  useSelectionHandler,
  useTerminalDimensions,
} from "@opentui/react";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import { useMemo, useContext, useEffect, useState, useCallback } from "react";
import { calculateShellLayout } from "../ui/layout.ts";
import { AppShellView, useAppShellState } from "../app/AppShell.tsx";
import { shellCommandFromKey, type ShellRoute, type ShellState } from "../app/state.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Conversation } from "./Conversation.tsx";
import { NewThreadForm } from "./NewThreadForm.tsx";
import { NewProjectForm } from "./NewProjectForm.tsx";
import { ActivityClockProvider } from "../ui/ThreadActivityIndicator.tsx";
import { ArchivedThreadsPanel, ThreadActionsForm } from "./ThreadManagement.tsx";
import type { OrchestrationThreadShell } from "@t3tools/contracts";
import type { HotkeyState } from "../ui/HotkeyBar.tsx";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette.tsx";
import { ThreadDiff } from "./ThreadDiff.tsx";
import { QueuedMessages } from "./QueuedMessages.tsx";

type PaletteEntry = CommandPaletteItem & {
  readonly target:
    | { readonly type: "new-project" }
    | { readonly type: "new-thread" }
    | { readonly type: "archived" }
    | { readonly type: "help" }
    | { readonly type: "diff" }
    | { readonly type: "manage"; readonly thread: OrchestrationThreadShell }
    | { readonly type: "project"; readonly projectId: OrchestrationThreadShell["projectId"] }
    | {
        readonly type: "thread";
        readonly projectId: OrchestrationThreadShell["projectId"];
        readonly threadId: OrchestrationThreadShell["id"];
      };
};

function searchExcerpt(snippet: string, query: string) {
  const text = snippet.replace(/\s+/gu, " ").trim();
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, 100);
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + query.length + 52);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export interface AppShellProps {
  readonly client: TuiClient;
  readonly initialRoute?: ShellRoute;
  readonly onStateChange?: (state: ShellState) => void;
  readonly active?: boolean;
  readonly onTerminalFocusChange?: (focused: boolean) => void;
  readonly searchDebounceMs?: number;
}

export function AppShell({
  client,
  initialRoute = "projects",
  onStateChange,
  active = true,
  onTerminalFocusChange,
  searchDebounceMs = 200,
}: AppShellProps) {
  const renderer = useRenderer();
  const shell = useAtomValue(client.shell);
  const connection = useAtomValue(client.connection);
  const registry = useContext(RegistryContext);
  const { width, height } = useTerminalDimensions();
  const layout = calculateShellLayout(width, height);
  const [hotkeys, setHotkeys] = useState<HotkeyState>({ context: "Conversation", hints: [] });
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [paletteSearchQuery, setPaletteSearchQuery] = useState("");
  const threadSearch = useAtomValue(client.threadSearch(paletteSearchQuery));
  const [copyNotice, setCopyNotice] = useState<{
    readonly text: string;
    readonly failed: boolean;
  } | null>(null);
  useSelectionHandler((selection) => {
    const text = selection.getSelectedText();
    if (!text) return;
    const copied = renderer.copyToClipboardOSC52(text);
    setCopyNotice({
      text: copied ? "Copied to clipboard." : "Copy unavailable in this terminal.",
      failed: !copied,
    });
  });
  useEffect(() => {
    if (!copyNotice) return;
    const fiber = Effect.runFork(
      Effect.sleep("2 seconds").pipe(
        Effect.andThen(
          Effect.sync(() => setCopyNotice((current) => (current === copyNotice ? null : current))),
        ),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [copyNotice]);
  const snapshot = Option.getOrNull(shell.snapshot);
  const rows = useMemo(
    () => ({
      projects: [...(snapshot?.projects ?? [])].sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      ),
      threads: [...(snapshot?.threads ?? [])]
        .filter((thread) => thread.archivedAt === null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
    }),
    [snapshot],
  );
  const [state, dispatch] = useAppShellState(rows, snapshot !== null, initialRoute, onStateChange);
  const [threadOverlay, setThreadOverlay] = useState<
    | { readonly type: "palette" }
    | { readonly type: "diff" }
    | { readonly type: "archived" }
    | {
        readonly type: "manage";
        readonly thread: OrchestrationThreadShell;
        readonly returnToArchived: boolean;
      }
    | null
  >(null);
  const selectedThread = rows.threads.find((thread) => thread.id === state.threadId) ?? null;
  const openPalette = () => {
    setPaletteSearchQuery("");
    setThreadOverlay({ type: "palette" });
  };
  const closePalette = () => {
    setPaletteSearchQuery("");
    setThreadOverlay(null);
  };
  const handleTerminalFocusChange = useCallback(
    (focused: boolean) => {
      setTerminalFocused(focused);
      onTerminalFocusChange?.(focused);
    },
    [onTerminalFocusChange],
  );
  const paletteEntries = useMemo<readonly PaletteEntry[]>(() => {
    const contentMatchByThreadId = new Map(
      threadSearch.matches.map((match) => [match.threadId, match] as const),
    );
    const commands: PaletteEntry[] = [
      {
        id: "command:new-project",
        label: "New project",
        detail: "Command",
        keywords: "add workspace local folder github clone",
        target: { type: "new-project" },
      },
      {
        id: "command:archived",
        label: "Show archived threads",
        detail: "Command",
        keywords: "restore history",
        target: { type: "archived" },
      },
      {
        id: "command:help",
        label: "Show keyboard help",
        detail: "Command",
        keywords: "shortcuts hotkeys",
        target: { type: "help" },
      },
    ];
    if (state.projectId)
      commands.splice(1, 0, {
        id: "command:new-thread",
        label: "New thread",
        detail: "Command",
        keywords: "conversation task worktree",
        target: { type: "new-thread" },
      });
    if (selectedThread)
      commands.push({
        id: "command:diff",
        label: "View thread changes",
        detail: "Command",
        keywords: "diff files additions deletions",
        target: { type: "diff" },
      });
    if (selectedThread)
      commands.splice(2, 0, {
        id: "command:manage-thread",
        label: `Manage ${selectedThread.title}`,
        detail: "Command",
        keywords: "rename archive delete",
        target: { type: "manage", thread: selectedThread },
      });
    return [
      ...commands,
      ...rows.projects.map((project): PaletteEntry => ({
        id: `project:${project.id}`,
        label: project.title,
        detail: `Project · ${project.workspaceRoot}`,
        keywords: "workspace repository",
        target: { type: "project", projectId: project.id },
      })),
      ...rows.threads.map((thread): PaletteEntry => {
        const project = rows.projects.find((item) => item.id === thread.projectId);
        const contentMatch = contentMatchByThreadId.get(thread.id);
        const contentLabel = contentMatch
          ? `${contentMatch.source === "user" ? "You" : "Assistant"}: ${searchExcerpt(contentMatch.snippet, paletteSearchQuery)}`
          : null;
        return {
          id: `thread:${thread.id}`,
          label: thread.title,
          detail: contentLabel
            ? `${contentLabel} · ${project?.title ?? "Unknown project"}`
            : `Thread · ${project?.title ?? "Unknown project"}`,
          keywords: `${thread.modelSelection.model} conversation ${contentMatch?.snippet ?? ""}`,
          target: { type: "thread", projectId: thread.projectId, threadId: thread.id },
        };
      }),
    ];
  }, [
    paletteSearchQuery,
    rows.projects,
    rows.threads,
    selectedThread,
    state.projectId,
    threadSearch.matches,
  ]);
  const choosePaletteEntry = (id: string) => {
    const entry = paletteEntries.find((item) => item.id === id);
    if (!entry) return;
    closePalette();
    switch (entry.target.type) {
      case "diff":
        setThreadOverlay({ type: "diff" });
        break;
      case "new-project":
        dispatch({ type: "new-project" });
        break;
      case "new-thread":
        dispatch({ type: "new-thread" });
        break;
      case "archived":
        setThreadOverlay({ type: "archived" });
        break;
      case "help":
        dispatch({ type: "toggle-help" });
        break;
      case "manage":
        setThreadOverlay({ type: "manage", thread: entry.target.thread, returnToArchived: false });
        break;
      case "project":
        dispatch({ type: "open-project", projectId: entry.target.projectId });
        break;
      case "thread":
        dispatch({
          type: "open-thread",
          projectId: entry.target.projectId,
          threadId: entry.target.threadId,
        });
        break;
    }
  };
  useKeyboard((key) => {
    if (!active || terminalFocused) return;
    if (
      key.ctrl &&
      key.name.toLowerCase() === "k" &&
      state.modal === null &&
      threadOverlay === null
    ) {
      key.preventDefault();
      key.stopPropagation();
      openPalette();
      return;
    }
    if (threadOverlay) return;
    if (
      state.route !== "conversation" &&
      !key.ctrl &&
      !key.meta &&
      !key.option &&
      state.modal === null
    ) {
      if (key.name.toLowerCase() === "d" && selectedThread) {
        key.preventDefault();
        key.stopPropagation();
        setThreadOverlay({ type: "diff" });
        return;
      }
      if (key.name.toLowerCase() === "m" && selectedThread) {
        key.preventDefault();
        key.stopPropagation();
        setThreadOverlay({ type: "manage", thread: selectedThread, returnToArchived: false });
        return;
      }
      if (key.name.toLowerCase() === "a" && key.shift) {
        key.preventDefault();
        key.stopPropagation();
        setThreadOverlay({ type: "archived" });
        return;
      }
    }
    if (
      key.ctrl ||
      key.meta ||
      key.option ||
      state.modal === "new-thread" ||
      state.modal === "new-project" ||
      (state.route === "conversation" && state.modal === null)
    )
      return;
    if (!state.modal && key.name === "r") {
      key.preventDefault();
      key.stopPropagation();
      void client.retry(registry);
      return;
    }
    const command = shellCommandFromKey(key);
    if (
      command === undefined ||
      (!state.modal && state.route === "conversation" && command.type === "move")
    )
      return;
    key.preventDefault();
    key.stopPropagation();
    dispatch(command);
  });
  const status =
    connection.phase === "connected"
      ? Option.isSome(shell.error)
        ? "Sync failed"
        : shell.status === "live"
          ? "Connected"
          : "Syncing"
      : connection.phase === "blocked"
        ? "Access blocked"
        : connection.phase === "backoff"
          ? "Reconnecting"
          : connection.phase === "offline"
            ? "Offline"
            : "Connecting";
  return (
    <ActivityClockProvider>
      <QueuedMessages client={client} />
      <AppShellView
        environmentId={client.environmentId}
        live={
          connection.phase === "connected" && shell.status === "live" && Option.isNone(shell.error)
        }
        state={state}
        label={client.label}
        status={status}
        projects={rows.projects}
        threads={rows.threads}
        loaded={snapshot !== null}
        error={Option.isSome(shell.error) || connection.phase === "blocked"}
        width={width}
        height={height}
        hotkeys={hotkeys}
        notice={copyNotice}
        managementOverlay={
          threadOverlay?.type === "diff" && state.threadId
            ? {
                title: "Thread changes",
                context: "Diff",
                hints: [
                  { key: "S/W", label: "Saved/working" },
                  { key: "[/]", label: "Change scope/turn" },
                  { key: "Tab", label: "Files/diff" },
                  { key: "R", label: "Refresh" },
                  { key: "Esc", label: "Close" },
                ],
                content: (
                  <ThreadDiff
                    client={client}
                    threadId={state.threadId}
                    active={active}
                    width={Math.max(1, width - 6)}
                    height={layout.contentHeight}
                    onClose={() => setThreadOverlay(null)}
                  />
                ),
              }
            : threadOverlay?.type === "palette"
              ? {
                  title: "Search and commands",
                  context: "Command palette",
                  hints: [
                    { key: "Type", label: "Filter" },
                    { key: "↑↓", label: "Select" },
                    { key: "Enter", label: "Open" },
                    { key: "Esc", label: "Close" },
                  ],
                  content: (
                    <CommandPalette
                      items={paletteEntries}
                      height={layout.contentHeight}
                      active={active}
                      searching={threadSearch.loading}
                      searchFailed={threadSearch.failed}
                      searchedQuery={paletteSearchQuery}
                      searchDebounceMs={searchDebounceMs}
                      onSearchQueryChange={setPaletteSearchQuery}
                      onChoose={choosePaletteEntry}
                      onClose={closePalette}
                    />
                  ),
                }
              : threadOverlay?.type === "archived"
                ? {
                    title: "Archived threads",
                    context: "Archived",
                    hints: [
                      { key: "↑↓", label: "Select" },
                      { key: "Enter", label: "Manage" },
                      { key: "R", label: "Refresh" },
                      { key: "Esc", label: "Close" },
                    ],
                    content: (
                      <ArchivedThreadsPanel
                        client={client}
                        active={active}
                        onClose={() => setThreadOverlay(null)}
                        onManage={(thread) =>
                          setThreadOverlay({ type: "manage", thread, returnToArchived: true })
                        }
                      />
                    ),
                  }
                : threadOverlay?.type === "manage"
                  ? {
                      title: threadOverlay.thread.archivedAt
                        ? "Manage archived thread"
                        : "Manage thread",
                      context: "Manage thread",
                      hints: [
                        { key: "Tab/↑↓", label: "Select" },
                        { key: "Enter", label: "Activate" },
                        { key: "Esc", label: "Close" },
                      ],
                      content: (
                        <ThreadActionsForm
                          client={client}
                          thread={threadOverlay.thread}
                          active={active}
                          onClose={() =>
                            setThreadOverlay(
                              threadOverlay.returnToArchived ? { type: "archived" } : null,
                            )
                          }
                          onRemoved={() => {
                            if (threadOverlay.returnToArchived) {
                              setThreadOverlay({ type: "archived" });
                            } else {
                              setThreadOverlay(null);
                              if (state.route === "conversation") dispatch({ type: "back" });
                            }
                          }}
                        />
                      ),
                    }
                  : null
        }
        onOpenArchived={() => setThreadOverlay({ type: "archived" })}
        onOpenPalette={openPalette}
        {...(selectedThread
          ? {
              onManageThread: () =>
                setThreadOverlay({
                  type: "manage",
                  thread: selectedThread,
                  returnToArchived: false,
                }),
            }
          : {})}
        onOpenProject={(projectId) => dispatch({ type: "open-project", projectId })}
        onOpenThread={(projectId, threadId) =>
          dispatch({ type: "open-thread", projectId, threadId })
        }
        onNewProject={() => dispatch({ type: "new-project" })}
        onNewThread={() => dispatch({ type: "new-thread" })}
        modalContent={
          state.modal === "new-project" ? (
            <NewProjectForm
              client={client}
              height={layout.contentHeight}
              onClose={() => dispatch({ type: "close-modal" })}
              onCreated={(projectId) => dispatch({ type: "open-project", projectId })}
            />
          ) : state.modal === "new-thread" ? (
            <NewThreadForm
              client={client}
              projectId={state.projectId}
              height={layout.contentHeight}
              onClose={() => dispatch({ type: "close-modal" })}
              onCreated={(projectId, threadId) =>
                dispatch({ type: "open-thread", projectId, threadId })
              }
            />
          ) : undefined
        }
      >
        {state.route === "conversation" && state.threadId !== null ? (
          <Conversation
            key={state.threadId}
            client={client}
            threadId={state.threadId}
            width={layout.contentWidth}
            height={layout.contentHeight}
            onHintsChange={setHotkeys}
            active={active && state.modal === null && threadOverlay === null}
            onBack={() => dispatch({ type: "back" })}
            onHelp={() => dispatch({ type: "toggle-help" })}
            onNewThread={() => dispatch({ type: "new-thread" })}
            onDiff={() => setThreadOverlay({ type: "diff" })}
            onTerminalFocusChange={handleTerminalFocusChange}
          />
        ) : null}
      </AppShellView>
    </ActivityClockProvider>
  );
}
