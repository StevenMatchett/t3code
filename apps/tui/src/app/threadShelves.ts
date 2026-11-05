// @effect-diagnostics globalTimers:off - Shelf placement is React view state, outside an Effect runtime.
import type { TuiThreadShell } from "../connection/models.ts";
import { RunId, type ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import {
  effectiveSnoozed,
  resolveCustomSnooze,
  snoozeWakeLabel,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  resolveSettledThreadTimestamp,
  sortPinnedThreadsByOrderKey,
} from "@t3tools/client-runtime/state/thread-sort";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { threadPullRequestSearchTerms } from "@t3tools/shared/threadPullRequests";

/**
 * The GUI sidebar's shelves, top to bottom. It reads as an inbox: "active" holds what is back in
 * your hands, newest return first, while busy threads wait out of the way until they need you.
 */
export type ThreadShelf = "pinned" | "active" | "working" | "snoozed" | "settled";
export type CollapsibleShelf = Extract<ThreadShelf, "working" | "snoozed" | "settled">;

export const SETTLED_FIRST_PAGE = 10;
export const SETTLED_NEXT_PAGE = 25;
/** An orchestrator run can end moments before it continues, or before the server settles it. */
export const WORKING_EXIT_GRACE_MS = 2_000;

export type ShelfStatus =
  | "approval"
  | "input"
  | "working"
  | "waiting"
  | "limited"
  | "failed"
  | "woke"
  | "done"
  | "none";

export type ShelfThreadRow = {
  readonly kind: "thread";
  readonly id: TuiThreadShell["id"];
  readonly thread: TuiThreadShell;
  readonly shelf: ThreadShelf;
  readonly status: ShelfStatus;
  readonly unread: boolean;
  /** Short age or countdown shown when no status claims the slot. */
  readonly time: string;
  /** A search result's message excerpt, or null outside search. */
  readonly excerpt: string | null;
  readonly variant: "card" | "slim" | "search";
};

export type ShelfRow =
  | ShelfThreadRow
  | {
      readonly kind: "shelf";
      readonly id: string;
      readonly shelf: CollapsibleShelf;
      readonly count: number;
      readonly expanded: boolean;
    }
  | { readonly kind: "more"; readonly id: string; readonly count: number }
  /** The project dropdown above the list, which arrow keys reach as the row before the first. */
  | { readonly kind: "project-scope"; readonly id: "project-scope" };

export const shelfRowHeight = (row: ShelfRow) =>
  row.kind !== "thread" ? 1 : row.variant === "card" ? 4 : row.variant === "search" ? 2 : 1;

const MINUTE_MS = 60_000;

/** "now", "5m", "3h", "2d": the GUI's compact age. Clock skew reads as now, never negative. */
export function compactAge(iso: string | null, now: string) {
  if (iso === null) return "";
  const elapsed = Date.parse(now) - Date.parse(iso);
  if (Number.isNaN(elapsed)) return "";
  const minutes = Math.floor(elapsed / MINUTE_MS);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

const ACTIVE_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

const snoozeShell = (thread: TuiThreadShell) => ({
  ...thread,
  snoozedUntil: thread.snoozedUntil ?? null,
  snoozedAt: thread.snoozedAt ?? null,
});

function hasUnseenCompletion(thread: TuiThreadShell) {
  const completedAt = thread.latestTurn?.completedAt;
  // Never visited counts as read, so a fresh install does not light up every old thread.
  if (!completedAt || !thread.lastVisitedAt) return false;
  return Date.parse(completedAt) > Date.parse(thread.lastVisitedAt);
}

function isWoke(thread: TuiThreadShell, now: string) {
  if (thread.settledOverride === "settled") return false;
  const wokeAt = threadWokeAt(snoozeShell(thread), { now });
  if (wokeAt === null) return false;
  return !thread.lastVisitedAt || Date.parse(wokeAt) > Date.parse(thread.lastVisitedAt);
}

/** The one status a row shows, by the GUI's precedence. Without a live stream it claims nothing. */
export function resolveShelfStatus(
  thread: TuiThreadShell,
  now: string,
  live: boolean,
): ShelfStatus {
  if (!live) return "none";
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  const runStatus = thread.activityRunStatus ?? thread.status;
  const failed = runStatus === "failed" || thread.latestTurn?.state === "error";
  if (!failed && backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])) {
    return "waiting";
  }
  if (
    (runStatus !== undefined && ACTIVE_RUN_STATUSES.has(runStatus)) ||
    thread.session?.status === "starting" ||
    thread.latestTurn?.state === "running"
  ) {
    return "working";
  }
  if (failed) return thread.lastErrorClass === "usage_limit" ? "limited" : "failed";
  if (isWoke(thread, now)) return "woke";
  return hasUnseenCompletion(thread) ? "done" : "none";
}

