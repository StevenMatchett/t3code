import { describe, expect, it } from "@effect/vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";
import { createSoundTracker } from "./notificationSounds.ts";

type Thread = Parameters<ReturnType<typeof createSoundTracker>>[0][number];
const idle: Thread = {
  id: ThreadId.make("thread"),
  archivedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  latestTurn: null,
  session: null,
};
const finished: Thread = {
  ...idle,
  latestTurn: {
    turnId: TurnId.make("turn"),
    state: "completed",
    completedAt: "2026-10-05T12:00:00Z",
    requestedAt: "2026-10-05T11:59:00Z",
    startedAt: "2026-10-05T11:59:00Z",
    assistantMessageId: null,
  },
};

describe("TUI notification transitions", () => {
  it("detects completion when a turn has no checkpoint or latestTurn", () => {
    const track = createSoundTracker();
    const session: NonNullable<Thread["session"]> = {
      threadId: idle.id,
      status: "running",
      providerName: null,
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-10-05T12:00:00Z",
    };
    track([{ ...idle, session }], true);
    const settled = { ...idle, session: { ...session, status: "ready" as const } };
    expect(track([settled], true)).toBe("completion");
    expect(track([settled], true)).toBeNull();
    track([], false);
    expect(track([settled], true)).toBeNull();
  });
  it("silences initial snapshots and reconnect history", () => {
    const track = createSoundTracker();
    expect(track([finished], true)).toBeNull();
    expect(track([], false)).toBeNull();
    expect(track([{ ...finished, hasPendingUserInput: true }], true)).toBeNull();
  });
  it("plays once for input and approvals, and rearms after resolution", () => {
    const track = createSoundTracker();
    track([idle], true);
    const input = { ...idle, hasPendingUserInput: true };
    expect(track([input], true)).toBe("input");
    expect(track([input], true)).toBeNull();
    track([idle], true);
    expect(track([input], true)).toBe("input");
    expect(track([{ ...idle, hasPendingApprovals: true }], true)).toBe("input");
  });
  it("plays completion once and ignores unrelated updates and interruptions", () => {
    const track = createSoundTracker();
    track([idle], true);
    expect(track([finished], true)).toBe("completion");
    expect(track([{ ...finished }], true)).toBeNull();
    expect(track([idle], true)).toBeNull();
    expect(track([finished], true)).toBeNull();
    expect(
      track([{ ...finished, latestTurn: { ...finished.latestTurn!, state: "interrupted" } }], true),
    ).toBeNull();
  });
  it("ignores archived and newly discovered threads", () => {
    const track = createSoundTracker();
    track([idle], true);
    expect(track([{ ...finished, archivedAt: "2026-10-05T12:01:00Z" }], true)).toBeNull();
    expect(track([finished], true)).toBeNull();
  });
  it("coalesces alerts and prioritizes input across threads", () => {
    const track = createSoundTracker();
    const other = { ...idle, id: ThreadId.make("other") };
    track([idle, other], true);
    expect(track([finished, { ...other, hasPendingApprovals: true }], true)).toBe("input");
  });
});
