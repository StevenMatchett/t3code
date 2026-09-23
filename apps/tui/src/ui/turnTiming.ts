import type { OrchestrationLatestTurn } from "@t3tools/contracts";

type TurnTiming = Pick<
  OrchestrationLatestTurn,
  "state" | "requestedAt" | "startedAt" | "completedAt"
>;

function timestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTurnDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function turnTimingLabel(
  turn: TurnTiming | null,
  nowMs: number,
  runningSince: string | null = null,
): string | null {
  if (turn === null) {
    const startedAt = timestamp(runningSince);
    return startedAt === null ? null : formatTurnDuration(nowMs - startedAt);
  }
  const startedAt =
    timestamp(turn.startedAt) ?? timestamp(turn.requestedAt) ?? timestamp(runningSince);
  if (startedAt === null) return null;

  if (turn.completedAt === null) {
    if (turn.state !== "running") return null;
    return formatTurnDuration(nowMs - startedAt);
  }

  if (turn.state !== "completed" && turn.state !== "interrupted") return null;
  const completedAt = timestamp(turn.completedAt);
  if (completedAt === null) return null;
  const completedDate = new Date(completedAt);
  const localTime =
    completedDate.toDateString() === new Date(nowMs).toDateString()
      ? completedDate.toLocaleTimeString(undefined, { timeStyle: "short" })
      : completedDate.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  return `Took ${formatTurnDuration(completedAt - startedAt)} · Finished ${localTime}`;
}
