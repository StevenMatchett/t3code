import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import type { TuiThreadShell } from "../connection/models.ts";
import { planThreadUndo } from "../features/threads/management.ts";
import {
  buildShelfRows,
  compactAge,
  createInboxTracker,
  markRange,
  parseCustomSnooze,
  resolveShelfCursor,
  resolveShelfStatus,
  threadRowsOf,
  toggleMarked,
  WORKING_EXIT_GRACE_MS,
  type BuildShelfRowsInput,
  type ShelfRow,
} from "./threadShelves.ts";

const NOW = "2026-11-04T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const ago = (minutes: number) => new Date(NOW_MS - minutes * 60_000).toISOString();
const ALL = {
  repositoryIdentity: true,
  threadSettlement: true,
  threadSnooze: true,
  threadPinning: true,
};

const turn = (state: "running" | "completed" | "error", completedMinutesAgo: number | null) => ({
  turnId: TurnId.make("turn"),
  state,
  requestedAt: ago(120),
  startedAt: ago(120),
  completedAt: completedMinutesAgo === null ? null : ago(completedMinutesAgo),
  assistantMessageId: null,
});

const thread = (id: string, overrides: Partial<TuiThreadShell> = {}) =>
  ({
    id: ThreadId.make(id),
    projectId: ProjectId.make("alpha"),
    title: `Thread ${id}`,
    createdAt: ago(1_000),
    updatedAt: ago(1_000),
    latestUserMessageAt: null,
    latestTurn: null,
    session: null,
    settledOverride: null,
    settledAt: null,
    pinnedAt: null,
    pullRequests: [],
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    ...overrides,
  }) as TuiThreadShell;

const rowsFor = (
  threads: readonly TuiThreadShell[],
  overrides: Partial<BuildShelfRowsInput> = {},
) =>
  buildShelfRows({
    threads,
    capabilities: ALL,
    isWorking: () => false,
    returnedAt: () => undefined,
    now: NOW,
    live: true,
    projectScope: null,
    scopeReachable: false,
    expandedShelves: [],
    settledLimit: 10,
    openThreadId: null,
    filter: "",
    searchMatches: [],
    ...overrides,
  });

const ids = (rows: readonly ShelfRow[]) => rows.map((row) => row.id);

describe("inbox shelves", () => {
  it("lists pinned, then the inbox, then each parked shelf collapsed", () => {
    const rows = rowsFor(
      [
        thread("settled", { settledOverride: "settled", settledAt: ago(5) }),
        thread("snoozed", { snoozedUntil: ago(-60), snoozedAt: ago(5) }),
        thread("busy"),
        thread("inbox"),
        thread("pinned", { pinnedAt: ago(5) }),
      ],
      { isWorking: (id) => id === "busy" },
    );
    expect(ids(rows)).toEqual([
      "pinned",
      "inbox",
      "shelf:working",
      "shelf:snoozed",
      "shelf:settled",
    ]);
  });

  it("puts what came back most recently on top of the inbox", () => {
    const rows = rowsFor(
      [
        thread("old", { latestTurn: turn("completed", 300) }),
        thread("finished", { latestTurn: turn("completed", 1) }),
        thread("returned", { latestTurn: turn("completed", 300) }),
      ],
      { returnedAt: (id) => (id === "returned" ? NOW_MS : undefined) },
    );
    expect(ids(rows).slice(0, 3)).toEqual(["returned", "finished", "old"]);
  });

  it("keeps the open thread on screen under a collapsed shelf", () => {
    const rows = rowsFor([thread("a", { settledOverride: "settled" }), thread("b")], {
      openThreadId: ThreadId.make("a"),
    });
    expect(ids(rows)).toEqual(["b", "shelf:settled", "a"]);
  });

  it("does not park threads on shelves the server cannot take them back from", () => {
    const rows = rowsFor([thread("a", { settledOverride: "settled" })], {
      capabilities: { repositoryIdentity: true },
    });
    expect(threadRowsOf(rows)[0]?.shelf).toBe("active");
  });

  it("pages the settled shelf and says how many more the next step shows", () => {
    const settled = Array.from({ length: 40 }, (_, index) =>
      thread(`s${String(index).padStart(2, "0")}`, {
        settledOverride: "settled",
        settledAt: ago(index + 1),
      }),
    );
    const rows = rowsFor(settled, { expandedShelves: ["settled"] });
    expect(threadRowsOf(rows)).toHaveLength(10);
    expect(rows.at(-1)).toMatchObject({ kind: "more", count: 25 });
    expect(threadRowsOf(rows)[0]?.id).toBe("s00");
  });

  it("searches titles first, then message matches, ignoring shelves", () => {
    const rows = rowsFor(
      [
        thread("title", { title: "Fix login" }),
        thread("body", { title: "Other" }),
        thread("miss", { title: "Nope" }),
      ],
      {
        filter: "login",
        searchMatches: [
          { threadId: ThreadId.make("title"), snippet: "duplicate" },
          { threadId: ThreadId.make("body"), snippet: "the login page" },
        ],
      },
    );
    expect(ids(rows)).toEqual(["title", "body"]);
    expect(threadRowsOf(rows)[1]).toMatchObject({ variant: "search", excerpt: "the login page" });
  });
});