/** Background work and rows already seen recede, so what needs attention stands out. */
export function shelfRowRecedes(row: ShelfThreadRow) {
  if (row.status === "working" || row.status === "waiting") return true;
  return (row.status === "none" || row.status === "approval") && !row.unread;
}

type ThreadKey = string;

function isBusy(thread: TuiThreadShell, now: string) {
  const status = resolveShelfStatus(thread, now, true);
  if (status !== "working" && status !== "waiting") return false;
  // A plan waiting on the user outranks lingering background work.
  return !(
    thread.interactionMode === "plan" &&
    thread.hasActionableProposedPlan &&
    thread.latestTurn?.state !== "running"
  );
}

/**
 * Remembers which threads are on the Working shelf and when each came back. A thread holds its
 * place through the grace period, so it does not flash in the inbox just before settling or
 * continuing. Its timer only exists during that grace, so an idle sidebar never wakes for it.
 */
export function createInboxTracker(onChange: () => void) {
  const states = new Map<ThreadKey, { working: boolean; deadline: number | null }>();
  const returns = new Map<ThreadKey, number>();
  let timer: NodeJS.Timeout | undefined;
  const schedule = (at: number) => {
    clearTimeout(timer);
    timer = undefined;
    let next = Infinity;
    for (const state of states.values()) {
      if (state.deadline !== null) next = Math.min(next, state.deadline);
    }
    if (next !== Infinity) timer = setTimeout(onChange, Math.max(0, next - at));
  };
  return {
    observe(
      threads: readonly TuiThreadShell[],
      capabilities: ExecutionEnvironmentCapabilities,
      at: number,
    ) {
      const now = new Date(at).toISOString();
      const present = new Set<ThreadKey>();
      for (const thread of threads) {
        present.add(thread.id);
        const previous = states.get(thread.id);
        const busy = isBusy(thread, now);
        // Only placement is held: anything that needs the user comes back at once.
        const parked =
          thread.pinnedAt != null || resolveShelf(thread, now, capabilities) !== "active";
        const needsUser =
          thread.hasPendingApprovals ||
          thread.hasPendingUserInput ||
          thread.latestTurn?.state === "error" ||
          (thread.interactionMode === "plan" && thread.hasActionableProposedPlan);
        const deadline =
          !busy && previous?.working && !parked && !needsUser
            ? (previous.deadline ?? at + WORKING_EXIT_GRACE_MS)
            : null;
        const working = busy || (deadline !== null && deadline > at);
        if (previous?.working && !working) returns.set(thread.id, at);
        states.set(thread.id, { working, deadline: working ? deadline : null });
      }
      for (const id of states.keys()) {
        if (!present.has(id)) {
          states.delete(id);
          returns.delete(id);
        }
      }
      schedule(at);
    },
    isWorking: (id: string) => states.get(id)?.working ?? false,
    returnedAt: (id: string) => returns.get(id),
    dispose: () => clearTimeout(timer),
  };
}

const stamp = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

function newestFirst(
  threads: readonly TuiThreadShell[],
  timeOf: (thread: TuiThreadShell) => number,
) {
  return threads
    .map((thread) => ({ thread, at: timeOf(thread) }))
    .sort((left, right) => right.at - left.at || left.thread.id.localeCompare(right.thread.id))
    .map(({ thread }) => thread);
}

function settledTimestamp(thread: TuiThreadShell) {
  const turn = thread.latestTurn;
  return resolveSettledThreadTimestamp({
    settledAt: thread.settledAt,
    latestUserMessageAt: thread.latestUserMessageAt,
    updatedAt: thread.updatedAt,
    latestRun: turn && {
      runId: RunId.make(turn.turnId),
      status: "completed",
      requestedAt: turn.requestedAt,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      assistantMessageId: null,
    },
  });
}

function resolveShelf(
  thread: TuiThreadShell,
  now: string,
  capabilities: ExecutionEnvironmentCapabilities,
): ThreadShelf {
  // Without server support a thread could never leave these shelves, so it never lands on them.
  if (capabilities.threadSnooze === true && effectiveSnoozed(snoozeShell(thread), { now }))
    return "snoozed";
  if (capabilities.threadSettlement === true && thread.settledOverride === "settled") {
    return "settled";
  }
  return thread.pinnedAt != null ? "pinned" : "active";
}

function matchesSearch(thread: TuiThreadShell, query: string) {
  return [thread.title, ...threadPullRequestSearchTerms(thread)].some((term) =>
    term.toLocaleLowerCase().includes(query),
  );
}

export interface ShelfSearchMatch {
  readonly threadId: TuiThreadShell["id"];
  readonly snippet: string;
}

