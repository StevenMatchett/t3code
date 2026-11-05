import { useRenderer } from "@opentui/react";
import { useMemo, useRef } from "react";
import type { AtomRegistry } from "effect/reactivity";
import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import { planPinnedMove } from "@t3tools/client-runtime/state/thread-sort";
import type { TuiThreadShell } from "../connection/models.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import type { ShellCommand, ShellOverlay, ShellState } from "../app/state.ts";
import {
  markRange,
  threadRowsOf,
  toggleMarked,
  type ShelfRow,
  type ShelfThreadRow,
} from "../app/threadShelves.ts";
import { planThreadUndo, type ThreadLifecycleChange } from "../features/threads/management.ts";
import { useToast, type Toast } from "../ui/StatusLine.tsx";
import type { ThreadMenuAction } from "./ThreadContextMenu.tsx";
import type { ShellThreadRows } from "./AppShell.tsx";

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

/**
 * What the sidebar can do to threads: lifecycle changes with undo, bulk actions on the selection,
 * and the menus that offer them.
 */
export function useThreadTriage({
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
}: {
  readonly client: TuiClient;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly rows: ShellThreadRows;
  readonly state: ShellState;
  readonly dispatch: (command: ShellCommand) => void;
  readonly pushOverlay: (overlay: ShellOverlay) => void;
  readonly popOverlay: () => void;
  readonly threadCapabilities: ExecutionEnvironmentCapabilities;
  readonly shelfRow: ShelfRow | undefined;
  readonly shelfRows: readonly ShelfRow[];
  readonly setNotice: (notice: Toast | null) => void;
}) {
  const renderer = useRenderer();
  const [undoNotice, setUndoNotice] = useToast(5_000);
  const undoRef = useRef<(() => Promise<void>) | null>(null);
  const shelfThreadRows = threadRowsOf(shelfRows);
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
    else if (row.kind === "project-scope") pushOverlay({ type: "project-scope" });
    else dispatch({ type: "show-more-settled" });
  };
  const stepOpenThread = (offset: number) => {
    if (shelfThreadRows.length === 0) return;
    const current = shelfThreadRows.findIndex((row) => row.id === state.threadId);
    if (shelfRow?.kind === "project-scope") {
      openShelfRow(shelfThreadRows[offset > 0 ? 0 : shelfThreadRows.length - 1]!);
      return;
    }
    // Plain arrows scroll a conversation, so this is the arrow key that reaches the way out.
    if (
      offset < 0 &&
      current === 0 &&
      state.projectScope &&
      shelfRows[0]?.kind === "project-scope"
    ) {
      if (state.route === "conversation") dispatch({ type: "back" });
      dispatch({ type: "select-shelf-row", rowId: shelfRows[0].id });
      return;
    }
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
  const undoLast = () => {
    const undo = undoRef.current;
    undoRef.current = null;
    setUndoNotice(null);
    void undo?.();
  };
  return {
    undoNotice,
    undoLast,
    chooseThreadAction,
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
    snoozeThreads,
    deleteMarked,
    openThreadMenu,
    bulkMenuActions,
    chooseBulkMenuAction,
    moveShelfThread,
    canMoveShelfThread,
    toggleRowMark,
    markRowRange,
    activateShelfRow,
    stepOpenThread,
    shelfMenuActions,
    chooseShelfMenuAction,
  };
}
