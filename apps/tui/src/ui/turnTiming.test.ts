import { describe, expect, it } from "@effect/vitest";
import { formatTurnDuration, turnTimingLabel } from "./turnTiming.ts";

const requestedAt = "2026-09-23T14:00:00.000Z";
const startedAt = "2026-09-23T14:00:05.000Z";
const completedAt = "2026-09-23T14:02:10.000Z";

describe("turn timing", () => {
  it("formats elapsed time from the actual start and falls back to request time", () => {
    const now = Date.parse("2026-09-23T14:01:10.000Z");
    expect(
      turnTimingLabel({ state: "running", requestedAt, startedAt, completedAt: null }, now),
    ).toBe("1m 5s");
    expect(
      turnTimingLabel({ state: "running", requestedAt, startedAt: null, completedAt: null }, now),
    ).toBe("1m 10s");
    expect(turnTimingLabel(null, now, requestedAt)).toBe("1m 10s");
  });

  it("shows only local time today and includes the date after local midnight", () => {
    const localCompleted = new Date(2026, 8, 23, 14, 2, 10);
    const localStarted = new Date(2026, 8, 23, 14, 0, 5).toISOString();
    const turn = {
      state: "completed" as const,
      requestedAt: localStarted,
      startedAt: localStarted,
      completedAt: localCompleted.toISOString(),
    };
    const localTime = localCompleted.toLocaleTimeString(undefined, { timeStyle: "short" });
    expect(turnTimingLabel(turn, new Date(2026, 8, 23, 23, 59).getTime())).toBe(
      `Took 2m 5s · Finished ${localTime}`,
    );
    const datedTime = localCompleted.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
    expect(turnTimingLabel(turn, new Date(2026, 8, 24, 0, 1).getTime())).toBe(
      `Took 2m 5s · Finished ${datedTime}`,
    );
  });

  it("ignores missing, invalid, and unsettled timing", () => {
    const now = Date.parse(completedAt);
    expect(turnTimingLabel(null, now)).toBeNull();
    expect(
      turnTimingLabel(
        { state: "running", requestedAt: "invalid", startedAt: null, completedAt: null },
        now,
      ),
    ).toBeNull();
    expect(
      turnTimingLabel({ state: "error", requestedAt, startedAt, completedAt: null }, now),
    ).toBeNull();
    expect(formatTurnDuration(-1_000)).toBe("0s");
    expect(formatTurnDuration(3_661_000)).toBe("1h 1m");
  });
});