export interface BuildShelfRowsInput {
  /** Live threads this sidebar may list: not archived, and subagents only when they are shown. */
  readonly threads: readonly TuiThreadShell[];
  readonly capabilities: ExecutionEnvironmentCapabilities;
  readonly isWorking: (id: string) => boolean;
  readonly returnedAt: (id: string) => number | undefined;
  readonly now: string;
  readonly live: boolean;
  readonly projectScope: TuiThreadShell["projectId"] | null;
  /** The project dropdown is on screen, so the cursor can stop on it. */
  readonly scopeReachable: boolean;
  readonly expandedShelves: readonly CollapsibleShelf[];
  readonly settledLimit: number;
  /** The open thread stays on screen even when its shelf is collapsed. */
  readonly openThreadId: TuiThreadShell["id"] | null;
  readonly filter: string;
  readonly searchMatches: readonly ShelfSearchMatch[];
}

/** Every row the GUI-style sidebar shows, in order. The view and key handling both read this. */
export function buildShelfRows(input: BuildShelfRowsInput): readonly ShelfRow[] {
  const { now, live, capabilities } = input;
  const scoped = input.threads.filter(
    (thread) => input.projectScope === null || thread.projectId === input.projectScope,
  );
  const threadRow = (
    thread: TuiThreadShell,
    shelf: ThreadShelf,
    variant: ShelfThreadRow["variant"],
    excerpt: string | null = null,
  ): ShelfThreadRow => ({
    kind: "thread",
    id: thread.id,
    thread,
    shelf,
    status: resolveShelfStatus(thread, now, live),
    unread: hasUnseenCompletion(thread) || isWoke(thread, now),
    time:
      shelf === "snoozed" && thread.snoozedUntil
        ? snoozeWakeLabel(thread.snoozedUntil, { now })
        : shelf === "settled"
          ? compactAge(settledTimestamp(thread), now)
          : compactAge(thread.latestUserMessageAt ?? thread.updatedAt, now),
    excerpt,
    variant,
  });
  const query = input.filter.trim().toLocaleLowerCase();
  if (query) {
    // Title and pull request matches lead, then whatever the server found in message text.
    const direct = scoped.filter((thread) => matchesSearch(thread, query));
    const seen = new Set(direct.map((thread) => thread.id));
    const fromContent = input.searchMatches.flatMap((match) => {
      if (seen.has(match.threadId)) return [];
      const thread = scoped.find((candidate) => candidate.id === match.threadId);
      if (!thread) return [];
      seen.add(thread.id);
      return [{ thread, excerpt: match.snippet }];
    });
    return [...direct.map((thread) => ({ thread, excerpt: null })), ...fromContent].map(
      ({ thread, excerpt }) =>
        threadRow(thread, resolveShelf(thread, now, capabilities), "search", excerpt),
    );
  }
  const shelves: Record<ThreadShelf, TuiThreadShell[]> = {
    pinned: [],
    active: [],
    working: [],
    snoozed: [],
    settled: [],
  };
  for (const thread of scoped) {
    const shelf = resolveShelf(thread, now, capabilities);
    shelves[shelf === "active" && input.isWorking(thread.id) ? "working" : shelf].push(thread);
  }
  const collapsible = (shelf: CollapsibleShelf, threads: readonly TuiThreadShell[]) => {
    const expanded = input.expandedShelves.includes(shelf);
    const paged =
      shelf === "settled" && expanded && threads.length > input.settledLimit
        ? threads.slice(0, input.settledLimit)
        : threads;
    const listed = expanded
      ? paged.some((thread) => thread.id === input.openThreadId)
        ? paged
        : [...paged, ...threads.filter((thread) => thread.id === input.openThreadId)]
      : threads.filter((thread) => thread.id === input.openThreadId);
    const hidden = expanded ? threads.length - listed.length : 0;
    return [
      { kind: "shelf" as const, id: `shelf:${shelf}`, shelf, count: threads.length, expanded },
      ...listed.map((thread) => threadRow(thread, shelf, shelf === "working" ? "card" : "slim")),
      ...(hidden > 0
        ? [
            {
              kind: "more" as const,
              id: `more:${shelf}`,
              count: Math.min(hidden, SETTLED_NEXT_PAGE),
            },
          ]
        : []),
    ];
  };
  const byWake = [...shelves.snoozed].sort(
    (left, right) => Date.parse(left.snoozedUntil ?? "") - Date.parse(right.snoozedUntil ?? ""),
  );
  const bySettled = shelves.settled
    .map((thread) => {
      const timestamp = settledTimestamp(thread);
      return { thread, at: timestamp === null ? 0 : Date.parse(timestamp) };
    })
    .sort((left, right) => right.at - left.at || left.thread.id.localeCompare(right.thread.id))
    .map(({ thread }) => thread);
  return [
    ...(input.scopeReachable ? [{ kind: "project-scope", id: "project-scope" } as const] : []),
    ...sortPinnedThreadsByOrderKey(shelves.pinned).map((thread) =>
      threadRow(thread, "pinned", "card"),
    ),
    // Activity decides this order, so what just came back to you is always on top.
    ...newestFirst(shelves.active, (thread) =>
      Math.max(
        stamp(thread.createdAt),
        stamp(thread.unsettledAt),
        stamp(thread.latestTurn?.requestedAt),
        stamp(thread.latestTurn?.completedAt),
        input.returnedAt(thread.id) ?? 0,
      ),
    ).map((thread) => threadRow(thread, "active", "card")),
    // Only what you last sent moves a row here, so the shelf holds still while agents finish.
    ...(shelves.working.length > 0
      ? collapsible(
          "working",
          newestFirst(shelves.working, (thread) =>
            Math.max(
              stamp(thread.createdAt),
              stamp(thread.latestUserAuthoredMessageAt ?? thread.latestTurn?.requestedAt),
            ),
          ),
        )
      : []),
    ...(byWake.length > 0 ? collapsible("snoozed", byWake) : []),
    // Settled keeps its header whenever anything is listed, so the shelf is always discoverable.
    ...(scoped.length > 0 ? collapsible("settled", bySettled) : []),
  ];
}

