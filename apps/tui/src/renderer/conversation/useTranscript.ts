import type { MessageId, ThreadId } from "@t3tools/contracts";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { RegistryContext } from "@effect/atom-react";
import type { TuiClient } from "../../connection/clientRuntime.ts";
import type { TuiThread } from "../../connection/models.ts";
import { projectRecordedThreadTimeline } from "../../features/chat/timeline.ts";
import { conversationLines, type ConversationLine } from "../../ui/conversationLines.ts";
import { textMatches } from "../../ui/textSearch.ts";

/**
 * Where the reader is. Null follows the live edge. Otherwise it names a rendered line by identity, so
 * streamed output and older pages never move what is on screen. `width` and `of` let a resize find
 * the same place after the message rewraps.
 */
export interface TranscriptAnchor {
  readonly id: string;
  readonly line: number;
  readonly width?: number;
  readonly of?: number;
}

export interface TranscriptSearch {
  readonly query: string;
  readonly index: number;
}

const lineCount = (lines: readonly ConversationLine[], id: string) => {
  let total = 0;
  for (const line of lines) if (line.id === id) total += 1;
  return total;
};

/** Finds the index of the anchored line, scaling its position when the width changed. */
export function resolveAnchorIndex(
  lines: readonly ConversationLine[],
  anchor: TranscriptAnchor,
  width: number,
) {
  const line =
    anchor.width !== undefined && anchor.of && anchor.width !== width
      ? Math.floor((anchor.line / anchor.of) * lineCount(lines, anchor.id))
      : anchor.line;
  const exact = lines.findIndex((entry) => entry.id === anchor.id && entry.line >= line);
  return exact >= 0 ? exact : lines.findIndex((entry) => entry.id === anchor.id);
}

/** Line indexes where each user prompt starts. Only user messages render highlighted lines. */
export function promptStarts(lines: readonly ConversationLine[]) {
  const starts: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.highlight && line.line === 0) starts.push(index);
  }
  return starts;
}

export function useTranscript({
  client,
  threadId,
  thread,
  page,
  width,
  count,
  expanded,
  expandedToolGroups,
  renderMarkdown,
  unicode,
  search,
  anchor,
  setAnchor,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly thread: TuiThread | null;
  readonly page: { readonly hasMoreHistory?: boolean; readonly loading?: boolean } | undefined;
  readonly width: number;
  readonly count: number;
  readonly expanded: boolean;
  readonly expandedToolGroups: ReadonlyMap<string, boolean>;
  readonly renderMarkdown: boolean;
  readonly unicode: boolean;
  readonly search: TranscriptSearch | null;
  readonly anchor: TranscriptAnchor | null;
  readonly setAnchor: (anchor: TranscriptAnchor | null) => void;
}) {
  const registry = useContext(RegistryContext);
  const timeline = useMemo(
    () => (thread === null ? [] : projectRecordedThreadTimeline(thread)),
    [thread],
  );
  /** The message behind each prompt's rendered lines, keyed by line id. */
  const promptMessageIds = useMemo(
    () =>
      new Map<string, MessageId>(
        timeline.flatMap((row) =>
          row.source === "message" && row.kind === "user" ? [[row.id, row.sourceId]] : [],
        ),
      ),
    [timeline],
  );
  const lines = useMemo(
    () => conversationLines(timeline, width, expanded, expandedToolGroups, renderMarkdown, unicode),
    [timeline, width, expanded, expandedToolGroups, renderMarkdown, unicode],
  );
  const maxStart = Math.max(0, lines.length - count);
  const searchQuery = search?.query ?? "";
  const matches = useMemo(
    () =>
      searchQuery
        ? lines.flatMap((line, lineIndex) =>
            textMatches(line.text, searchQuery).map((match) => ({ ...match, lineIndex })),
          )
        : [],
    [lines, searchQuery],
  );
  const matchIndex = matches.length ? (search?.index ?? 0) % matches.length : 0;
  const prompts = useMemo(() => promptStarts(lines), [lines]);
  const anchorIndex = useMemo(
    () => (anchor === null ? -1 : resolveAnchorIndex(lines, anchor, width)),
    [lines, anchor, width],
  );
  const start =
    search && matches.length
      ? Math.min(maxStart, matches[matchIndex]!.lineIndex)
      : anchor === null
        ? maxStart
        : Math.max(0, Math.min(maxStart, anchorIndex));
  useEffect(() => {
    if (
      anchor &&
      !lines.some((line) => line.id === anchor.id) &&
      page?.hasMoreHistory &&
      !page.loading
    )
      client.loadOlder(registry, threadId);
  }, [client, registry, threadId, anchor, lines, page]);
  const anchorFor = useCallback(
    (line: ConversationLine): TranscriptAnchor => ({
      id: line.id,
      line: line.line,
      width,
      of: lineCount(lines, line.id),
    }),
    [lines, width],
  );
  /** Moves the viewport. Reaching the bottom returns to following live output. */
  const scrollTo = (next: number) => {
    const target = Math.max(0, Math.min(maxStart, next));
    const line = lines[target];
    setAnchor(target === maxStart || line === undefined ? null : anchorFor(line));
  };
  /** Moves the viewport and stays put even at the bottom, for reading with a text cursor. */
  const pinTo = (next: number) => {
    const line = lines[Math.max(0, Math.min(maxStart, next))];
    setAnchor(line ? anchorFor(line) : null);
  };
  return {
    lines,
    matches,
    matchIndex,
    prompts,
    promptMessageIds,
    start,
    maxStart,
    /** Lines waiting below the viewport while the reader is scrolled up. */
    linesBelow: anchor === null ? 0 : Math.max(0, lines.length - (start + count)),
    scrollTo,
    pinTo,
  };
}
