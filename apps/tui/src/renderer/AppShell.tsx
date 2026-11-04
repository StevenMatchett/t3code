import type { OrchestrationProjectShell } from "@t3tools/contracts";
import type { TuiThreadShell } from "../connection/models.ts";
import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useMemo, useContext, useEffect, useState, useCallback, useRef } from "react";
import { sortSidebarThreads } from "../app/threadOrder.ts";
import { calculateShellLayout } from "../ui/layout.ts";
import { AppShellView, useAppShellState } from "../app/AppShell.tsx";
import { useActiveActions, useKeyLayer } from "../ui/keymap.ts";
import { useToast } from "../ui/StatusLine.tsx";
import { useUi } from "../ui/context.tsx";
import {
  createInitialShellState,
  nextSidebarView,
  shelvesBrowsing,
  sidebarThreads,
  topOverlay,
  type ShellOverlay,
  type ShellRoute,
  type ShellState,
} from "../app/state.ts";
import {
  buildShelfRows,
  createInboxTracker,
  resolveShelfCursor,
  SETTLED_FIRST_PAGE,
  threadRowsOf,
  type ShelfRow,
} from "../app/threadShelves.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Conversation } from "./Conversation.tsx";
import { ActivityClockProvider } from "../ui/ThreadActivityIndicator.tsx";
import { ThemeRoot } from "./ThemeRoot.tsx";
import type { FavoriteModel } from "../features/chat/providerChoices.ts";
import { QueuedMessages } from "./QueuedMessages.tsx";

import { renderShellOverlay } from "./shellOverlays.tsx";
import { usePaletteEntries } from "./usePaletteEntries.ts";
import { useThreadTriage } from "./useThreadTriage.ts";
import { createSoundTracker } from "../features/chat/notificationSounds.ts";
import { createNotificationAudio } from "../platform/notificationAudio.ts";

const NO_SESSION_ERROR = Atom.make<string | null>(null);
/** Ages and snooze wake times are derived from the clock, and none of them need finer than this. */
const SHELF_CLOCK_MS = 30_000;

