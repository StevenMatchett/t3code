import type { TuiThreadShell } from "../connection/models.ts";
import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useMemo, useContext, useEffect, useState, useCallback, useRef } from "react";
import { resolveSnoozePresets, canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import { planPinnedMove } from "@t3tools/client-runtime/state/thread-sort";
import { sortSidebarThreads } from "../app/threadOrder.ts";
import { calculateShellLayout } from "../ui/layout.ts";
import { AppShellView, useAppShellState, type ShellOverlayView } from "../app/AppShell.tsx";
import { useActiveActions, useKeyLayer } from "../ui/keymap.ts";
import { useToast } from "../ui/StatusLine.tsx";
import { useUi } from "../ui/context.tsx";
import { actionKeyLabel } from "../app/actions.ts";
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
  markRange,
  resolveShelfCursor,
  SETTLED_FIRST_PAGE,
  threadRowsOf,
  toggleMarked,
  type ShelfRow,
  type ShelfThreadRow,
} from "../app/threadShelves.ts";
import { planThreadUndo, type ThreadLifecycleChange } from "../features/threads/management.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Conversation } from "./Conversation.tsx";
import { NewThreadForm } from "./NewThreadForm.tsx";
import { NewProjectForm } from "./NewProjectForm.tsx";
import { ActivityClockProvider } from "../ui/ThreadActivityIndicator.tsx";
import { SnoozeCustomDialog } from "./SnoozeCustomDialog.tsx";
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
  NavigationContextMenu,
  ThreadContextMenu,
  ProjectContextMenu,
  type ThreadMenuAction,
} from "./ThreadContextMenu.tsx";
import { createSoundTracker } from "../features/chat/notificationSounds.ts";
import { createNotificationAudio } from "../platform/notificationAudio.ts";

const NO_SESSION_ERROR = Atom.make<string | null>(null);
/** Ages and snooze wake times are derived from the clock, and none of them need finer than this. */
const SHELF_CLOCK_MS = 30_000;
const ACCEPTED_NOTHING = "The environment did not accept that change.";

type ShelfMenuAction =
  | "new-thread"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "snooze"
  | "wake"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "toggle-scope"
  | "toggle-auto-settle"
  | "copy-path"
  | "copy-branch"
  | "copy-id"
  | "archive"
  | "restore"
  | "delete";

