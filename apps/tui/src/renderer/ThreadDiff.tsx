import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useContext, useMemo, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText, wrapTerminalLines } from "../ui/textLayout.ts";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { diffFiles } from "../ui/diffFiles.ts";
import type { ThemeToken } from "../ui/theme.ts";

type Scope = "saved" | "working" | number;
const EMPTY_DIFF = Atom.make({ diff: "", loading: false, failed: false, truncated: false });

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
  const registry = useContext(RegistryContext);
  const state = useAtomValue(client.thread(threadId));
  const shell = useAtomValue(client.shell);
  const thread = Option.getOrNull(state.data);
  const cwd =
    thread?.worktreePath ??
    Option.getOrNull(shell.snapshot)?.projects.find((project) => project.id === thread?.projectId)
      ?.workspaceRoot ??
    null;
  const turns = useMemo(
    () =>
      [...new Set(thread?.checkpoints.map((checkpoint) => checkpoint.checkpointTurnCount) ?? [])]
        .filter((turn) => turn > 0)
        .sort((a, b) => a - b),
    [thread?.checkpoints],
  );
  const latest = turns.at(-1) ?? 0;
  const [scope, setScope] = useState<Scope>("saved");
  const selectedScope = typeof scope === "number" && !turns.includes(scope) ? "saved" : scope;
  const scopes: Scope[] = ["saved", "working", ...turns];
  const [cursor, setCursor] = useState(0);
  const [offset, setOffset] = useState(0);
  const [focus, setFocus] = useState<"files" | "diff">("files");
  const query = useMemo(() => {
    const environmentId = client.environmentId;
    if (selectedScope === "working") {
      if (!cwd) return null;
      const atom = client.review.diffPreview({ environmentId, input: { cwd } });
      return {
        refresh: () => registry.refresh(atom),
        state: Atom.make((get) => {
          const result = get(atom);
          const sources =
            Option.getOrNull(AsyncResult.value(result))?.sources.filter(
              (source) => source.kind === "working-tree",
            ) ?? [];
          return {
            loading: result.waiting,
            failed: AsyncResult.isFailure(result),
            diff: sources.map((source) => source.diff).join("\n"),
            truncated: sources.some((source) => source.truncated),
          };
        }),
      };
    }
    if (!latest) return null;
    const atom =
      selectedScope === "saved"
        ? client.diffs.fullThreadDiff({ environmentId, input: { threadId, toTurnCount: latest } })
        : client.diffs.turnDiff({
            environmentId,
            input: { threadId, fromTurnCount: selectedScope - 1, toTurnCount: selectedScope },
          });
    return {
      refresh: () => registry.refresh(atom),
      state: Atom.make((get) => {
        const result = get(atom);
        return {
          loading: result.waiting,
          failed: AsyncResult.isFailure(result),
          diff: Option.getOrNull(AsyncResult.value(result))?.diff ?? "",
          truncated: false,
        };
      }),
    };
  }, [client, registry, cwd, selectedScope, latest, threadId]);
  const result = useAtomValue(query?.state ?? EMPTY_DIFF);
  const files = useMemo(() => diffFiles(result.diff), [result.diff]);
  const selected = Math.max(0, Math.min(cursor, files.length - 1));
  const file = files[selected];
  const split = width >= 76;
  const listWidth = split ? Math.min(32, Math.floor(width / 3)) : width;
  const count = Math.max(1, height - 3);
  const diffWidth = Math.max(1, split ? width - listWidth - 1 : width);
  const lines = useMemo(
    () =>
      (file?.text ?? "").split("\n").flatMap((text, index) => {
        const tone: ThemeToken =
          text.startsWith("diff --git") || text.startsWith("@@")
            ? "accent"
            : text.startsWith("+")
              ? "success"
              : text.startsWith("-")
                ? "danger"
                : "text";
        return wrapTerminalLines(text, diffWidth).map((part, partIndex) => ({
          id: `${index}:${partIndex}`,
          text: part,
          tone,
        }));
      }),
    [file?.text, diffWidth],
  );
  const maximum = Math.max(0, lines.length - count);
  const start = Math.min(offset, maximum);
  const scroll = (position: number) => setOffset(Math.max(0, Math.min(maximum, position)));
  const selectFile = (index: number) => {
    setCursor(Math.max(0, Math.min(files.length - 1, index)));
    setOffset(0);
  };
  const changeScope = (next: Scope) => {
    setScope(next);
    setCursor(0);
    setOffset(0);
  };
  const cycleScope = (direction: number) =>
    changeScope(
      scopes[(scopes.indexOf(selectedScope) + direction + scopes.length) % scopes.length]!,
    );
  const move = (fileIndex: number, lineIndex: number) => {
    if (focus === "files") selectFile(fileIndex);
    else scroll(lineIndex);
  };
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") onClose();
    else if (key.name === "s") changeScope("saved");
    else if (key.name === "w") changeScope("working");
    else if (key.name === "[") cycleScope(-1);
    else if (key.name === "]") cycleScope(1);
    else if (key.name === "r") query?.refresh();
    else if (key.name === "tab") setFocus((value) => (value === "files" ? "diff" : "files"));
    else if (key.name === "return" || key.name === "right") setFocus("diff");
    else if (key.name === "left") setFocus("files");
    else if (key.name === "up") move(selected - 1, start - 1);
    else if (key.name === "down") move(selected + 1, start + 1);
    else if (key.name === "pageup") move(selected - count, start - count);
    else if (key.name === "pagedown") move(selected + count, start + count);
    else if (key.name === "home") move(0, 0);
    else if (key.name === "end") move(files.length - 1, maximum);
    else return;
    key.preventDefault();
    key.stopPropagation();
  });
  const scopeButton = (label: string, action: () => void) => (
    <Text
      height={1}
      tone="accent"
      onMouseDown={(event) => {
        if (!active || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        action();
      }}
    >
      {label}
    </Text>
  );
  const listStart = Math.max(0, Math.min(selected - Math.floor(count / 2), files.length - count));
  const message = !thread
    ? Option.isSome(state.error)
      ? "Could not load thread."
      : "Loading thread..."
    : !query
      ? selectedScope === "working"
        ? "Workspace unavailable."
        : "No saved changes yet. Select W for working tree changes."
      : result.failed
        ? "Could not load changes. Press R to retry."
        : result.loading
          ? "Loading changes..."
          : files.length === 0
            ? "No changes in this view."
            : null;
  return (
    <Stack width="100%" height="100%" flexDirection="column">
      <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
        {scopeButton("[S Saved]", () => changeScope("saved"))}
        {scopeButton("[W Working]", () => changeScope("working"))}
        {scopeButton("[ Prev", () => cycleScope(-1))}
        {scopeButton("Next ]", () => cycleScope(1))}
      </Stack>
      <Text
        height={1}
        flexShrink={0}
        tone={result.truncated ? "warning" : "muted"}
        wrapMode="none"
        truncate
      >
        {selectedScope === "saved"
          ? `Saved changes through turn ${latest}`
          : selectedScope === "working"
            ? "Uncommitted workspace changes"
            : `Turn ${selectedScope} changes`}
        {` · ${files.length} files${result.truncated ? " · Preview truncated" : ""}`}
      </Text>
      {message ? (
        <Stack flexGrow={1}>
          <Text tone={result.failed ? "danger" : "muted"}>{message}</Text>
        </Stack>
      ) : (
        <Stack height={count} flexShrink={0} flexDirection="row" gap={split ? 1 : 0}>
          {split || focus === "files" ? (
            <Stack width={listWidth} height="100%" flexDirection="column" overflow="hidden">
              {files.slice(listStart, listStart + count).map((entry, index) => (
                <Stack
                  key={entry.id}
                  id={`diff-file-${listStart + index}`}
                  height={1}
                  flexShrink={0}
                  onMouseDown={(event) => {
                    if (!active || event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    selectFile(listStart + index);
                    setFocus("diff");
                  }}
                >
                  <SelectionRow
                    selected={listStart + index === selected}
                    active={focus === "files"}
                    label={inlineTerminalText(
                      `${entry.path} +${entry.additions} -${entry.deletions}`,
                    )}
                  />
                </Stack>
              ))}
            </Stack>
          ) : null}
          {split || focus === "diff" ? (
            <Stack
              id="diff-content"
              width={diffWidth}
              height="100%"
              flexDirection="column"
              overflow="hidden"
              onMouseDown={() => {
                if (active) setFocus("diff");
              }}
              onMouseScroll={(event) => {
                if (!active) return;
                if (event.scroll?.direction === "up") scroll(start - 3);
                else if (event.scroll?.direction === "down") scroll(start + 3);
                else return;
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {lines.slice(start, start + count).map((line) => (
                <Text key={line.id} height={1} flexShrink={0} tone={line.tone} wrapMode="none">
                  {line.text}
                </Text>
              ))}
            </Stack>
          ) : null}
        </Stack>
      )}
      <Text height={1} flexShrink={0} tone="muted" wrapMode="none" truncate>
        {focus === "files"
          ? "Files: arrows select · Enter opens"
          : "Diff: arrows scroll · Left returns to files"}{" "}
        · Tab switches · Esc closes
      </Text>
    </Stack>
  );
}
