import type { TuiThreadShell } from "../connection/models.ts";
import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useMemo, useContext, useEffect, useState, useCallback, useRef } from "react";
import { sortSidebarThreads } from "../app/threadOrder.ts";
import { calculateShellLayout } from "../ui/layout.ts";
import { AppShellView, useAppShellState, type ShellOverlayView } from "../app/AppShell.tsx";
import { useActiveActions, useKeyLayer } from "../ui/keymap.ts";
import { useToast } from "../ui/StatusLine.tsx";
import { useUi } from "../ui/context.tsx";
import { actionKeyLabel } from "../app/actions.ts";
import {
  nextSidebarView,
  topOverlay,
  type ShellOverlay,
  type ShellRoute,
  type ShellState,
} from "../app/state.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Conversation } from "./Conversation.tsx";
import { NewThreadForm } from "./NewThreadForm.tsx";
import { NewProjectForm } from "./NewProjectForm.tsx";
import { ActivityClockProvider } from "../ui/ThreadActivityIndicator.tsx";
import { ThreadActionsForm } from "./ThreadManagement.tsx";
import { HelpPanel } from "./HelpPanel.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import { ThemeRoot } from "./ThemeRoot.tsx";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette.tsx";
import { FavoriteModelsPanel } from "./FavoriteModelsPanel.tsx";
import type { FavoriteModel } from "../features/chat/providerChoices.ts";
import { CheckpointRestore } from "./CheckpointRestore.tsx";
import { ThreadDiff } from "./ThreadDiff.tsx";
import { QueuedMessages } from "./QueuedMessages.tsx";
import { PullRequestPanel } from "./PullRequestPanel.tsx";

import { RenameThreadDialog } from "./RenameThreadDialog.tsx";
import {
  ThreadContextMenu,
  ProjectContextMenu,
  type ThreadMenuAction,
} from "./ThreadContextMenu.tsx";
import { createSoundTracker } from "../features/chat/notificationSounds.ts";
import { createNotificationAudio } from "../platform/notificationAudio.ts";

const NO_SESSION_ERROR = Atom.make<string | null>(null);