/** The sidebar's rows, sorted and including archived threads. */
export interface ShellThreadRows {
  readonly projects: readonly OrchestrationProjectShell[];
  readonly threads: readonly TuiThreadShell[];
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
    useMemo(() => {
      const saved = client.session?.shell;
      return client.session?.sidebarLayout() === "shelves"
        ? {
            ...(saved ?? createInitialShellState(initialRoute)),
            sidebarLayout: "shelves" as const,
            sidebarView:
              saved?.sidebarView === "archived" ? ("archived" as const) : ("recent" as const),
          }
        : saved;
    }, [client, initialRoute]),
  );
  const shelvesLayout = state.sidebarLayout === "shelves";
  const shelvesActive = shelvesBrowsing(state);
  const threadCapabilities = useAtomValue(client.threadCapabilities);
  const live =
    connection.phase === "connected" && shell.status === "live" && Option.isNone(shell.error);
  const [shelfNow, setShelfNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!shelvesLayout) return;
    setShelfNow(new Date().toISOString());
    // @effect-diagnostics-next-line globalTimers:off - A view clock tied to this effect's lifetime.
    const timer = setInterval(() => setShelfNow(new Date().toISOString()), SHELF_CLOCK_MS);
    return () => clearInterval(timer);
  }, [shelvesLayout]);
  // Message search hits the server, so it waits for a pause in typing as the palette's does.
  const [shelfSearchQuery, setShelfSearchQuery] = useState("");
  useEffect(() => {
    const query = shelvesActive ? (state.filter ?? "") : "";
    if (query === "") {
      setShelfSearchQuery("");
      return;
    }
    // @effect-diagnostics-next-line globalTimers:off - Debounce tied to this effect's lifetime.
    const timer = setTimeout(() => setShelfSearchQuery(query), searchDebounceMs);
    return () => clearTimeout(timer);
  }, [shelvesActive, state.filter, searchDebounceMs]);
  const shelfSearch = useAtomValue(client.threadSearch(shelfSearchQuery));
  const [inboxVersion, bumpInbox] = useState(0);
  const [inboxTracker] = useState(() =>
    createInboxTracker(() => bumpInbox((version) => version + 1)),
  );
  useEffect(() => () => inboxTracker.dispose(), [inboxTracker]);
  const shelfRows = useMemo<readonly ShelfRow[]>(() => {
    if (!shelvesActive) return [];
    const threads = sidebarThreads(rows.threads, state);
    // While disconnected nothing is known to be working, and nothing may reorder on stale data.
    if (live) inboxTracker.observe(threads, threadCapabilities, Date.now());
    return buildShelfRows({
      threads,
      capabilities: threadCapabilities,
      isWorking: (id) => live && inboxTracker.isWorking(id),
      returnedAt: inboxTracker.returnedAt,
      now: shelfNow,
      live,
      projectScope: state.projectScope ?? null,
      expandedShelves: state.expandedShelves ?? [],
      settledLimit: state.settledLimit ?? SETTLED_FIRST_PAGE,
      openThreadId: state.route === "conversation" ? state.threadId : null,
      filter: state.filter ?? "",
      searchMatches: shelfSearch.matches,
    });
    // Only what the rows read: a new `state` object alone must not rebuild them on every keystroke.
  }, [
    shelvesActive,
    rows.threads,
    state.showSubagents,
    threadCapabilities,
    shelfNow,
    live,
    state.projectScope,
    state.expandedShelves,
    state.settledLimit,
    state.route,
    state.threadId,
    state.filter,
    shelfSearch.matches,
    inboxTracker,
    inboxVersion,
  ]);
  const lastShelfCursor = useRef(0);
  const shelfCursor = shelvesActive
    ? resolveShelfCursor(shelfRows, state, lastShelfCursor.current)
    : -1;
  if (shelfCursor >= 0 && state.route !== "conversation") lastShelfCursor.current = shelfCursor;
  const shelfRow = shelfCursor >= 0 ? shelfRows[shelfCursor] : undefined;
  const shelfThreadRows = threadRowsOf(shelfRows);
  // Everything that acts on "the selected thread" reads state.threadId, so it follows the cursor.
  useEffect(() => {
    if (shelfRow?.kind !== "thread" || state.route === "conversation") return;
    if (shelfRow.id !== state.threadId || shelfRow.id !== state.shelfCursor) {
      dispatch({
        type: "select-shelf-row",
        rowId: shelfRow.id,
        thread: { id: shelfRow.id, projectId: shelfRow.thread.projectId },
      });
    }
  }, [dispatch, shelfRow, state.route, state.threadId, state.shelfCursor]);
  const visitTarget =
    state.route === "conversation" && threadCapabilities.threadVisitedTracking === true
      ? (rows.threads.find((thread) => thread.id === state.threadId) ?? null)
      : null;
  // Having a thread open counts as seeing it, which is what clears Done and Woke on every client.
  useEffect(() => {
    if (!visitTarget || !active) return;
    void client.threadManagement.lifecycle(registry, visitTarget.id, {
      type: "visit",
      at: visitTarget.updatedAt,
    });
  }, [client, registry, active, visitTarget?.id, visitTarget?.latestTurn?.completedAt]);
  const overlays = state.overlays;
  const pushOverlay = (overlay: ShellOverlay) => dispatch({ type: "push-overlay", overlay });
  const popOverlay = useCallback(() => dispatch({ type: "pop-overlay" }), [dispatch]);
  const triage = useThreadTriage({
    client,
    registry,
    rows,
    state,
    dispatch,
    pushOverlay,
    popOverlay,
    threadCapabilities,
    shelfRow,
    shelfRows,
    setNotice,
  });
  const {
    undoNotice,
    undoLast,
    openShelfRow,
    togglePin,
    toggleSettle,
    threadIsSnoozed,
    changeThread,
    changeMarked,
    markedSet,
    markedThreads,
    pinMarked,
    settleMarked,
    openSnooze,
    openThreadMenu,
    moveShelfThread,
    canMoveShelfThread,
    toggleRowMark,
    markRowRange,
    activateShelfRow,
    stepOpenThread,
  } = triage;
  const selectedThread =
    shelvesActive && state.route !== "conversation"
      ? shelfRow?.kind === "thread"
        ? shelfRow.thread
        : null
      : (rows.threads.find((thread) => thread.id === state.threadId) ?? null);
  const toggleSidebarLayout = () => {
    const layout = shelvesLayout ? "tree" : "shelves";
    client.session?.saveSidebarLayout(layout);
    dispatch({ type: "set-sidebar-layout", layout });
  };
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
      "sidebar.layout": {
        title: shelvesLayout ? "Turn inbox sidebar off" : "Turn inbox sidebar on",
        run: toggleSidebarLayout,
      },
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
          if (!selectedThread) return;
          if (shelvesActive) openThreadMenu(selectedThread);
          else pushOverlay({ type: "manage", threadId: selectedThread.id });
        },
      },
      "thread.undo": {
        enabled: undoNotice !== null,
        run: undoLast,
      },
      ...(shelvesActive
        ? {
            "thread.pin": {
              enabled:
                (selectedThread !== null || markedThreads.length > 0) &&
                threadCapabilities.threadPinning === true,
              run: () => {
                if (markedThreads.length > 0) pinMarked();
                else if (selectedThread) void togglePin(selectedThread);
              },
            },
            "thread.settle": {
              enabled:
                (selectedThread !== null || markedThreads.length > 0) &&
                threadCapabilities.threadSettlement === true,
              label:
                markedThreads.length > 0
                  ? markedThreads.every((thread) => thread.settledOverride === "settled")
                    ? `Un-settle ${markedThreads.length}`
                    : `Settle ${markedThreads.length}`
                  : selectedThread?.settledOverride === "settled"
                    ? "Un-settle"
                    : "Settle",
              run: () => {
                if (markedThreads.length > 0) settleMarked();
                else if (selectedThread) toggleSettle(selectedThread);
              },
            },
            "thread.snooze": {
              enabled:
                (selectedThread !== null || markedThreads.length > 0) &&
                threadCapabilities.threadSnooze === true,
              label:
                markedThreads.length > 0
                  ? `${markedThreads.every(threadIsSnoozed) ? "Wake" : "Snooze"} ${markedThreads.length}`
                  : selectedThread && threadIsSnoozed(selectedThread)
                    ? "Wake"
                    : "Snooze",
              run: () => {
                if (markedThreads.length > 0) openSnooze(markedThreads);
                else if (selectedThread) openSnooze([selectedThread]);
              },
            },
            "thread.markUnread": {
              enabled:
                (selectedThread !== null || markedThreads.length > 0) &&
                threadCapabilities.threadVisitedTracking === true,
              run: () => {
                if (markedThreads.length > 0)
                  void changeMarked(markedThreads, { type: "mark-unread" });
                else if (selectedThread)
                  void changeThread(selectedThread.id, { type: "mark-unread" });
              },
            },
            "sidebar.projectScope": {
              enabled: rows.projects.length > 0,
              run: () => pushOverlay({ type: "project-scope" }),
            },
            "thread.previous": {
              enabled: shelfThreadRows.length > 0,
              run: () => stepOpenThread(-1),
            },
            "thread.next": { enabled: shelfThreadRows.length > 0, run: () => stepOpenThread(1) },
            "thread.jump": {
              enabled: shelfThreadRows.length > 0,
              run: (key) => {
                const row = shelfThreadRows[Number(key?.name) - 1];
                if (row) openShelfRow(row);
              },
            },
          }
        : {}),
      "diff.toggle": {
        enabled: selectedThread !== null,
        run: () => pushOverlay({ type: "diff" }),
      },
      "pullRequest.open": { enabled: selectedThread !== null, run: openPullRequest },
      "checkpoint.restore": {
        enabled: selectedThread !== null,
        run: () => pushOverlay({ type: "restore" }),
      },
      "sidebar.showArchived": () => dispatch({ type: "set-sidebar-view", view: "archived" }),
      "sidebar.toggle": {
        ...(shelvesLayout
          ? { label: state.sidebarView === "archived" ? "Threads" : "Archived" }
          : {}),
        title: shelvesLayout
          ? state.sidebarView === "archived"
            ? "Show threads in sidebar"
            : "Show archived in sidebar"
          : `Show ${nextSidebarView(state.sidebarView)} in sidebar`,
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
  const moveSelection = (offset: number, wrap = false) => {
    if (!shelvesActive) {
      dispatch({ type: "move", offset, wrap });
      return;
    }
    if (shelfRows.length === 0) return;
    const next = wrap
      ? (shelfCursor + offset + shelfRows.length) % shelfRows.length
      : Math.max(0, Math.min(shelfRows.length - 1, shelfCursor + offset));
    const row = shelfRows[next]!;
    dispatch({
      type: "select-shelf-row",
      rowId: row.id,
      ...(row.kind === "thread" ? { thread: { id: row.id, projectId: row.thread.projectId } } : {}),
    });
  };
  /** Shift+arrows: selects the row the cursor leaves and the one it lands on. */
  const extendMarks = (offset: number) => {
    const target = shelfRows[Math.max(0, Math.min(shelfRows.length - 1, shelfCursor + offset))];
    if (target?.kind === "thread" && shelfRow?.kind === "thread") {
      markRowRange(target.id, state.markAnchor ?? shelfRow.id);
    }
    moveSelection(offset);
  };
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
  // Keys that act on a row are only offered while there is a row to act on.
  const hasRows =
    !inConversation &&
    (shelvesActive
      ? shelfRows.length > 0
      : browsingProjects
        ? rows.projects.length > 0
        : rows.threads.some(
            (thread) =>
              Boolean(thread.archivedAt) === (state.sidebarView === "archived") &&
              ((state.sidebarView ?? "projects") !== "projects" ||
                thread.projectId === state.projectId),
          ));
  useKeyLayer("navigation", {
    active: !inConversation,
    context: browsingProjects ? "Projects" : "Threads",
    bindings: {
      "list.up": { enabled: hasRows, run: () => moveSelection(-1) },
      "list.down": { enabled: hasRows, run: () => moveSelection(1) },
      "list.next": { enabled: hasRows, run: () => moveSelection(1, true) },
      "list.previous": { enabled: hasRows, run: () => moveSelection(-1, true) },
      "list.open": {
        enabled: hasRows,
        label: atArchivedRow ? "Manage" : "Open",
        run: () => {
          if (shelvesActive) {
            if (shelfRow) activateShelfRow(shelfRow);
          } else if (atArchivedRow) pushOverlay({ type: "manage", threadId: atArchivedRow.id });
          else dispatch({ type: "activate" });
        },
      },
      "list.back": {
        enabled:
          Boolean(state.filter) ||
          markedThreads.length > 0 ||
          (shelvesLayout && state.sidebarView === "archived") ||
          (!browsingProjects && state.sidebarView !== "recent" && state.sidebarView !== "archived"),
        label:
          markedThreads.length > 0
            ? "Clear selection"
            : state.filter
              ? "Clear filter"
              : shelvesLayout
                ? "Threads"
                : "Projects",
        run: () => {
          // Archived is a detour in this layout, so Esc comes back from it instead of being stuck.
          if (shelvesLayout && !state.filter && markedThreads.length === 0)
            dispatch({ type: "toggle-sidebar-view" });
          else dispatch({ type: "back" });
        },
      },
      "list.filter": {
        ...(shelvesActive ? { label: "Search", title: "Search threads and messages" } : {}),
        run: () => {
          setFiltering(true);
          dispatch({ type: "set-filter", filter: state.filter ?? "" });
        },
      },
      "project.toggleExpanded": shelvesActive
        ? {
            enabled: shelfRow !== undefined,
            label: shelfRow?.kind === "thread" ? "Select" : "Expand",
            title: shelfRow?.kind === "thread" ? "Select this thread" : "Open or close this shelf",
            run: () => {
              if (shelfRow?.kind === "thread") toggleRowMark(shelfRow.id);
              else if (shelfRow) activateShelfRow(shelfRow);
            },
          }
        : {
            enabled: browsingProjects && hasRows,
            run: () => dispatch({ type: "toggle-project-expanded" }),
          },
      ...(shelvesActive
        ? {
            "thread.selectUp": { enabled: hasRows, run: () => extendMarks(-1) },
            "thread.selectDown": { enabled: hasRows, run: () => extendMarks(1) },
            "thread.moveUp": { enabled: canMoveShelfThread, run: () => moveShelfThread("up") },
            "thread.moveDown": { enabled: canMoveShelfThread, run: () => moveShelfThread("down") },
          }
        : {}),
      // The GUI has no sidebar tabs, so in its layout the arrows have nothing to switch.
      ...(shelvesLayout
        ? {}
        : {
            "sidebar.previousView": () =>
              dispatch({ type: "set-sidebar-view", view: nextSidebarView(state.sidebarView, -1) }),
            "sidebar.nextView": () =>
              dispatch({ type: "set-sidebar-view", view: nextSidebarView(state.sidebarView, 1) }),
          }),
    },
  });
  const { paletteEntries, choosePaletteEntry } = usePaletteEntries({
    actions: paletteActions,
    rows,
    unicode: capabilities.unicode,
    searchQuery: paletteSearchQuery,
    searchMatches: threadSearch.matches,
    dispatch,
    closePalette,
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
  const overlayViews = overlays.flatMap((overlay, index) => {
    const isTop = index === overlays.length - 1;
    const view = renderShellOverlay(overlay, isTop, {
      client,
      registry,
      state,
      dispatch,
      rows,
      active,
      width,
      height,
      layout,
      shelvesLayout,
      triage,
      palette: {
        entries: paletteEntries,
        searching: threadSearch.loading,
        searchFailed: threadSearch.failed,
        searchedQuery: paletteSearchQuery,
        searchDebounceMs,
        onSearchQueryChange: setPaletteSearchQuery,
        onChoose: choosePaletteEntry,
        onClose: closePalette,
      },
      favoriteModels,
      updateFavorites,
      pushOverlay,
      popOverlay,
      focusComposer: () => setComposerFocusRequest((value) => value + 1),
    });
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
          if (shelvesLayout) openThreadMenu(thread, position.x, position.y);
          else pushOverlay({ type: "thread-menu", threadId: thread.id, ...position });
        }}
        onToggleSidebarView={() => dispatch({ type: "toggle-sidebar-view" })}
        environmentId={client.environmentId}
        live={live}
        shelves={
          shelvesActive
            ? {
                rows: shelfRows,
                cursor: shelfCursor,
                marked: markedSet,
                scopeTitle:
                  rows.projects.find((project) => project.id === state.projectScope)?.title ?? null,
                onActivate: activateShelfRow,
                onSearch: () => {
                  setFiltering(true);
                  dispatch({ type: "set-filter", filter: state.filter ?? "" });
                },
                onChooseScope: () => pushOverlay({ type: "project-scope" }),
              }
            : null
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
        notice={sessionError ? { text: sessionError, failed: true } : (undoNotice ?? notice)}
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
