import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext, useMemo, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { useKeyLayer } from "../ui/keymap.ts";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateMessage.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText, wrapTerminalLines } from "../ui/textLayout.ts";
import { Button } from "../ui/Button.tsx";
import { ListFilterRow } from "../ui/FormField.tsx";
import { ListView } from "../ui/ListView.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { useThemeColor, useUi } from "../ui/context.tsx";
import { diffFiles, diffFileTree } from "../ui/diffFiles.ts";
import { parseDiffRows, splitDiffRows, type DiffRow } from "../ui/diffRows.ts";
import { diffSyntaxTokens, type DiffTokenKind } from "../ui/diffSyntax.ts";
import { FormInput } from "../ui/FormField.tsx";
import type { ThemeToken } from "../ui/theme.ts";

type Scope = "saved" | "working" | "branch" | number;
const EMPTY_DIFF = Atom.make({ diff: "", loading: false, failed: false, truncated: false });
/** Below this a side-by-side pane is too narrow to read code in. */
const SPLIT_MIN_WIDTH = 100;

const rowTone = (kind: DiffRow["kind"]): ThemeToken =>
  kind === "hunk" ? "accent" : kind === "add" ? "success" : kind === "del" ? "danger" : "text";

/** One column of diff text: the code in syntax color, with the sign carrying the change. */
export function DiffText({
  row,
  path,
  width,
  text,
}: {
  readonly row: DiffRow;
  readonly path: string;
  readonly width: number;
  /** The part of the row to draw, when a long line wraps. */
  readonly text?: string;
}) {
  const colors: Record<DiffTokenKind, string | undefined> = {
    plain: useThemeColor(rowTone(row.kind)),
    keyword: useThemeColor("syntaxCommand"),
    string: useThemeColor("syntaxString"),
    comment: useThemeColor("muted"),
    number: useThemeColor("syntaxNumber"),
  };
  const signColor = useThemeColor(rowTone(row.kind));
  const isCode = row.kind === "add" || row.kind === "del" || row.kind === "context";
  const shown = text ?? row.raw;
  const sign = isCode ? shown.slice(0, 1) : "";
  const tokens = isCode
    ? diffSyntaxTokens(shown.slice(1), path)
    : [{ text: shown, kind: "plain" as const }];
  return (
    <Text height={1} width={width} flexShrink={0} tone={rowTone(row.kind)} wrapMode="none">
      {sign ? <span {...(signColor ? { fg: signColor } : {})}>{sign}</span> : null}
      {tokens.map((token, index) => {
        const color = colors[token.kind];
        return (
          <span key={index} {...(color ? { fg: color } : {})}>
            {token.text}
          </span>
        );
      })}
    </Text>
  );
}

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
  /** `commented` means the message gained line comments, so the composer should take focus. */
  readonly onClose: (commented?: boolean) => void;
}) {
  const registry = useContext(RegistryContext);
  const { capabilities } = useUi();
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
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [baseRef, setBaseRef] = useState<string | null>(null);
  const [baseInput, setBaseInput] = useState<string | null>(null);
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
    if (selectedScope === "branch") {
      if (!cwd) return null;
      const atom = client.review.diffPreview({
        environmentId,
        input: {
          cwd,
          ...(baseRef ? { baseRef } : {}),
          ...(ignoreWhitespace ? { ignoreWhitespace: true } : {}),
        },
      });
      return {
        refresh: () => registry.refresh(atom),
        state: Atom.make((get) => {
          const result = get(atom);
          const sources =
            Option.getOrNull(AsyncResult.value(result))?.sources.filter(
              (source) => source.kind === "branch-range",
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
    const whitespace = ignoreWhitespace ? { ignoreWhitespace: true } : {};
    const atom =
      selectedScope === "saved"
        ? client.diffs.fullThreadDiff({
            environmentId,
            input: { threadId, toTurnCount: latest, ...whitespace },
          })
        : client.diffs.turnDiff({
            environmentId,
            input: {
              threadId,
              fromTurnCount: selectedScope - 1,
              toTurnCount: selectedScope,
              ...whitespace,
            },
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
  }, [client, registry, cwd, selectedScope, latest, threadId, ignoreWhitespace, baseRef]);
  const result = useAtomValue(query?.state ?? EMPTY_DIFF);
  const [filter, setFilter] = useState<string | null>(null);
  const allFiles = useMemo(() => diffFiles(result.diff), [result.diff]);
  const files = useMemo(() => {
    const needle = filter?.trim().toLocaleLowerCase();
    return needle
      ? allFiles.filter((entry) => entry.path.toLocaleLowerCase().includes(needle))
      : allFiles;
  }, [allFiles, filter]);
  const selected = Math.max(0, Math.min(cursor, files.length - 1));
  const file = files[selected];
  const tree = useMemo(() => diffFileTree(files), [files]);
  const selectedRow = Math.max(
    0,
    tree.findIndex((row) => row.kind === "file" && row.fileIndex === selected),
  );
  const split = width >= 76;
  const [sideBySide, setSideBySide] = useState<boolean | null>(null);
  const [lineCursor, setLineCursor] = useState(0);
  const [comment, setComment] = useState<string | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const listWidth = split ? Math.min(48, Math.floor(width / 3)) : width;
  const count = Math.max(1, height - 2);
  const diffWidth = Math.max(1, split ? width - listWidth - 1 : width);
  const canSplit = diffWidth >= SPLIT_MIN_WIDTH;
  // Wide enough for two readable columns means side by side, until the reader chooses otherwise.
  const showSplit = canSplit && (sideBySide ?? diffWidth >= SPLIT_MIN_WIDTH + 20);
  const textWidth = Math.max(1, diffWidth - 1);
  const columnWidth = Math.max(1, Math.floor((textWidth - 1) / 2));
  const parsed = useMemo(() => parseDiffRows(file?.text ?? ""), [file?.text]);
  const lines = useMemo(
    () =>
      showSplit
        ? splitDiffRows(parsed).map((pair, index) => ({
            id: `${index}`,
            row: pair.right ?? pair.left!,
            pair,
            part: undefined,
          }))
        : parsed.flatMap((row, index) =>
            wrapTerminalLines(row.raw, textWidth).map((part, partIndex) => ({
              id: `${index}:${partIndex}`,
              row,
              pair: null,
              part,
            })),
          ),
    [parsed, showSplit, textWidth],
  );
  const maximum = Math.max(0, lines.length - count);
  const start = Math.min(offset, maximum);
  const scroll = (position: number) => setOffset(Math.max(0, Math.min(maximum, position)));
  const line = Math.max(0, Math.min(lineCursor, lines.length - 1));
  const moveLine = (position: number) => {
    const next = Math.max(0, Math.min(lines.length - 1, position));
    setLineCursor(next);
    // The view follows the cursor, so scrolling by key and moving the cursor are one motion.
    if (next < start) scroll(next);
    else if (next >= start + count) scroll(next - count + 1);
  };
  const target = lines[line]?.row;
  const targetLine = target?.newLine ?? target?.oldLine ?? null;
  const saveComment = () => {
    const text = comment?.trim();
    if (!text || !file || targetLine === null) return;
    const draft = registry.get(client.actions.state(threadId)).draft;
    const entry = `${file.path}:${targetLine}: ${text}`;
    client.actions.setDraft(registry, threadId, draft ? `${draft}\n${entry}` : entry);
    setCommentCount((value) => value + 1);
    setComment(null);
  };
  const selectFile = (index: number) => {
    setCursor(Math.max(0, Math.min(files.length - 1, index)));
    setOffset(0);
    setLineCursor(0);
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
    else moveLine(lineIndex);
  };
  const closeFilter = () => {
    setFilter(null);
    setCursor(0);
    setOffset(0);
  };
  useKeyLayer("diffBase", {
    active: active && baseInput !== null,
    modal: true,
    typing: true,
    bindings: {
      "diffBase.apply": () => {
        setBaseRef(baseInput?.trim() || null);
        setBaseInput(null);
        changeScope("branch");
      },
      "diffBase.cancel": () => setBaseInput(null),
    },
  });
  useKeyLayer("diffComment", {
    active: active && comment !== null,
    modal: true,
    typing: true,
    bindings: {
      "diffComment.save": { enabled: Boolean(comment?.trim()), run: saveComment },
      "diffComment.cancel": () => setComment(null),
    },
  });
  useKeyLayer("diff", {
    active: active && comment === null && baseInput === null,
    modal: true,
    typing: filter !== null,
    bindings: {
      "diff.close": () => {
        if (filter !== null) closeFilter();
        else onClose(commentCount > 0);
      },
      "diff.branch": {
        enabled: filter === null,
        run: () => setBaseInput(baseRef ?? ""),
      },
      "diff.ignoreWhitespace": {
        enabled: filter === null && selectedScope !== "working",
        label: ignoreWhitespace ? "Show whitespace" : "Hide whitespace",
        run: () => {
          setIgnoreWhitespace((value) => !value);
          setOffset(0);
          setLineCursor(0);
        },
      },
      "diff.layout": {
        enabled: filter === null && canSplit,
        run: () => setSideBySide(!showSplit),
      },
      "diff.comment": {
        enabled: filter === null && focus === "diff" && targetLine !== null,
        run: () => setComment(""),
      },
      "diff.filter": { enabled: filter === null, run: () => setFilter("") },
      "diff.saved": { enabled: filter === null, run: () => changeScope("saved") },
      "diff.working": { enabled: filter === null, run: () => changeScope("working") },
      "diff.previousScope": { enabled: filter === null, run: () => cycleScope(-1) },
      "diff.nextScope": { enabled: filter === null, run: () => cycleScope(1) },
      "diff.refresh": {
        enabled: filter === null,
        run: () => {
          query?.refresh();
        },
      },
      "diff.switchPane": () => setFocus((value) => (value === "files" ? "diff" : "files")),
      "diff.openFile": () => setFocus("diff"),
      "diff.files": () => setFocus("files"),
      "diff.up": () => move(selected - 1, line - 1),
      "diff.down": () => move(selected + 1, line + 1),
      "diff.pageUp": () => move(selected - count, line - count),
      "diff.pageDown": () => move(selected + count, line + count),
      "diff.top": () => move(0, 0),
      "diff.bottom": () => move(files.length - 1, lines.length - 1),
    },
  });
  const scopeButton = (id: string, label: string, chosen: boolean, action: () => void) => (
    <Button
      id={`diff-scope-${id}`}
      label={label}
      tone="accent"
      selected={chosen}
      disabled={!active}
      onPress={action}
    />
  );
  const message = !thread
    ? Option.isSome(state.error)
      ? "Could not load thread."
      : "Loading thread..."
    : !query
      ? selectedScope === "working" || selectedScope === "branch"
        ? "Workspace unavailable."
        : "No saved changes yet. Select W for working tree changes."
      : result.failed
        ? "Could not load changes. Press R to retry."
        : result.loading
          ? "Loading changes..."
          : files.length === 0
            ? filter
              ? "No files match. Esc clears the filter."
              : "No changes in this view."
            : null;
  return (
    <Stack width="100%" height="100%" flexDirection="column">
      <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
        {scopeButton("saved", "[S Saved]", selectedScope === "saved", () => changeScope("saved"))}
        {scopeButton("working", "[W Working]", selectedScope === "working", () =>
          changeScope("working"),
        )}
        {scopeButton("previous", "[ Prev", false, () => cycleScope(-1))}
        {scopeButton("next", "Next ]", false, () => cycleScope(1))}
      </Stack>
      {baseInput !== null ? (
        <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
          <Text height={1} flexShrink={0} tone="muted" wrapMode="none">
            Compare with
          </Text>
          <FormInput
            id="diff-base"
            value={baseInput}
            placeholder="The default branch"
            focused={active}
            onInput={setBaseInput}
          />
        </Stack>
      ) : comment !== null ? (
        <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
          <Text height={1} flexShrink={0} tone="muted" wrapMode="none">
            {`${file?.path ?? ""}:${targetLine ?? ""}`.slice(-Math.floor(width / 3))}
          </Text>
          <FormInput
            id="diff-comment"
            value={comment}
            placeholder="Comment on this line"
            focused={active}
            onInput={setComment}
          />
        </Stack>
      ) : (
        <ListFilterRow
          id="diff-filter"
          value={filter}
          focused={active}
          onInput={(value) => {
            setFilter(value);
            setCursor(0);
            setOffset(0);
          }}
        >
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
                : selectedScope === "branch"
                  ? `Branch against ${baseRef ?? "the default branch"}`
                  : `Turn ${selectedScope} changes`}
            {` · ${files.length} files${result.truncated ? " · Preview truncated" : ""}`}
            {ignoreWhitespace && selectedScope !== "working" ? " · Whitespace hidden" : ""}
            {commentCount > 0
              ? ` · ${commentCount} ${commentCount === 1 ? "comment" : "comments"} in your message`
              : ""}
          </Text>
        </ListFilterRow>
      )}
      {message ? (
        <Stack flexGrow={1}>
          {result.failed ? (
            <ErrorState title={message} />
          ) : result.loading ? (
            <LoadingState title={message} />
          ) : (
            <EmptyState title={message} />
          )}
        </Stack>
      ) : (
        <Stack height={count} flexShrink={0} flexDirection="row" gap={split ? 1 : 0}>
          {split || focus === "files" ? (
            <Stack width={listWidth} height="100%" flexDirection="column" overflow="hidden">
              <ListView
                items={tree}
                selected={selectedRow}
                height={count}
                itemKey={(row) => row.id}
                itemId={(row) => (row.kind === "file" ? `diff-file-${row.fileIndex}` : row.id)}
                onActivate={(row) => {
                  if (!active || row.kind !== "file") return;
                  selectFile(row.fileIndex);
                  setFocus("diff");
                }}
                renderItem={(row, index) =>
                  row.kind === "directory" ? (
                    <Text height={1} tone="muted" wrapMode="none" truncate>
                      {`  ${"  ".repeat(row.depth)}${inlineTerminalText(row.label)}`}
                    </Text>
                  ) : (
                    <SelectionRow
                      selected={index === selectedRow}
                      active={focus === "files"}
                      label={inlineTerminalText(`${"  ".repeat(row.depth)}${row.label}`)}
                    />
                  )
                }
              />
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
              {lines.slice(start, start + count).map((entry, index) => {
                const atCursor = focus === "diff" && start + index === line;
                return (
                  <Stack key={entry.id} height={1} flexShrink={0} flexDirection="row">
                    <Text height={1} width={1} flexShrink={0} tone="accent" wrapMode="none">
                      {atCursor ? (capabilities.unicode ? "▌" : ">") : " "}
                    </Text>
                    {entry.pair ? (
                      <Stack height={1} flexDirection="row" gap={1}>
                        {entry.pair.left ? (
                          <DiffText
                            row={entry.pair.left}
                            path={file?.path ?? ""}
                            width={columnWidth}
                          />
                        ) : (
                          <Text height={1} width={columnWidth} flexShrink={0}>
                            {" "}
                          </Text>
                        )}
                        {entry.pair.right ? (
                          <DiffText
                            row={entry.pair.right}
                            path={file?.path ?? ""}
                            width={columnWidth}
                          />
                        ) : null}
                      </Stack>
                    ) : (
                      <DiffText
                        row={entry.row}
                        path={file?.path ?? ""}
                        width={textWidth}
                        {...(entry.part === undefined ? {} : { text: entry.part })}
                      />
                    )}
                  </Stack>
                );
              })}
            </Stack>
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}
