import type { TuiLatestTurn } from "../../connection/models.ts";
import type { ThreadActivityPhase } from "../../features/chat/threadActivity.ts";
import { Button } from "../../ui/Button.tsx";
import { Stack, Text } from "../../ui/primitives.tsx";
import { ThreadActivityIndicator } from "../../ui/ThreadActivityIndicator.tsx";
import { TurnTiming } from "../../ui/TurnTiming.tsx";

/** One line above the composer: where the thread runs, what it is doing, and what happened last. */
export function StatusRow({
  worktree,
  phase,
  animate,
  timingTurn,
  runningSince,
  showParent,
  renderMarkdown,
  message,
  messageTone,
  detail,
  onDiff,
  onParent,
  onToggleMarkdown,
}: {
  readonly worktree: boolean;
  readonly phase: ThreadActivityPhase;
  readonly animate: boolean;
  readonly timingTurn: TuiLatestTurn | null;
  readonly runningSince: string | null;
  readonly showParent: boolean;
  readonly renderMarkdown: boolean;
  readonly message: string;
  readonly messageTone: "muted" | "warning";
  readonly detail: string;
  readonly onDiff: () => void;
  readonly onParent: () => void;
  readonly onToggleMarkdown: () => void;
}) {
  return (
    <Stack id="conversation-activity" height={1} flexShrink={0} flexDirection="row">
      <Text id="thread-workspace-label" tone="accent" height={1} flexShrink={0} wrapMode="none">
        {worktree ? "Worktree" : "Local"}
        {"  "}
      </Text>
      <Button id="thread-diff-action" label="[D Changes] " tone="accent" onPress={onDiff} />
      {showParent ? (
        <Button id="thread-parent-action" label="[U Parent] " tone="accent" onPress={onParent} />
      ) : null}
      <ThreadActivityIndicator phase={phase} visible={animate} />
      <TurnTiming turn={timingTurn} runningSince={runningSince} />
      <Button
        id="output-markdown-toggle"
        label={renderMarkdown ? " [MD]" : " [Raw]"}
        tone="accent"
        onPress={onToggleMarkdown}
      />
      <Text tone={messageTone} flexGrow={1} minWidth={0} height={1} wrapMode="none" truncate>
        {message ? `  ${message}` : ""}
      </Text>
      {detail ? (
        <Text tone="muted" flexShrink={0} maxWidth="70%" height={1} wrapMode="none" truncate>
          {`  ${detail}`}
        </Text>
      ) : null}
    </Stack>
  );
}