type PaletteEntry = CommandPaletteItem & {
  readonly target:
    | { readonly type: "action"; readonly run: () => void }
    | { readonly type: "project"; readonly projectId: TuiThreadShell["projectId"] }
    | {
        readonly type: "thread";
        readonly projectId: TuiThreadShell["projectId"];
        readonly threadId: TuiThreadShell["id"];
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

export function AppShell(props: AppShellProps) {
  return (
    <ThemeRoot client={props.client}>
      <AppShellContent {...props} />
    </ThemeRoot>
  );
}

function AppShellContent({
  client,
  initialRoute = "projects",
  onStateChange,
  active = true,
  onTerminalFocusChange,
  searchDebounceMs = 200,
}: AppShellProps) {
  const renderer = useRenderer();
  const { capabilities } = useUi();
  const shell = useAtomValue(client.shell);
  const connection = useAtomValue(client.connection);
  const sessionError = useAtomValue(client.session?.error ?? NO_SESSION_ERROR);
  const registry = useContext(RegistryContext);
  const { width, height } = useTerminalDimensions();
  const layout = calculateShellLayout(width, height);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [paletteSearchQuery, setPaletteSearchQuery] = useState("");
  const threadSearch = useAtomValue(client.threadSearch(paletteSearchQuery));
  const [notice, setNotice] = useToast();
  useSelectionHandler((selection) => {
    const text = selection.getSelectedText();
    if (!text) return;
    const copied = renderer.copyToClipboardOSC52(text);
    setNotice({
      text: copied ? "Copied to clipboard." : "Copy unavailable in this terminal.",
      failed: !copied,
    });
  });
  const snapshot = Option.getOrNull(shell.snapshot);
  const [soundsEnabled, setSoundsEnabled] = useState(client.session?.soundsEnabled ?? true);
  const [favoriteModels, setFavoriteModels] = useState<readonly FavoriteModel[]>(
    () => client.session?.favoriteModels() ?? [],
  );
  const [trackSounds] = useState(createSoundTracker);
  const audio = useRef<ReturnType<typeof createNotificationAudio> | null>(null);
  useEffect(() => {
    audio.current = createNotificationAudio();
    return () => {
      audio.current?.close();
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    const live =
      connection.phase === "connected" && shell.status === "live" && Option.isNone(shell.error);
    const sound = trackSounds(snapshot?.threads ?? [], live);
    if (!soundsEnabled || !live) audio.current?.stop();
    else if (sound) audio.current?.play(sound);
  }, [snapshot, connection.phase, shell.status, shell.error, soundsEnabled, trackSounds]);
  const archived = useAtomValue(client.archivedThreads);
  const rows = useMemo(
    () => ({
      projects: [...(snapshot?.projects ?? [])].sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      ),
      threads: sortSidebarThreads([
        ...(snapshot?.threads ?? []).filter((thread) => thread.archivedAt === null),
        ...archived.threads,
      ]),
    }),
    [snapshot, archived.threads],
  );
  const saveShell = useCallback(
    (state: ShellState) => {
      onStateChange?.(state);
      if (snapshot !== null) client.session?.saveShell(state);
    },
    [client, onStateChange, snapshot],
  );
  const [state, dispatch] = useAppShellState(
    rows,
    snapshot !== null,
    initialRoute,
    saveShell,
    client.session?.shell,
  );
  const overlays = state.overlays;
  const pushOverlay = (overlay: ShellOverlay) => dispatch({ type: "push-overlay", overlay });
  const popOverlay = useCallback(() => dispatch({ type: "pop-overlay" }), [dispatch]);
  const chooseThreadAction = async (threadId: TuiThreadShell["id"], action: ThreadMenuAction) => {
    const thread = rows.threads.find((item) => item.id === threadId);
    popOverlay();
    if (!thread) return;
    if (action === "rename") {
      pushOverlay({ type: "rename", threadId: thread.id });
      return;
    }
    if (action === "delete") {
      pushOverlay({ type: "manage", threadId: thread.id, initialAction: action });
      return;
    }
    const accepted = await (thread.archivedAt
      ? client.threadManagement.unarchive(registry, thread.id)
      : client.threadManagement.archive(registry, thread.id));
    if (!accepted) {
      setNotice({ text: "The environment did not accept that change.", failed: true });
    } else if (state.route === "conversation" && state.threadId === thread.id) {
      dispatch({ type: "back" });
    }
  };
  const selectedThread = rows.threads.find((thread) => thread.id === state.threadId) ?? null;
  useEffect(() => {
    if (state.sidebarView === "archived") client.refreshArchivedThreads(registry);
  }, [state.sidebarView, client, registry]);
  const openPullRequest = () => {
    if (!selectedThread) return;
    const cwd =
      selectedThread.worktreePath ??
      rows.projects.find((project) => project.id === selectedThread.projectId)?.workspaceRoot;
    if (cwd) pushOverlay({ type: "pull-request", cwd, branch: selectedThread.branch });
  };
  const closePalette = useCallback(() => {
    setPaletteSearchQuery("");
    popOverlay();
  }, [popOverlay]);
  const togglePalette = () => {
    setPaletteSearchQuery("");
    if (topOverlay(state)?.type === "palette") popOverlay();
    else pushOverlay({ type: "palette" });
  };
  const toggleSounds = () => {
    const enabled = !soundsEnabled;
    setSoundsEnabled(enabled);
    client.session?.saveSoundsEnabled(enabled);
    if (!enabled) audio.current?.stop();
  };
  const updateFavorites = (
    update: (favorites: readonly FavoriteModel[]) => readonly FavoriteModel[],
  ) => {
    // Start from the saved list so a change cannot undo one made in another TUI.
    const next = update(client.session?.favoriteModels() ?? favoriteModels);
    setFavoriteModels(next);
    client.session?.saveFavoriteModels(next);
  };
  const browsingProjects =
    state.route === "projects" && (state.sidebarView ?? "projects") === "projects";
  const inConversation = state.route === "conversation";
  const atArchivedRow = state.sidebarView === "archived" && !inConversation && selectedThread;
  const { actions: paletteActions } = useActiveActions("palette");
  useKeyLayer("app", {
    bindings: {
      "commandPalette.toggle": togglePalette,
      "help.toggle": () => dispatch({ type: "toggle-help" }),
      "sounds.toggle": {
        label: soundsEnabled ? "Sounds on" : "Sounds off",
        title: soundsEnabled ? "Turn notification sounds off" : "Turn notification sounds on",
        run: toggleSounds,
      },
      "favorites.open": () => pushOverlay({ type: "favorite-models" }),
      "theme.select": () => pushOverlay({ type: "theme" }),
    },
  });
  useKeyLayer("workspace", {
    bindings: {
      "chat.new": {
        enabled: state.projectId !== null,
        run: () => dispatch({ type: "new-thread" }),
      },
      "project.new": () => dispatch({ type: "new-project" }),
      "thread.manage": {
        enabled: selectedThread !== null,
        title: selectedThread ? `Manage ${selectedThread.title}` : "Manage thread",
        run: () => {
          if (selectedThread) pushOverlay({ type: "manage", threadId: selectedThread.id });
        },
      },
      "diff.toggle": {
        enabled: state.threadId !== null,
        run: () => pushOverlay({ type: "diff" }),
      },
      "pullRequest.open": { enabled: selectedThread !== null, run: openPullRequest },
      "checkpoint.restore": {
        enabled: state.threadId !== null,
        run: () => pushOverlay({ type: "restore" }),
      },
      "sidebar.showArchived": () => dispatch({ type: "set-sidebar-view", view: "archived" }),
      "sidebar.toggle": {
        title: `Show ${nextSidebarView(state.sidebarView)} in sidebar`,
        run: () => dispatch({ type: "toggle-sidebar-view" }),
      },
      "sidebar.toggleSubagents": {
        label: state.showSubagents ? "Hide subagents" : "Show subagents",
        title: state.showSubagents ? "Hide subagents in sidebar" : "Show subagents in sidebar",
        run: () => dispatch({ type: "toggle-subagents" }),
      },
      "connection.retry": () => {
        if (state.sidebarView === "archived" && !inConversation)
          client.refreshArchivedThreads(registry);
        else void client.retry(registry);
      },
    },
  });
  const [filtering, setFiltering] = useState(false);
  const moveSelection = (offset: number, wrap = false) => dispatch({ type: "move", offset, wrap });
  useKeyLayer("listFilter", {
    active: filtering && !inConversation,
    typing: true,
    bindings: {
      "listFilter.up": () => moveSelection(-1),
      "listFilter.down": () => moveSelection(1),
      "listFilter.apply": () => setFiltering(false),
      "listFilter.close": () => {
        setFiltering(false);
        dispatch({ type: "set-filter", filter: undefined });
      },
    },
  });
  useKeyLayer("navigation", {
    active: !inConversation,
    context: browsingProjects ? "Projects" : "Threads",
    bindings: {
      "list.up": () => moveSelection(-1),
      "list.down": () => moveSelection(1),
      "list.next": () => moveSelection(1, true),
      "list.previous": () => moveSelection(-1, true),
      "list.open": {
        label: atArchivedRow ? "Manage" : "Open",
        run: () => {
          if (atArchivedRow) pushOverlay({ type: "manage", threadId: atArchivedRow.id });
          else dispatch({ type: "activate" });
        },
      },
      "list.back": {
        enabled:
          Boolean(state.filter) ||
          (!browsingProjects && state.sidebarView !== "recent" && state.sidebarView !== "archived"),
        label: state.filter ? "Clear filter" : "Projects",
        run: () => dispatch({ type: "back" }),
      },
      "list.filter": () => {
        setFiltering(true);
        dispatch({ type: "set-filter", filter: state.filter ?? "" });
      },
      "project.toggleExpanded": {
        enabled: browsingProjects,
        run: () => dispatch({ type: "toggle-project-expanded" }),
      },
      "sidebar.previousView": () =>
        dispatch({ type: "set-sidebar-view", view: nextSidebarView(state.sidebarView, -1) }),
      "sidebar.nextView": () =>
        dispatch({ type: "set-sidebar-view", view: nextSidebarView(state.sidebarView, 1) }),
    },
  });
  const [recentChoices, setRecentChoices] = useState<readonly string[]>([]);
  const paletteEntries = useMemo<readonly PaletteEntry[]>(() => {
    const contentMatchByThreadId = new Map(
      threadSearch.matches.map((match) => [match.threadId, match] as const),
    );
    return [
      ...paletteActions
        .filter((action) => action.definition.palette !== false)
        .map((action): PaletteEntry => {
          const key = actionKeyLabel(action.definition, capabilities.unicode);
          return {
            id: `action:${action.id}`,
            label: action.title,
            detail: "",
            keywords: `command ${action.definition.keywords ?? ""} ${action.id}`,
            kind: "command",
            ...(key ? { shortcut: key } : {}),
            rank:
              recentChoices.indexOf(`action:${action.id}`) >= 0
                ? 1_000 + recentChoices.indexOf(`action:${action.id}`)
                : Math.min(99, action.definition.hint ?? 0) *
                  (action.definition.hint === 100 ? 0 : 1),
            target: { type: "action", run: () => void action.run() },
          };
        }),
      ...rows.projects.map((project): PaletteEntry => ({
        id: `project:${project.id}`,
        label: project.title,
        detail: `Project · ${project.workspaceRoot}`,
        keywords: "workspace repository",
        kind: "entity",
        rank: recentChoices.includes(`project:${project.id}`)
          ? 1_000 + recentChoices.indexOf(`project:${project.id}`)
          : 0,
        target: { type: "project", projectId: project.id },
      })),
      ...rows.threads
        .filter((thread) => !thread.archivedAt)
        .map((thread): PaletteEntry => {
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
            kind: "entity",
            rank: recentChoices.includes(`thread:${thread.id}`)
              ? 1_000 + recentChoices.indexOf(`thread:${thread.id}`)
              : 0,
            target: { type: "thread", projectId: thread.projectId, threadId: thread.id },
          };
        }),
    ];
  }, [
    capabilities.unicode,
    paletteActions,
    paletteSearchQuery,
    recentChoices,
    rows.projects,
    rows.threads,
    threadSearch.matches,
  ]);
  const choosePaletteEntry = (id: string) => {
    const entry = paletteEntries.find((item) => item.id === id);
    if (!entry) return;
    closePalette();
    // Later entries rank higher, so the last choice is first the next time the palette opens.
    setRecentChoices((current) => [...current.filter((item) => item !== id), id].slice(-20));
    switch (entry.target.type) {
      case "action":
        entry.target.run();
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
  const renderOverlay = (overlay: ShellOverlay, isTop: boolean): ShellOverlayView | null => {
    const overlayActive = active && isTop;
    const contentRows = (preferred: number) =>
      Math.max(1, Math.min(preferred, layout.bodyHeight) - 2);
    switch (overlay.type) {
      case "help":
        return {
          title: "Keyboard help",
          size: { width: 88, height: 40 },
          content: (
            <HelpPanel active={overlayActive} height={contentRows(40)} onClose={popOverlay} />
          ),
        };
      case "palette":
        return {
          title: "Search and commands",
          size: { width: 100, height: 28 },
          content: (
            <CommandPalette
              items={paletteEntries}
              height={contentRows(28)}
              active={overlayActive}
              searching={threadSearch.loading}
              searchFailed={threadSearch.failed}
              searchedQuery={paletteSearchQuery}
              searchDebounceMs={searchDebounceMs}
              onSearchQueryChange={setPaletteSearchQuery}
              onChoose={choosePaletteEntry}
              onClose={closePalette}
            />
          ),
        };
      case "favorite-models":
        return {
          title: "Favorite models",
          content: (
            <FavoriteModelsPanel
              client={client}
              favorites={favoriteModels}
              width={Math.max(1, width - 6)}
              height={layout.contentHeight}
              active={overlayActive}
              onChange={updateFavorites}
              onClose={popOverlay}
            />
          ),
        };
      case "theme":
        return {
          title: "Theme",
          size: { width: 62, height: 7 },
          content: <ThemePicker active={overlayActive} onClose={popOverlay} />,
        };
      case "diff":
        return state.threadId
          ? {
              title: "Thread changes",
              content: (
                <ThreadDiff
                  client={client}
                  threadId={state.threadId}
                  active={overlayActive}
                  width={Math.max(1, width - 6)}
                  height={layout.contentHeight}
                  onClose={popOverlay}
                />
              ),
            }
          : null;
      case "restore":
        return state.threadId
          ? {
              title: "Checkpoint restore",
              size: { width: 100, height: 28 },
              content: (
                <CheckpointRestore
                  key={state.threadId}
                  client={client}
                  threadId={state.threadId}
                  active={overlayActive}
                  height={contentRows(28)}
                  onClose={(restored) => {
                    popOverlay();
                    if (restored) setComposerFocusRequest((value) => value + 1);
                  }}
                />
              ),
            }
          : null;
      case "pull-request":
        return {
          title: "Pull request",
          size: { width: 80, height: 10 },
          content: (
            <PullRequestPanel
              client={client}
              cwd={overlay.cwd}
              branch={overlay.branch}
              active={overlayActive}
              onClose={popOverlay}
            />
          ),
        };
      case "new-project":
        return {
          title: "New project",
          size: { width: 96, height: 24 },
          content: (
            <NewProjectForm
              client={client}
              height={contentRows(24)}
              onClose={popOverlay}
              onCreated={(projectId) => dispatch({ type: "open-project", projectId })}
            />
          ),
        };
      case "new-thread":
        return {
          title: "New thread",
          size: { width: 96, height: 20 },
          content: (
            <NewThreadForm
              client={client}
              projectId={state.projectId}
              favoriteModels={favoriteModels}
              height={contentRows(20)}
              onClose={popOverlay}
              onCreated={(projectId, threadId) =>
                dispatch({ type: "open-thread", projectId, threadId })
              }
            />
          ),
        };
      case "manage": {
        const thread = rows.threads.find((item) => item.id === overlay.threadId);
        return thread
          ? {
              title: thread.archivedAt ? "Manage archived thread" : "Manage thread",
              size: { width: 72, height: 12 },
              content: (
                <ThreadActionsForm
                  client={client}
                  initialAction={overlay.initialAction ?? "rename"}
                  thread={thread}
                  active={overlayActive}
                  onClose={popOverlay}
                  onRemoved={() => {
                    popOverlay();
                    if (state.route === "conversation" && state.threadId === thread.id)
                      dispatch({ type: "back" });
                  }}
                />
              ),
            }
          : null;
      }
      case "rename": {
        const thread = rows.threads.find((item) => item.id === overlay.threadId);
        return thread
          ? {
              floating: true,
              content: (
                <RenameThreadDialog
                  key={thread.id}
                  client={client}
                  thread={thread}
                  onClose={popOverlay}
                />
              ),
            }
          : null;
      }
      case "thread-menu": {
        const thread = rows.threads.find((item) => item.id === overlay.threadId);
        return thread
          ? {
              floating: true,
              content: (
                <ThreadContextMenu
                  key={thread.id}
                  x={overlay.x}
                  y={overlay.y}
                  width={width}
                  height={height}
                  archived={thread.archivedAt !== null}
                  onChoose={(action) => void chooseThreadAction(thread.id, action)}
                  onClose={popOverlay}
                />
              ),
            }
          : null;
      }
      case "project-menu":
        return {
          floating: true,
          content: (
            <ProjectContextMenu
              key={overlay.projectId}
              x={overlay.x}
              y={overlay.y}
              width={width}
              height={height}
              onChoose={() => {
                popOverlay();
                dispatch({ type: "new-thread", projectId: overlay.projectId });
              }}
              onClose={popOverlay}
            />
          ),
        };
    }
  };
  const overlayViews = overlays.flatMap((overlay, index) => {
    const isTop = index === overlays.length - 1;
    const view = renderOverlay(overlay, isTop);
    return view ? [{ ...view, key: `${index}:${overlay.type}`, visible: isTop }] : [];
  });
  return (
    <ActivityClockProvider>
      <QueuedMessages client={client} />
      <AppShellView
        onProjectContextMenu={(projectId, position) => {
          if (!active || overlays.length > 0) return;
          renderer.clearSelection();
          pushOverlay({ type: "project-menu", projectId, ...position });
        }}
        onThreadContextMenu={(thread, position) => {
          if (!active || overlays.length > 0) return;
          renderer.clearSelection();
          pushOverlay({ type: "thread-menu", threadId: thread.id, ...position });
        }}
        onToggleSidebarView={() => dispatch({ type: "toggle-sidebar-view" })}
        environmentId={client.environmentId}
        live={
          connection.phase === "connected" && shell.status === "live" && Option.isNone(shell.error)
        }
        state={state}
        label={client.label}
        status={status}
        projects={rows.projects}
        threads={rows.threads.filter(
          (thread) => Boolean(thread.archivedAt) === (state.sidebarView === "archived"),
        )}
        archivedStatus={archived.status}
        loaded={snapshot !== null}
        error={Option.isSome(shell.error) || connection.phase === "blocked"}
        width={width}
        height={height}
        notice={sessionError ? { text: sessionError, failed: true } : notice}
        overlays={overlayViews}
        behindDialog={!active && !capabilities.color}
        filtering={filtering}
        onFilterChange={(filter) => dispatch({ type: "set-filter", filter })}
        onOpenArchived={() => dispatch({ type: "set-sidebar-view", view: "archived" })}
        onOpenPalette={togglePalette}
        {...(selectedThread
          ? {
              onManageThread: () => pushOverlay({ type: "manage", threadId: selectedThread.id }),
            }
          : {})}
        onOpenProject={(projectId) => dispatch({ type: "open-project", projectId })}
        onOpenThread={(projectId, threadId) => {
          const thread = rows.threads.find((item) => item.id === threadId);
          if (thread?.archivedAt) pushOverlay({ type: "manage", threadId });
          else dispatch({ type: "open-thread", projectId, threadId });
        }}
        onNewProject={() => dispatch({ type: "new-project" })}
        onNewThread={() => dispatch({ type: "new-thread" })}
      >
        {state.route === "conversation" && state.threadId !== null ? (
          <Conversation
            key={state.threadId}
            client={client}
            threadId={state.threadId}
            width={layout.contentWidth}
            height={layout.contentHeight}
            active={active && overlays.length === 0}
            onBack={() => dispatch({ type: "back" })}
            onOpenThread={(threadId) => {
              const thread = rows.threads.find((item) => item.id === threadId);
              if (!thread) return false;
              dispatch({ type: "open-thread", projectId: thread.projectId, threadId });
              return true;
            }}
            composerFocusRequest={composerFocusRequest}
            onDiff={() => pushOverlay({ type: "diff" })}
            {...(onTerminalFocusChange ? { onTerminalFocusChange } : {})}
          />
        ) : null}
      </AppShellView>
    </ActivityClockProvider>
  );
}
