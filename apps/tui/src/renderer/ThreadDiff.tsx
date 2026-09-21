import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useMemo, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { wrapTerminalLines } from "../ui/textLayout.ts";
import type { ThemeToken } from "../ui/theme.ts";

export function ThreadDiff({
  client,
  threadId,
  active,
  width,
  height,
  onClose,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
}) {
  const state = useAtomValue(client.thread(threadId));
  const thread = Option.getOrNull(state.data);
  const turnCount = Math.max(
    0,
    ...(thread?.checkpoints.map((item) => item.checkpointTurnCount) ?? []),
  );
  if (!thread || turnCount === 0)
    return (
      <EmptyDiff
        active={active}
        onClose={onClose}
        text={
          !thread
            ? "Loading thread..."
            : "No saved changes yet. Diffs are available after a turn is checkpointed."
        }
      />
    );
  return (
    <LoadedDiff
      client={client}
      threadId={threadId}
      turnCount={turnCount}
      active={active}
      width={width}
      height={height}
      onClose={onClose}
    />
  );
}

function EmptyDiff({
  active,
  onClose,
  text,
}: {
  readonly active: boolean;
  readonly onClose: () => void;
  readonly text: string;
}) {
  useKeyboard((key) => {
    if (active && key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onClose();
    }
  });
  return <Text tone="muted">{text}</Text>;
}

function LoadedDiff({
  client,
  threadId,
  turnCount,
  active,
  width,
  height,
  onClose,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly turnCount: number;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
}) {
  const registry = useContext(RegistryContext);
  const atom = useMemo(
    () =>
      client.diffs.fullThreadDiff({
        environmentId: client.environmentId,
        input: { threadId, toTurnCount: turnCount },
      }),
    [client, threadId, turnCount],
  );
  const result = useAtomValue(atom);
  const diff = Option.getOrNull(AsyncResult.value(result))?.diff ?? "";
  const [offset, setOffset] = useState(0);
  const lines = useMemo(
    () =>
      diff
        ? diff.split("\n").flatMap((text) => {
            const tone: ThemeToken =
              text.startsWith("diff --git") || text.startsWith("@@")
                ? "accent"
                : text.startsWith("+")
                  ? "success"
                  : text.startsWith("-")
                    ? "danger"
                    : "text";
            return wrapTerminalLines(text, width).map((line, index) => ({
              text: line,
              id: `${text}:${index}`,
              tone,
              file: index === 0 && text.startsWith("diff --git"),
            }));
          })
        : [],
    [diff, width],
  );
  const count = Math.max(1, height - 2);
  const maximum = Math.max(0, lines.length - count);
  const start = Math.min(offset, maximum);
  const scroll = (position: number) => setOffset(Math.max(0, Math.min(maximum, position)));
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") onClose();
    else if (key.name === "up") scroll(start - 1);
    else if (key.name === "down") scroll(start + 1);
    else if (key.name === "pageup") scroll(start - count);
    else if (key.name === "pagedown") scroll(start + count);
    else if (key.name === "home") scroll(0);
    else if (key.name === "end") scroll(maximum);
    else if (key.name === "r") registry.refresh(atom);
    else if (key.name === "tab") {
      const files = lines.flatMap((line, index) => (line.file ? [index] : []));
      scroll(
        key.shift
          ? (files.findLast((index) => index < start) ?? 0)
          : (files.find((index) => index > start) ?? 0),
      );
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack
      width="100%"
      height="100%"
      flexDirection="column"
      onMouseScroll={(event) => {
        if (!active) return;
        if (event.scroll?.direction === "up") scroll(start - 3);
        else if (event.scroll?.direction === "down") scroll(start + 3);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Text height={1} tone="muted">
        Saved changes through turn {turnCount} · {lines.filter((line) => line.file).length} files
      </Text>
      <Stack flexGrow={1} overflow="hidden" flexDirection="column">
        {AsyncResult.isFailure(result) ? (
          <Text tone="danger">Could not load changes. Press R to retry.</Text>
        ) : result.waiting ? (
          <Text tone="muted">Loading changes...</Text>
        ) : lines.length === 0 ? (
          <Text tone="muted">No changes in this thread.</Text>
        ) : (
          lines.slice(start, start + count).map((line, index) => (
            <Text
              key={`${line.id}:${start + index}`}
              height={1}
              flexShrink={0}
              tone={line.tone}
              wrapMode="none"
            >
              {line.text}
            </Text>
          ))
        )}
      </Stack>
      <Text height={1} tone="muted">
        {lines.length
          ? `${start + 1}–${Math.min(lines.length, start + count)} of ${lines.length} lines`
          : "Esc closes"}
      </Text>
    </Stack>
  );
}