describe("project dropdown row", () => {
  const threads = [thread("first"), thread("second")];
  const reachable = { scopeReachable: true };

  it("comes before the first row whenever the dropdown is on screen", () => {
    expect(ids(rowsFor(threads, reachable)).slice(0, 1)).toEqual(["project-scope"]);
    expect(ids(rowsFor(threads))).not.toContain("project-scope");
    expect(ids(rowsFor([], reachable))).toEqual(["project-scope"]);
  });

  it("leaves search results alone, so Enter still opens the top match", () => {
    expect(ids(rowsFor(threads, { ...reachable, filter: "first" }))).not.toContain("project-scope");
  });

  it("is only reached by moving to it", () => {
    const rows = rowsFor(threads, reachable);
    const state = { route: "threads", threadId: null };
    expect(rows[resolveShelfCursor(rows, state, 0)]?.kind).toBe("thread");
    expect(
      rows[resolveShelfCursor(rows, { ...state, shelfCursor: "project-scope" }, 0)]?.kind,
    ).toBe("project-scope");
    expect(resolveShelfCursor(rowsFor([], reachable), state, 0)).toBe(0);
  });
});

describe("row status", () => {
  it("follows the GUI's precedence, with attention before work", () => {
    const status = (overrides: Partial<TuiThreadShell>) =>
      resolveShelfStatus(thread("a", overrides), NOW, true);
    expect(status({ hasPendingApprovals: true, latestTurn: turn("running", null) })).toBe(
      "approval",
    );
    expect(status({ hasPendingUserInput: true })).toBe("input");
    expect(status({ latestTurn: turn("running", null) })).toBe("working");
    expect(status({ latestTurn: turn("error", 1) })).toBe("failed");
    expect(status({ latestTurn: turn("error", 1), lastErrorClass: "usage_limit" })).toBe("limited");
    expect(status({ latestTurn: turn("completed", 1), lastVisitedAt: ago(5) })).toBe("done");
    expect(status({ latestTurn: turn("completed", 10), lastVisitedAt: ago(5) })).toBe("none");
    // Never visited counts as read, so a first launch does not light up every old thread.
    expect(status({ latestTurn: turn("completed", 1), lastVisitedAt: null })).toBe("none");
    expect(status({ snoozedUntil: ago(1), snoozedAt: ago(60) })).toBe("woke");
  });

  it("claims nothing without a live stream", () => {
    expect(resolveShelfStatus(thread("a", { hasPendingApprovals: true }), NOW, false)).toBe("none");
  });

  it("formats ages compactly and never negative", () => {
    expect(compactAge(ago(0), NOW)).toBe("now");
    expect(compactAge(ago(-5), NOW)).toBe("now");
    expect(compactAge(ago(5), NOW)).toBe("5m");
    expect(compactAge(ago(180), NOW)).toBe("3h");
    expect(compactAge(ago(2_880), NOW)).toBe("2d");
  });
});

