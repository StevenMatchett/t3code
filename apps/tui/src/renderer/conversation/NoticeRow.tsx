import { FormInput } from "../../ui/FormField.tsx";
import { Stack, Text } from "../../ui/primitives.tsx";
import { inlineTerminalText } from "../../ui/textLayout.ts";
import type { QueuedPrompt } from "../../features/chat/interactions.ts";

/**
 * The row reserved above the status line. Find, errors, and the queue all use it, so none of them
 * shift the transcript or the composer when they appear.
 */
export function NoticeRow({
  height,
  search,
  matchCount,
  matchIndex,
  inputFocused,
  onSearchInput,
  error,
  queued,
  queueLength,
}: {
  readonly height: number;
  readonly search: { readonly query: string } | null;
  readonly matchCount: number;
  readonly matchIndex: number;
  readonly inputFocused: boolean;
  readonly onSearchInput: (query: string) => void;
  readonly error: string | null;
  readonly queued: QueuedPrompt | undefined;
  readonly queueLength: number;
}) {
  if (height === 0) return null;
  if (search)
    return (
      <Stack height={1} flexShrink={0} flexDirection="row">
        <Text tone="accent" flexShrink={0} height={1}>
          Find:{" "}
        </Text>
        <FormInput
          id="thread-search-input"
          focused={inputFocused}
          value={search.query}
          placeholder="Search loaded output..."
          onInput={onSearchInput}
        />
        <Text flexShrink={0} height={1} tone={search.query && !matchCount ? "warning" : "muted"}>
          {matchCount
            ? `${matchIndex + 1}/${matchCount}`
            : search.query
              ? "No matches"
              : "Type to search"}
        </Text>
      </Stack>
    );
  if (error)
    return (
      <Text height={1} flexShrink={0} tone="danger" wrapMode="none" truncate>
        {error}
      </Text>
    );
  if (queued)
    return (
      <Stack id="queued-message" height={1} flexShrink={0}>
        <Text tone="warning" height={1} wrapMode="none" truncate>
          {queued.status === "sending"
            ? "Sending queued message"
            : queued.status === "held"
              ? "Queue paused"
              : "Queued"}
          {` (${queueLength}): ${inlineTerminalText(queued.command.message.text) || "[image]"}`}
        </Text>
      </Stack>
    );
  return <Stack height={1} flexShrink={0} />;
}