type BulkMenuAction = "unpin" | "settle" | "snooze" | "regenerate-title" | "mark-unread" | "delete";

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
  const [undoNotice, setUndoNotice] = useToast(5_000);
  const undoRef = useRef<(() => Promise<void>) | null>(null);
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
  const offerUndo = (text: string, undo: () => Promise<void>) => {
    undoRef.current = undo;
    setUndoNotice({ text: `${text} Ctrl+Z undoes.`, failed: false });
  };
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
      setNotice({ text: ACCEPTED_NOTHING, failed: true });
      return;
    }
    if (!thread.archivedAt)
      offerUndo(`Archived ${thread.title}.`, async () => {
        await client.threadManagement.unarchive(registry, thread.id);
      });
    if (state.route === "conversation" && state.threadId === thread.id) dispatch({ type: "back" });
  };
  const selectedThread =
    shelvesActive && state.route !== "conversation"
      ? shelfRow?.kind === "thread"
        ? shelfRow.thread
        : null
      : (rows.threads.find((thread) => thread.id === state.threadId) ?? null);
  const openShelfRow = (row: ShelfThreadRow) =>
    dispatch({ type: "open-thread", projectId: row.thread.projectId, threadId: row.id });
  const changeThread = async (threadId: TuiThreadShell["id"], change: ThreadLifecycleChange) => {
    const accepted = await client.threadManagement.lifecycle(registry, threadId, change);
    if (!accepted) setNotice({ text: ACCEPTED_NOTHING, failed: true });
    return accepted;
  };
  const undoLifecycle = (
    threads: readonly TuiThreadShell[],
    action: "settle" | "snooze" | "unpin",
    text: string,
  ) => {
    // Captured now: by the time Undo runs, the threads' pins and snoozes are already gone.
    const plans = threads.map((thread) => ({
      id: thread.id,
      plan: planThreadUndo(action, thread),
    }));
    offerUndo(text, async () => {
      await Promise.all(
        plans.map(async ({ id, plan }) => {
          for (const step of plan) {
            // A snooze can expire before Undo runs, and the server rejects an expired restore.
            if (step.type === "snooze" && Date.parse(step.until) <= Date.now()) continue;
            if (!(await changeThread(id, step))) return;
          }
        }),
      );
    });
  };
  /** Settling or snoozing the open thread moves on to the next card, as the GUI does. */
  const parkThread = async (thread: TuiThreadShell, change: ThreadLifecycleChange) => {
    const cards = shelfThreadRows.filter((row) => row.variant === "card");
    const next = cards[cards.findIndex((row) => row.id === thread.id) + 1] ?? cards[0];
    const wasOpen = state.route === "conversation" && state.threadId === thread.id;
    if (!(await changeThread(thread.id, change))) return;
    undoLifecycle(
      [thread],
      change.type === "snooze" ? "snooze" : "settle",
      `${change.type === "snooze" ? "Snoozed" : "Settled"} ${thread.title}.`,
    );
    if (!wasOpen) return;
    if (next && next.id !== thread.id) openShelfRow(next);
    else dispatch({ type: "back" });
  };
  const clearMarks = () => dispatch({ type: "mark-threads", threadIds: [] });
  /** Applies one change to the whole selection, reporting anything the server turned down. */
  const changeMarked = async (
    threads: readonly TuiThreadShell[],
    change: ThreadLifecycleChange,
    undo?: { readonly action: "settle" | "snooze" | "unpin"; readonly verb: string },
  ) => {
    clearMarks();
    const results = await Promise.all(
      threads.map((thread) => client.threadManagement.lifecycle(registry, thread.id, change)),
    );
    const accepted = threads.filter((_, index) => results[index]);
    if (accepted.length < threads.length) {
      setNotice({
        text: `The environment did not accept ${threads.length - accepted.length} of ${threads.length} changes.`,
        failed: true,
      });
    }
    if (undo && accepted.length > 0) {
      undoLifecycle(accepted, undo.action, `${undo.verb} ${accepted.length} threads.`);
    }
  };
  const togglePin = async (thread: TuiThreadShell) => {
    const unpinning = thread.pinnedAt != null;
    const accepted = await changeThread(thread.id, { type: unpinning ? "unpin" : "pin" });
    if (accepted && unpinning) undoLifecycle([thread], "unpin", `Unpinned ${thread.title}.`);
  };
  const toggleSettle = (thread: TuiThreadShell) => {
    if (thread.settledOverride === "settled") void changeThread(thread.id, { type: "unsettle" });
    else void parkThread(thread, { type: "settle" });
  };
  const threadIsSnoozed = (thread: TuiThreadShell) =>
    shelfThreadRows.some((row) => row.id === thread.id && row.shelf === "snoozed");
  const markedSet = useMemo(() => new Set(state.markedThreads ?? []), [state.markedThreads]);
  // Rows can vanish while selected, so the selection is always read through the live list.
  const markedThreads = useMemo(
    () => (markedSet.size === 0 ? [] : rows.threads.filter((thread) => markedSet.has(thread.id))),
    [markedSet, rows.threads],
  );
  const pinMarked = () => {
    const pinned = markedThreads.filter((thread) => thread.pinnedAt != null);
    if (pinned.length > 0)
      void changeMarked(pinned, { type: "unpin" }, { action: "unpin", verb: "Unpinned" });
    else void changeMarked(markedThreads, { type: "pin" });
  };
  const settleMarked = () => {
    const unsettled = markedThreads.filter((thread) => thread.settledOverride !== "settled");
    if (unsettled.length > 0)
      void changeMarked(unsettled, { type: "settle" }, { action: "settle", verb: "Settled" });
    else void changeMarked(markedThreads, { type: "unsettle" });
  };
  const openSnooze = (threads: readonly TuiThreadShell[], x = 2, y = 3) => {
    if (threads.every(threadIsSnoozed)) {
      if (threads.length === 1) void changeThread(threads[0]!.id, { type: "wake" });
      else void changeMarked(threads, { type: "wake" });
      return;
    }
    const now = new Date().toISOString();
    if (threads.every((thread) => canSnooze(thread, { now }))) {
      pushOverlay({ type: "snooze-menu", threadIds: threads.map((thread) => thread.id), x, y });
    } else {
      setNotice({
        text: `${threads.length > 1 ? "A selected thread is" : "This thread is"} waiting on you, so it cannot be snoozed.`,
        failed: true,
      });
    }
  };
  const snoozeThreads = (threads: readonly TuiThreadShell[], until: string) => {
    if (threads.length === 1) void parkThread(threads[0]!, { type: "snooze", until });
    else
      void changeMarked(threads, { type: "snooze", until }, { action: "snooze", verb: "Snoozed" });
  };
  const deleteMarked = async () => {
    const threads = markedThreads;
    clearMarks();
    const results = await Promise.all(
      threads.map((thread) => client.threadManagement.delete(registry, thread.id)),
    );
    const refused = results.filter((accepted) => !accepted).length;
    if (refused > 0) {
      setNotice({
        text: `The environment did not accept ${refused} of ${threads.length} deletions.`,
        failed: true,
      });
    }
  };
  const openThreadMenu = (thread: TuiThreadShell, x = 2, y = 3) => {
    if (markedSet.has(thread.id)) pushOverlay({ type: "bulk-menu", x, y });
    else pushOverlay({ type: "thread-menu", threadId: thread.id, x, y });
  };
  const bulkMenuActions = () => {
    const count = markedThreads.length;
    const pinned = markedThreads.filter((thread) => thread.pinnedAt != null).length;
    const now = new Date().toISOString();
    const entries: ReadonlyArray<{
      readonly action: BulkMenuAction;
      readonly label: string;
      readonly when?: boolean;
      readonly disabled?: boolean;
    }> = [
      { action: "unpin", label: `Unpin (${pinned})`, when: pinned > 0 },
      {
        action: "settle",
        label: `Settle (${count})`,
        when: threadCapabilities.threadSettlement === true,
        disabled: markedThreads.every((thread) => thread.settledOverride === "settled"),
      },
      {
        action: "snooze",
        label: `Snooze (${count})...`,
        when:
          threadCapabilities.threadSnooze === true &&
          markedThreads.every((thread) => canSnooze(thread, { now })),
      },
      {
        action: "regenerate-title",
        label: `Regenerate titles (${count})`,
        when: threadCapabilities.threadTitleRegeneration === true,
      },
      {
        action: "mark-unread",
        label: `Mark unread (${count})`,
        when: threadCapabilities.threadVisitedTracking === true,
      },
      { action: "delete", label: `Delete (${count})...` },
    ];
    return entries.filter((entry) => entry.when !== false);
  };
  const chooseBulkMenuAction = (action: BulkMenuAction, x: number, y: number) => {
    popOverlay();
    switch (action) {
      case "unpin":
        pinMarked();
        break;
      case "settle":
        settleMarked();
        break;
      case "snooze":
        openSnooze(markedThreads, x, y);
        break;
      case "regenerate-title":
        void changeMarked(markedThreads, { type: "regenerate-title" });
        break;
      case "mark-unread":
        void changeMarked(markedThreads, { type: "mark-unread" });
        break;
      case "delete":
        pushOverlay({ type: "bulk-delete", x, y });
        break;
    }
  };
  const copyToClipboard = (text: string) => {
    const copied = renderer.copyToClipboardOSC52(text);
    setNotice({
      text: copied ? "Copied to clipboard." : "Copy unavailable in this terminal.",
      failed: !copied,
    });
  };
  const moveShelfThread = (direction: "up" | "down") => {
    if (shelfRow?.kind !== "thread") return;
    const { shelf } = shelfRow;
    if (shelf !== "pinned") return;
    const siblings = shelfThreadRows.filter((row) => row.shelf === shelf);
    const writes = planPinnedMove({
      orderedIds: siblings.map((row) => row.id),
      keysById: new Map(siblings.map((row) => [row.id as string, row.thread.pinOrderKey])),
      movedId: shelfRow.id,
      direction,
    });
    for (const write of writes ?? []) {
      void changeThread(write.id as TuiThreadShell["id"], {
        type: "reorder",
        shelf,
        orderKey: write.orderKey,
      });
    }
  };
  const canMoveShelfThread =
    shelfRow?.kind === "thread" &&
    !state.filter &&
    // The inbox orders itself by what came back to you, so only pins can be arranged.
    shelfRow.shelf === "pinned" &&
    threadCapabilities.threadPinReorder === true;
  const toggleRowMark = (id: TuiThreadShell["id"]) =>
    dispatch({
      type: "mark-threads",
      threadIds: toggleMarked(state.markedThreads ?? [], id),
      anchor: id,
    });
  const markRowRange = (target: TuiThreadShell["id"], anchor?: TuiThreadShell["id"] | null) =>
    dispatch({
      type: "mark-threads",
      threadIds: markRange(
        state.markedThreads ?? [],
        shelfRows,
        anchor ?? state.markAnchor ?? null,
        target,
      ),
      anchor: anchor ?? state.markAnchor ?? target,
    });
  const activateShelfRow = (
    row: ShelfRow,
    modifiers?: { readonly shift: boolean; readonly ctrl: boolean },
  ) => {
    if (row.kind === "thread" && modifiers?.ctrl) toggleRowMark(row.id);
    else if (row.kind === "thread" && modifiers?.shift) markRowRange(row.id);
    else if (row.kind === "thread") openShelfRow(row);
    else if (row.kind === "shelf") dispatch({ type: "toggle-shelf", shelf: row.shelf });
    else dispatch({ type: "show-more-settled" });
  };
  const stepOpenThread = (offset: number) => {
    if (shelfThreadRows.length === 0) return;
    const current = shelfThreadRows.findIndex((row) => row.id === state.threadId);
    const next = (current + offset + shelfThreadRows.length) % shelfThreadRows.length;
    openShelfRow(shelfThreadRows[next]!);
  };
  const shelfMenuActions = (thread: TuiThreadShell) => {
    const settled = thread.settledOverride === "settled";
    const entries: ReadonlyArray<{
      readonly action: ShelfMenuAction;
      readonly label: string;
      readonly disabled?: boolean;
      readonly when?: boolean;
    }> = [
      { action: "new-thread", label: "New thread" },
      {
        action: thread.pinnedAt != null ? "unpin" : "pin",
        label: thread.pinnedAt != null ? "Unpin thread" : "Pin thread",
        when: threadCapabilities.threadPinning === true,
      },
      {
        action: settled ? "unsettle" : "settle",
        label: settled ? "Un-settle thread" : "Settle thread",
        when: threadCapabilities.threadSettlement === true,
      },
      {
        action: threadIsSnoozed(thread) ? "wake" : "snooze",
        label: threadIsSnoozed(thread) ? "Wake thread" : "Snooze...",
        when: threadCapabilities.threadSnooze === true,
      },
      { action: "rename", label: "Rename thread" },
      {
        action: "regenerate-title",
        label: thread.titleRegeneration ? "Regenerating..." : "Regenerate title",
        disabled: Boolean(thread.titleRegeneration),
        when: threadCapabilities.threadTitleRegeneration === true,
      },
      {
        action: "mark-unread",
        label: "Mark unread",
        when: threadCapabilities.threadVisitedTracking === true,
      },
      {
        action: "toggle-scope",
        label: state.projectScope
          ? "Show all projects"
          : `Filter by ${rows.projects.find((item) => item.id === thread.projectId)?.title ?? "project"}`,
      },
      {
        action: "toggle-auto-settle",
        label: thread.autoSettleDisabledAt ? "Auto-settle: off" : "Auto-settle: on",
        when: threadCapabilities.threadAutoSettleOptOut === true,
      },
      { action: "copy-path", label: "Copy path" },
      { action: "copy-branch", label: "Copy branch", when: thread.branch !== null },
      { action: "copy-id", label: "Copy thread ID" },
      thread.archivedAt
        ? { action: "restore", label: "Restore thread" }
        : {
            action: "archive",
            label: "Archive thread",
            disabled: thread.latestTurn?.state === "running",
          },
      { action: "delete", label: "Delete" },
    ];
    return entries.filter((entry) => entry.when !== false);
  };
  const chooseShelfMenuAction = (
    thread: TuiThreadShell,
    action: ShelfMenuAction,
    x: number,
    y: number,
  ) => {
    popOverlay();
    switch (action) {
      case "new-thread":
        dispatch({ type: "new-thread", projectId: thread.projectId });
        break;
      case "pin":
      case "unpin":
        void togglePin(thread);
        break;
      case "settle":
      case "unsettle":
        toggleSettle(thread);
        break;
      case "snooze":
      case "wake":
        openSnooze([thread], x, y);
        break;
      case "rename":
        pushOverlay({ type: "rename", threadId: thread.id });
        break;
      case "regenerate-title":
        void changeThread(thread.id, { type: "regenerate-title" });
        break;
      case "mark-unread":
        void changeThread(thread.id, { type: "mark-unread" });
        break;
      case "toggle-scope":
        dispatch({
          type: "set-project-scope",
          projectId: state.projectScope ? null : thread.projectId,
        });
        break;
      case "toggle-auto-settle":
        void changeThread(thread.id, {
          type: "auto-settle",
          enabled: Boolean(thread.autoSettleDisabledAt),
        });
        break;
      case "copy-path":
        copyToClipboard(
          thread.worktreePath ??
            rows.projects.find((item) => item.id === thread.projectId)?.workspaceRoot ??
            "",
        );
        break;
      case "copy-branch":
        copyToClipboard(thread.branch ?? "");
        break;
      case "copy-id":
        copyToClipboard(thread.id);
        break;
      case "archive":
      case "restore":
        void chooseThreadAction(thread.id, "archive");
        break;
      case "delete":
        pushOverlay({ type: "manage", threadId: thread.id, initialAction: "delete" });
        break;
    }
  };
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
        run: () => {
          const undo = undoRef.current;
          undoRef.current = null;
          setUndoNotice(null);
          void undo?.();
        },
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
      case "project-scope":
        return {
          title: "Filter by project",
          size: { width: 72, height: 18 },
          content: (
            <CommandPalette
              items={[
                {
                  id: "all",
                  label: "All projects",
                  detail: state.projectScope ? "" : "Current",
                  rank: 2_000,
                },
                ...rows.projects.map((project) => ({
                  id: project.id,
                  label: project.title,
                  detail: `${project.id === state.projectScope ? "Current · " : ""}${project.workspaceRoot}`,
                  rank: project.id === state.projectScope ? 1_000 : 0,
                })),
              ]}
              height={contentRows(18)}
              active={overlayActive}
              searching={false}
              searchFailed={false}
              searchedQuery=""
              searchDebounceMs={0}
              onSearchQueryChange={() => undefined}
              onChoose={(id) => {
                popOverlay();
                dispatch({
                  type: "set-project-scope",
                  projectId: rows.projects.find((project) => project.id === id)?.id ?? null,
                });
              }}
              onClose={popOverlay}
            />
          ),
        };
      case "snooze-menu": {
        const threads = rows.threads.filter((item) => overlay.threadIds.includes(item.id));
        const presets = resolveSnoozePresets(new Date());
        return threads.length > 0
          ? {
              floating: true,
              content: (
                <NavigationContextMenu
                  id="snooze"
                  x={overlay.x}
                  y={overlay.y}
                  width={width}
                  height={height}
                  actions={[
                    ...presets.map((preset) => ({
                      action: preset.id as string,
                      label: `${preset.label} (${preset.whenLabel})`,
                    })),
                    { action: "custom", label: "Custom..." },
                  ]}
                  onChoose={(id) => {
                    popOverlay();
                    if (id === "custom") {
                      pushOverlay({ type: "snooze-custom", threadIds: overlay.threadIds });
                      return;
                    }
                    const preset = presets.find((candidate) => candidate.id === id);
                    if (preset) snoozeThreads(threads, preset.snoozedUntil);
                  }}
                  onClose={popOverlay}
                />
              ),
            }
          : null;
      }
      case "snooze-custom": {
        const threads = rows.threads.filter((item) => overlay.threadIds.includes(item.id));
        return threads.length > 0
          ? {
              floating: true,
              content: (
                <SnoozeCustomDialog
                  count={threads.length}
                  onSnooze={(until) => {
                    popOverlay();
                    snoozeThreads(threads, until);
                  }}
                  onClose={popOverlay}
                />
              ),
            }
          : null;
      }
      case "bulk-menu":
        return markedThreads.length > 0
          ? {
              floating: true,
              content: (
                <NavigationContextMenu
                  id="bulk-thread"
                  x={overlay.x}
                  y={overlay.y}
                  width={width}
                  height={height}
                  actions={bulkMenuActions()}
                  onChoose={(action) => chooseBulkMenuAction(action, overlay.x, overlay.y)}
                  onClose={popOverlay}
                />
              ),
            }
          : null;
      case "bulk-delete":
        return {
          floating: true,
          content: (
            <NavigationContextMenu
              id="bulk-delete"
              x={overlay.x}
              y={overlay.y}
              width={width}
              height={height}
              // Cancel comes first, so Enter on a menu that just opened can never delete.
              actions={[
                { action: "cancel", label: "Cancel" },
                {
                  action: "delete",
                  label: `Delete ${markedThreads.length} ${markedThreads.length === 1 ? "thread" : "threads"}`,
                },
              ]}
              onChoose={(action) => {
                popOverlay();
                if (action === "delete") void deleteMarked();
              }}
              onClose={popOverlay}
            />
          ),
        };
      case "thread-menu": {
        const thread = rows.threads.find((item) => item.id === overlay.threadId);
        if (thread && shelvesLayout)
          return {
            floating: true,
            content: (
              <NavigationContextMenu
                key={thread.id}
                id="thread-context"
                x={overlay.x}
                y={overlay.y}
                width={width}
                height={height}
                actions={shelfMenuActions(thread)}
                onChoose={(action) => chooseShelfMenuAction(thread, action, overlay.x, overlay.y)}
                onClose={popOverlay}
              />
            ),
          };
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