describe("inbox tracker", () => {
  const running = thread("a", { latestTurn: turn("running", null) });
  const finished = thread("a", { latestTurn: turn("completed", 0) });

  const tracked = () => {
    const tracker = createInboxTracker(() => undefined);
    tracker.observe([running], ALL, NOW_MS);
    return tracker;
  };

  it("holds a finished thread in Working through the grace, then records its return", () => {
    const tracker = tracked();
    tracker.observe([finished], ALL, NOW_MS + 100);
    expect(tracker.isWorking("a")).toBe(true);
    expect(tracker.returnedAt("a")).toBeUndefined();
    const after = NOW_MS + 100 + WORKING_EXIT_GRACE_MS;
    tracker.observe([finished], ALL, after);
    expect(tracker.isWorking("a")).toBe(false);
    expect(tracker.returnedAt("a")).toBe(after);
    tracker.dispose();
  });

  it("brings a thread back at once when it needs the user", () => {
    const tracker = tracked();
    tracker.observe([{ ...finished, hasPendingApprovals: true }], ALL, NOW_MS + 100);
    expect(tracker.isWorking("a")).toBe(false);
    expect(tracker.returnedAt("a")).toBe(NOW_MS + 100);
    tracker.dispose();
  });

  it("goes straight to Settled instead of flashing in the inbox", () => {
    const tracker = tracked();
    tracker.observe([{ ...finished, settledOverride: "settled" }], ALL, NOW_MS + 100);
    expect(tracker.isWorking("a")).toBe(false);
    tracker.dispose();
  });
});

describe("triage", () => {
  it("hands the cursor to the row that took a parked thread's place", () => {
    const rows = rowsFor([thread("a"), thread("b")]);
    const state = { route: "threads", threadId: "gone", shelfCursor: "gone" };
    expect(resolveShelfCursor(rows, state, 1)).toBe(1);
    expect(resolveShelfCursor(rows, state, 9)).toBe(rows.length - 1);
    expect(resolveShelfCursor([], state, 1)).toBe(-1);
  });

  it("restores a pin before its snooze, because pinning clears a snooze on the server", () => {
    const pinned = { pinnedAt: ago(5), pinOrderKey: "m", snoozedUntil: ago(-60) };
    expect(planThreadUndo("settle", pinned).map((step) => step.type)).toEqual([
      "unsettle",
      "pin",
      "snooze",
    ]);
    expect(planThreadUndo("unpin", pinned)[0]).toEqual({ type: "pin", orderKey: "m" });
    expect(planThreadUndo("snooze", pinned)).toEqual([{ type: "wake" }]);
  });
});

describe("multi-select", () => {
  const rows = rowsFor([thread("a"), thread("b"), thread("c"), thread("d")]);
  const id = (value: string) => ThreadId.make(value);
  const order = threadRowsOf(rows).map((row) => row.id);

  it("toggles one thread at a time", () => {
    expect(toggleMarked([id("a")], id("b"))).toEqual(["a", "b"]);
    expect(toggleMarked([id("a"), id("b")], id("a"))).toEqual(["b"]);
  });

  it("selects a range in either direction and keeps what was already selected", () => {
    const range = markRange([id("z")], rows, order[0]!, order[2]!);
    expect(range).toEqual(["z", order[0], order[1], order[2]]);
    expect(markRange([], rows, order[2]!, order[0]!).toSorted()).toEqual(
      [order[0], order[1], order[2]].toSorted(),
    );
  });

  it("selects just the target without an anchor, and nothing for an unlisted thread", () => {
    expect(markRange([], rows, null, order[1]!)).toEqual([order[1]]);
    expect(markRange([id("a")], rows, null, id("gone"))).toEqual(["a"]);
  });
});

describe("custom snooze", () => {
  // Built from local parts: clock input is local time, wherever this test runs.
  const now = new Date(2026, 10, 4, 12, 0, 0);
  const after = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it.each([
    ["90m", 90 * 60_000],
    ["2 hours", 2 * 3_600_000],
    ["1.5h", 1.5 * 3_600_000],
    ["3d", 3 * 86_400_000],
    ["  45 MIN ", 45 * 60_000],
  ])("reads %s as a duration", (text, ms) => {
    expect(parseCustomSnooze(text, now)).toBe(after(ms));
  });

  it("reads a clock time as its next occurrence", () => {
    expect(parseCustomSnooze("18:30", now)).toBe(new Date(2026, 10, 4, 18, 30).toISOString());
    expect(parseCustomSnooze("9:00", now)).toBe(new Date(2026, 10, 5, 9, 0).toISOString());
  });

  it("reads a date and time", () => {
    expect(parseCustomSnooze("2026-11-05 09:00", now)).toBe(
      new Date(2026, 10, 5, 9, 0).toISOString(),
    );
  });

  it.each(["", "soon", "0m", "-5m", "2026-11-03 09:00", "2026-13-40 09:00", "25:00"])(
    "rejects %j",
    (text) => {
      expect(parseCustomSnooze(text, now)).toBeNull();
    },
  );
});
