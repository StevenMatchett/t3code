import type { TuiThreadShell } from "../../connection/models.ts";

export type NotificationSound = "input" | "completion";
type Thread = Pick<
  TuiThreadShell,
  "id" | "archivedAt" | "hasPendingApprovals" | "hasPendingUserInput" | "latestTurn" | "session"
>;

/** Baseline each connection and coalesce simultaneous changes into one alert. */
export function createSoundTracker() {
  let previous = new Map<
    string,
    { attention: string | null; completion: string | null; working: boolean }
  >();
  return (threads: readonly Thread[], live: boolean): NotificationSound | null => {
    if (!live) {
      previous.clear();
      return null;
    }
    const next = new Map<
      string,
      { attention: string | null; completion: string | null; working: boolean }
    >();
    let sound: NotificationSound | null = null;
    for (const thread of threads) {
      if (thread.archivedAt !== null) continue;
      const prior = previous.get(thread.id);
      const turn = thread.latestTurn;
      const attention =
        thread.hasPendingApprovals || thread.hasPendingUserInput
          ? `${turn?.turnId ?? ""}:${thread.hasPendingApprovals ? "approval" : "input"}`
          : null;
      const completion =
        turn?.state === "completed" && turn.completedAt !== null
          ? `${turn.turnId}:${turn.completedAt}`
          : (prior?.completion ?? null);
      const working =
        turn?.state === "running" ||
        thread.session?.status === "running" ||
        thread.session?.status === "starting";
      // Turns without checkpoints can lose latestTurn when their session settles.
      const settledAfterWork =
        prior?.working &&
        !working &&
        !attention &&
        turn?.state !== "error" &&
        turn?.state !== "interrupted" &&
        (thread.session?.status === "ready" || thread.session?.status === "idle");
      next.set(thread.id, { attention, completion, working });
      if (!prior) continue;
      if (attention && attention !== prior.attention) sound = "input";
      else if (
        ((completion && completion !== prior.completion) || settledAfterWork) &&
        sound !== "input"
      )
        sound = "completion";
    }
    previous = next;
    return sound;
  };
}
