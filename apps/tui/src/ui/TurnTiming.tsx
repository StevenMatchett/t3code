import type { OrchestrationLatestTurn } from "@t3tools/contracts";
import { useActivityClock, useLocalDay } from "./ThreadActivityIndicator.tsx";
import { Text } from "./primitives.tsx";
import { turnTimingLabel } from "./turnTimingFormat.ts";

function RunningTiming({
  turn,
  compact,
  runningSince,
}: {
  readonly turn: OrchestrationLatestTurn | null;
  readonly compact: boolean;
  readonly runningSince: string | null;
}) {
  const { now } = useActivityClock();
  const label = turnTimingLabel(turn, now, runningSince);
  return label === null ? null : (
    <Text id="thread-turn-timing" tone="muted" flexShrink={0} height={1} wrapMode="none">
      {compact ? ` ${label}` : `  ${label}`}
    </Text>
  );
}

function CompletedTiming({ turn }: { readonly turn: OrchestrationLatestTurn }) {
  const today = useLocalDay();
  const label = turnTimingLabel(turn, today);
  return label === null ? null : (
    <Text id="thread-turn-timing" tone="muted" flexShrink={0} height={1} wrapMode="none" truncate>
      {`  ${label}`}
    </Text>
  );
}

export function TurnTiming({
  turn,
  compact = false,
  runningSince = null,
}: {
  readonly turn: OrchestrationLatestTurn | null;
  readonly compact?: boolean;
  readonly runningSince?: string | null;
}) {
  if (turn?.state === "running" && turn.completedAt === null)
    return <RunningTiming turn={turn} compact={compact} runningSince={runningSince} />;
  if (runningSince !== null)
    return <RunningTiming turn={null} compact={compact} runningSince={runningSince} />;
  if (compact || turn === null || turn.completedAt === null) return null;
  return <CompletedTiming turn={turn} />;
}