/** Where the cursor sits: the open thread in a conversation, otherwise the row last moved to. */
export function resolveShelfCursor(
  rows: readonly ShelfRow[],
  state: {
    readonly route: string;
    readonly threadId: string | null;
    readonly shelfCursor?: string;
  },
  previousIndex = 0,
) {
  if (state.route === "conversation") return rows.findIndex((row) => row.id === state.threadId);
  const atCursor = rows.findIndex((row) => row.id === state.shelfCursor);
  if (atCursor >= 0) return atCursor;
  // A row that just left (settled, snoozed) hands the cursor to whatever took its place, so triage
  // keeps its position instead of jumping back to the top. The dropdown has to be moved to, so an
  // Enter meant for a thread cannot open it.
  const index = rows.length > 0 ? Math.min(previousIndex, rows.length - 1) : -1;
  return rows[index]?.kind === "project-scope" && rows.length > 1 ? index + 1 : index;
}

export const threadRowsOf = (rows: readonly ShelfRow[]) =>
  rows.filter((row): row is ShelfThreadRow => row.kind === "thread");

/** Adds or removes one thread from the selection. */
export function toggleMarked<Id>(marked: readonly Id[], id: Id): readonly Id[] {
  return marked.includes(id) ? marked.filter((item) => item !== id) : [...marked, id];
}

/** Adds every listed thread from the anchor through the target, keeping what is already selected. */
export function markRange(
  marked: readonly TuiThreadShell["id"][],
  rows: readonly ShelfRow[],
  anchor: TuiThreadShell["id"] | null,
  target: TuiThreadShell["id"],
): readonly TuiThreadShell["id"][] {
  const listed = threadRowsOf(rows).map((row) => row.id);
  const end = listed.indexOf(target);
  if (end < 0) return marked;
  const found = anchor === null ? -1 : listed.indexOf(anchor);
  const start = found < 0 ? end : found;
  const range = listed.slice(Math.min(start, end), Math.max(start, end) + 1);
  return [...marked, ...range.filter((id) => !marked.includes(id))];
}

const SNOOZE_UNITS = { m: "minutes", h: "hours", d: "days" } as const;
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Reads what someone types for a custom snooze: "90m", "2 hours", "3d", "18:30" (the next time the
 * clock reads that), or "2026-11-05 09:00". Past and impossible times come back as null.
 */
export function parseCustomSnooze(text: string, now: Date): string | null {
  const input = text.trim().toLowerCase();
  const duration = /^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)$/u.exec(input);
  if (duration) {
    const unit = duration[2]![0] as keyof typeof SNOOZE_UNITS;
    return resolveCustomSnooze(
      { mode: "duration", amount: duration[1]!, unit: SNOOZE_UNITS[unit] },
      now,
    );
  }
  const dated = /^(\d{4}-\d{2}-\d{2})[ t](\d{1,2}):(\d{2})$/u.exec(input);
  if (dated) {
    return resolveCustomSnooze(
      { mode: "date", date: dated[1]!, time: `${dated[2]!.padStart(2, "0")}:${dated[3]}` },
      now,
    );
  }
  const clock = /^(\d{1,2}):(\d{2})$/u.exec(input);
  if (!clock) return null;
  const time = `${clock[1]!.padStart(2, "0")}:${clock[2]}`;
  const dateOf = (day: Date) =>
    `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    resolveCustomSnooze({ mode: "date", date: dateOf(now), time }, now) ??
    resolveCustomSnooze({ mode: "date", date: dateOf(tomorrow), time }, now)
  );
}
