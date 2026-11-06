import { RegistryContext } from "@effect/atom-react";
import { useRenderer } from "@opentui/react";
import type {
  PullRequestActivity,
  PullRequestChecks,
  PullRequestReviewCommentDraft,
  PullRequestReviewVerdict,
  PullRequestStack,
  PullRequestDetail,
  PullRequestListEntry,
  PullRequestListState,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { TuiClient, TuiPullRequests } from "../connection/clientRuntime.ts";
import {
  pullRequestActions,
  pullRequestRowDetail,
  type PullRequestActionChoice,
} from "../features/git/pullRequestView.ts";
import { ListFilterRow } from "../ui/FormField.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { ListView } from "../ui/ListView.tsx";
import { markdownLines } from "../ui/markdownLines.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { EmptyState, ErrorState } from "../ui/StateMessage.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { useUi } from "../ui/context.tsx";
import { FormInput } from "../ui/FormField.tsx";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { parseDiffRows, type DiffRow } from "../ui/diffRows.ts";
import { DiffText } from "./ThreadDiff.tsx";

const VIEWS = ["summary", "conversation", "code"] as const;
const VERDICT_LABEL: Record<PullRequestReviewVerdict, string> = {
  approve: "Approve",
  "request-changes": "Request changes",
  comment: "Comment",
};

const STATES: readonly PullRequestListState[] = ["open", "closed", "merged", "all"];
const failureText = (failure: unknown, fallback: string) =>
  failure instanceof Error && failure.message ? failure.message : fallback;

type ReviewNote = PullRequestReviewCommentDraft;
/** Unsent line notes by pull request number. */
type ReviewNotes = ReadonlyMap<number, readonly ReviewNote[]>;

/** Unsent notes the panel holds, and how to ask before something else takes the panel away. */
export interface UnsentNotesGuard {
  /** Like "2 notes on #42, #43". */
  readonly summary: string;
  /** Asks to discard the notes, and runs `leave` once the user agrees. */
  readonly confirm: (leave: () => void) => void;
}

/** Pull requests across the environment's projects, with the actions the host allows. */
export function PullRequestsPanel({
  client,
  ...props
}: {
  readonly client: TuiClient;
  readonly source: Parameters<TuiPullRequests["startThread"]>[2];
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
  readonly onOpenThread: (projectId: PullRequestListEntry["projectId"], threadId: ThreadId) => void;
  readonly onUnsentNotes?: (guard: UnsentNotesGuard | null) => void;
}) {
  if (!client.pullRequests) return <NoPullRequests active={props.active} onClose={props.onClose} />;
  return <PullRequests pulls={client.pullRequests} {...props} />;
}

function NoPullRequests({
  active,
  onClose,
}: {
  readonly active: boolean;
  readonly onClose: () => void;
}) {
  useKeyLayer("pullRequests", {
    active,
    modal: true,
    bindings: { "pullRequests.close": onClose },
  });
  return <EmptyState title="Pull requests need a newer T3 Code server." />;
}

function PullRequests({
  pulls,
  source,
  active,
  width,
  height,
  onClose,
  onOpenThread,
  onUnsentNotes,
}: {
  readonly pulls: TuiPullRequests;
  readonly source: Parameters<TuiPullRequests["startThread"]>[2];
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
  readonly onOpenThread: (projectId: PullRequestListEntry["projectId"], threadId: ThreadId) => void;
  readonly onUnsentNotes?: ((guard: UnsentNotesGuard | null) => void) | undefined;
}) {
  const registry = useContext(RegistryContext);
  const [state, setState] = useState<PullRequestListState>("open");
  const [entries, setEntries] = useState<readonly PullRequestListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<PullRequestListEntry | null>(null);
  // Outlives the detail view, which remounts per pull request. Leaving that view for the list
  // settles every note, so these only ever belong to the stack being read.
  const [notes, setNotes] = useState<ReviewNotes>(new Map());
  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    pulls.list(registry, { state }).then(
      (next) => {
        if (!cancelled) setEntries(next);
      },
      (failure: unknown) => {
        if (!cancelled) setError(failureText(failure, "Could not list pull requests."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pulls, registry, state]);
  useEffect(load, [load]);
  const shown = useMemo(() => {
    const needle = filter?.trim().toLocaleLowerCase();
    return needle
      ? (entries ?? []).filter((entry) =>
          `#${entry.number} ${entry.title} ${entry.author?.login ?? ""} ${entry.headBranch}`
            .toLocaleLowerCase()
            .includes(needle),
        )
      : (entries ?? []);
  }, [entries, filter]);
  const index = Math.max(0, Math.min(cursor, shown.length - 1));
  useKeyLayer("pullRequests", {
    active: active && open === null,
    modal: true,
    typing: filter !== null,
    bindings: {
      "pullRequests.close": () => {
        if (filter !== null) setFilter(null);
        else onClose();
      },
      "pullRequests.up": () => setCursor(Math.max(0, index - 1)),
      "pullRequests.down": () => setCursor(Math.min(shown.length - 1, index + 1)),
      "pullRequests.open": {
        enabled: shown[index] !== undefined,
        run: () => setOpen(shown[index] ?? null),
      },
      "pullRequests.state": {
        enabled: filter === null,
        run: () => {
          setState(STATES[(STATES.indexOf(state) + 1) % STATES.length]!);
          setEntries(null);
          setCursor(0);
        },
      },
      "pullRequests.filter": { enabled: filter === null, run: () => setFilter("") },
      "pullRequests.refresh": { enabled: filter === null, run: () => void load() },
    },
  });
  if (open)
    return (
      <PullRequestDetailView
        key={`${open.repository}#${open.number}`}
        pulls={pulls}
        entry={open}
        notes={notes}
        onNotesChange={(number, update) =>
          setNotes((current) => new Map(current).set(number, update(current.get(number) ?? [])))
        }
        onDiscardNotes={() => setNotes(new Map())}
        source={source}
        active={active}
        width={width}
        height={height}
        onBack={() => {
          setOpen(null);
          load();
        }}
        onOpenThread={onOpenThread}
        onUnsentNotes={onUnsentNotes}
        onOpenLayer={(layer) =>
          setOpen(
            entries?.find(
              (item) => item.repository === open.repository && item.number === layer.number,
            ) ?? {
              ...open,
              number: layer.number,
              title: layer.title ?? `Pull request ${layer.number}`,
              headBranch: layer.headBranch,
              state: layer.state,
              isDraft: layer.isDraft ?? false,
              url: open.url.replace(/\/\d+$/u, `/${layer.number}`),
            },
          )
        }
      />
    );
  const rows = Math.max(1, height - 2);
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <ListFilterRow
        id="pull-requests-filter"
        value={filter}
        focused={active}
        onInput={(value) => {
          setFilter(value);
          setCursor(0);
        }}
      >
        <Text height={1} flexShrink={0} tone="muted" wrapMode="none" truncate>
          {`${STATES.map((item) => (item === state ? `[${item}]` : item)).join(" ")}  ${
            entries ? `${shown.length} shown` : ""
          }`}
        </Text>
      </ListFilterRow>
      {error ? (
        <ErrorState title={error} description="Press R to try again." />
      ) : entries === null ? (
        <Text tone="muted"> </Text>
      ) : shown.length === 0 ? (
        <EmptyState title={filter ? "No pull requests match." : `No ${state} pull requests.`} />
      ) : (
        <ListView
          items={shown}
          selected={index}
          height={rows}
          itemKey={(entry) => `${entry.projectId}:${entry.repository}#${entry.number}`}
          onActivate={(entry, rowIndex) => {
            setCursor(rowIndex);
            setOpen(entry);
          }}
          renderItem={(entry, rowIndex) => (
            <SelectionRow
              selected={rowIndex === index}
              active={active}
              label={inlineTerminalText(
                `#${entry.number} ${entry.title}  ${pullRequestRowDetail(entry)}`,
              )}
            />
          )}
        />
      )}
    </Stack>
  );
}

/** The file a diff row belongs to, so its code colors by that file's language. */
function diffPath(rows: ReturnType<typeof parseDiffRows>, index: number) {
  for (let at = index; at >= 0; at -= 1) {
    const raw = rows[at]!.raw;
    if (raw.startsWith("+++ b/")) return raw.slice(6);
    if (raw.startsWith("diff --git ")) return raw.split(" b/").at(-1) ?? "";
  }
  return "";
}

/** Where a note lands on the host, which addresses a line by the side of the diff it is on. */
function reviewPosition(row: DiffRow): PullRequestReviewCommentDraft["position"] {
  if (row.oldLine !== null && row.newLine !== null)
    return { kind: "context", oldLine: row.oldLine, newLine: row.newLine, side: "right" };
  return row.newLine !== null
    ? { kind: "added", newLine: row.newLine }
    : { kind: "deleted", oldLine: row.oldLine! };
}

function PullRequestDetailView({
  pulls,
  entry,
  notes,
  onNotesChange,
  onDiscardNotes,
  source,
  active,
  width,
  height,
  onBack,
  onOpenThread,
  onUnsentNotes,
  onOpenLayer,
}: {
  readonly onOpenLayer: (layer: PullRequestStack["layers"][number]) => void;
  readonly pulls: TuiPullRequests;
  readonly entry: PullRequestListEntry;
  readonly notes: ReviewNotes;
  readonly onNotesChange: (
    number: number,
    update: (current: readonly ReviewNote[]) => readonly ReviewNote[],
  ) => void;
  readonly onDiscardNotes: () => void;
  readonly source: Parameters<TuiPullRequests["startThread"]>[2];
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onBack: () => void;
  readonly onOpenThread: (projectId: PullRequestListEntry["projectId"], threadId: ThreadId) => void;
  readonly onUnsentNotes: ((guard: UnsentNotesGuard | null) => void) | undefined;
}) {
  const registry = useContext(RegistryContext);
  const renderer = useRenderer();
  const { capabilities } = useUi();
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [checks, setChecks] = useState<PullRequestChecks | null>(null);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const [confirming, setConfirming] = useState<PullRequestActionChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<(typeof VIEWS)[number]>("summary");
  const [activity, setActivity] = useState<PullRequestActivity | null>(null);
  const [stack, setStack] = useState<PullRequestStack | null>(null);
  const [codeCursor, setCodeCursor] = useState(0);
  const [lineComment, setLineComment] = useState<string | null>(null);
  // What to do once the user agrees to discard the unsent notes.
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
  const drafts = notes.get(entry.number) ?? [];
  const pendingNotes = [...notes].filter(([, items]) => items.length > 0);
  const pendingCount = pendingNotes.reduce((total, [, items]) => total + items.length, 0);
  const pendingSummary =
    pendingCount > 0
      ? `${pendingCount} ${pendingCount === 1 ? "note" : "notes"} on ${pendingNotes
          .map(([number]) => `#${number}`)
          .join(", ")}`
      : null;
  /** Runs `then` now, or after the user agrees to lose the unsent notes. */
  const unlessNotes = (then: () => void) => {
    if (pendingSummary) setDiscarding(() => then);
    else then();
  };
  useEffect(() => {
    if (!pendingSummary || !onUnsentNotes) return;
    onUnsentNotes({ summary: pendingSummary, confirm: (leave) => setDiscarding(() => leave) });
    return () => onUnsentNotes(null);
  }, [pendingSummary, onUnsentNotes]);
  const [review, setReview] = useState<{
    readonly verdict: PullRequestReviewVerdict;
    readonly body: string;
  } | null>(null);
  const reference = useMemo(
    () => ({
      projectId: entry.projectId,
      host: entry.host,
      repository: entry.repository,
      number: entry.number,
    }),
    [entry],
  );
  const load = useCallback(() => {
    pulls.detail(registry, reference).then(setDetail, (failure: unknown) => {
      setStatus({ text: failureText(failure, "Could not read this pull request."), failed: true });
    });
    pulls.checks(registry, reference).then(setChecks, () => setChecks(null));
    pulls.activity(registry, reference).then(setActivity, () => setActivity(null));
    pulls.stack(registry, reference).then(setStack, () => setStack(null));
  }, [pulls, registry, reference]);
  useEffect(load, [load]);
  const actions = detail ? pullRequestActions(detail) : [];
  const run = async (choice: PullRequestActionChoice) => {
    setConfirming(null);
    setBusy(true);
    setStatus({ text: `${choice.label}...`, failed: false });
    try {
      await pulls.runAction(registry, { ...reference, action: choice.action });
      setStatus({ text: `${choice.label}: done.`, failed: false });
      load();
    } catch (failure) {
      setStatus({ text: failureText(failure, `${choice.label} failed.`), failed: true });
    } finally {
      setBusy(false);
    }
  };
  const take = (action: PullRequestActionChoice["action"]) => {
    const choice = actions.find((item) => item.action === action);
    if (!choice || busy) return;
    if (choice.confirm) setConfirming(choice);
    else void run(choice);
  };
  const can = (action: PullRequestActionChoice["action"]) =>
    !busy && actions.some((item) => item.action === action);
  const startThread = async () => {
    setBusy(true);
    setStatus({ text: "Preparing a worktree...", failed: false });
    try {
      onOpenThread(entry.projectId, await pulls.startThread(registry, entry, source));
    } catch (failure) {
      setBusy(false);
      setStatus({ text: failureText(failure, "Could not start a thread."), failed: true });
    }
  };
  const diff = useAtomValue(pulls.diff(reference));
  const patch = Option.getOrNull(AsyncResult.value(diff));
  const codeRows = useMemo(() => parseDiffRows(patch?.patch ?? ""), [patch?.patch]);
  const lines = useMemo(() => {
    if (!detail) return [];
    if (view === "code") return codeRows.map((row) => row.raw);
    if (view === "conversation") {
      const remarks = (activity?.comments ?? []).map(
        (comment) => `**${comment.author?.login ?? "Someone"}**\n\n${comment.body}`,
      );
      const commits = (activity?.commits ?? []).map(
        (commit) => `- ${commit.oid.slice(0, 7)} ${commit.messageHeadline}`,
      );
      return markdownLines(
        [
          ...(remarks.length ? remarks : ["No comments yet."]),
          ...(commits.length ? ["**Commits**", commits.join("\n")] : []),
          ...(activity?.commentsTruncated ? ["Older comments were not loaded."] : []),
        ].join("\n\n"),
        width,
        true,
        capabilities.unicode,
      ).map((line) => line.text);
    }
    const checkLines = (checks?.checks ?? []).map(
      (check) => `${check.name}: ${check.status.replaceAll("-", " ")}`,
    );
    return markdownLines(
      [
        detail.body || "No description.",
        ...(checkLines.length
          ? ["**Checks**", checkLines.map((line) => `- ${line}`).join("\n")]
          : []),
      ].join("\n\n"),
      width,
      true,
      capabilities.unicode,
    ).map((line) => line.text);
  }, [detail, checks, activity, codeRows, view, width, capabilities.unicode]);
  const rows = Math.max(1, height - 3);
  const start = Math.min(offset, Math.max(0, lines.length - rows));
  const scroll = (next: number) =>
    setOffset(Math.max(0, Math.min(Math.max(0, lines.length - rows), next)));
  const verdicts = detail?.viewerPermissions.verdicts ?? [];
  const submitReview = async () => {
    if (!review) return;
    if (review.verdict !== "approve" && !review.body.trim()) {
      setStatus({ text: `${VERDICT_LABEL[review.verdict]} needs a message.`, failed: true });
      return;
    }
    const submitted = review;
    setReview(null);
    setBusy(true);
    setStatus({ text: "Submitting the review...", failed: false });
    try {
      await pulls.submitReview(registry, {
        ...reference,
        verdict: submitted.verdict,
        body: submitted.body,
        comments: drafts,
      });
      onNotesChange(entry.number, () => []);
      setStatus({ text: "Review submitted.", failed: false });
      load();
    } catch (failure) {
      setReview(submitted);
      setStatus({ text: failureText(failure, "The review was not submitted."), failed: true });
    } finally {
      setBusy(false);
    }
  };
  const codeTarget =
    view === "code" ? codeRows[Math.min(codeCursor, codeRows.length - 1)] : undefined;
  const commentable =
    codeTarget && (codeTarget.newLine !== null || codeTarget.oldLine !== null)
      ? codeTarget
      : undefined;
  const moveCode = (next: number) => {
    const line = Math.max(0, Math.min(codeRows.length - 1, next));
    setCodeCursor(line);
    if (line < start) scroll(line);
    else if (line >= start + rows) scroll(line - rows + 1);
  };
  const layers = stack?.layers ?? [];
  const layerIndex = layers.findIndex((layer) => layer.number === entry.number);
  const previousLayer = layerIndex > 0 ? layers[layerIndex - 1] : undefined;
  const nextLayer = layerIndex >= 0 ? layers[layerIndex + 1] : undefined;
  useKeyLayer("pullRequestLineComment", {
    active: active && lineComment !== null,
    modal: true,
    typing: true,
    bindings: {
      "pullRequestLineComment.save": () => {
        const body = lineComment?.trim();
        if (!body || !commentable) return;
        const path = diffPath(codeRows, Math.min(codeCursor, codeRows.length - 1));
        const note = { path, position: reviewPosition(commentable), body };
        onNotesChange(entry.number, (current) => [...current, note]);
        setLineComment(null);
      },
      "pullRequestLineComment.cancel": () => setLineComment(null),
    },
  });
  useKeyLayer("pullRequestReview", {
    active: active && review !== null,
    modal: true,
    typing: true,
    bindings: {
      "pullRequestReview.submit": () => void submitReview(),
      "pullRequestReview.verdict": () => {
        if (review)
          setReview({
            ...review,
            verdict: verdicts[(verdicts.indexOf(review.verdict) + 1) % verdicts.length]!,
          });
      },
      "pullRequestReview.cancel": () => setReview(null),
    },
  });
  useKeyLayer("pullRequestDetail", {
    active:
      active &&
      confirming === null &&
      discarding === null &&
      review === null &&
      lineComment === null,
    modal: true,
    bindings: {
      "pullRequestDetail.lineComment": {
        enabled: Boolean(commentable) && verdicts.length > 0,
        run: () => setLineComment(""),
      },
      "pullRequestDetail.previousLayer": {
        enabled: previousLayer !== undefined,
        run: () => {
          if (previousLayer) onOpenLayer(previousLayer);
        },
      },
      "pullRequestDetail.nextLayer": {
        enabled: nextLayer !== undefined,
        run: () => {
          if (nextLayer) onOpenLayer(nextLayer);
        },
      },
      "pullRequestDetail.view": () => {
        setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]!);
        setOffset(0);
      },
      "pullRequestDetail.review": {
        enabled: !busy && verdicts.length > 0 && detail?.state === "open",
        run: () => setReview({ verdict: verdicts[0]!, body: "" }),
      },
      "pullRequestDetail.back": {
        enabled: !busy,
        run: () =>
          unlessNotes(() => {
            onDiscardNotes();
            onBack();
          }),
      },
      "pullRequestDetail.up": () => {
        if (view === "code") moveCode(codeCursor - 1);
        else scroll(start - 1);
      },
      "pullRequestDetail.down": () => {
        if (view === "code") moveCode(codeCursor + 1);
        else scroll(start + 1);
      },
      "pullRequestDetail.merge": { enabled: can("merge"), run: () => take("merge") },
      "pullRequestDetail.ready": {
        enabled: can("ready") || can("draft"),
        label: can("ready") ? "Mark ready" : "Mark draft",
        run: () => take(can("ready") ? "ready" : "draft"),
      },
      "pullRequestDetail.close": {
        enabled: can("close") || can("reopen"),
        label: can("reopen") ? "Reopen" : "Close",
        run: () => take(can("reopen") ? "reopen" : "close"),
      },
      "pullRequestDetail.update": {
        enabled: can("update-branch"),
        run: () => take("update-branch"),
      },
      // The new thread replaces this panel, so the notes go with it.
      "pullRequestDetail.thread": {
        enabled: !busy,
        run: () => unlessNotes(() => void startThread()),
      },
      "pullRequestDetail.copy": () => {
        const copied = renderer.copyToClipboardOSC52(entry.url);
        setStatus(
          copied
            ? { text: "PR URL copied.", failed: false }
            : { text: `Copy unavailable: ${entry.url}`, failed: true },
        );
      },
    },
  });
  useKeyLayer("pullRequestConfirm", {
    active: active && (confirming !== null || discarding !== null),
    modal: true,
    bindings: {
      "pullRequestConfirm.yes": () => {
        if (discarding) {
          setDiscarding(null);
          discarding();
        } else if (confirming) void run(confirming);
      },
      "pullRequestConfirm.no": () => {
        setConfirming(null);
        setDiscarding(null);
      },
    },
  });
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <Text height={1} flexShrink={0} wrapMode="none" truncate strong>
        {inlineTerminalText(`#${entry.number} ${detail?.title ?? entry.title}`)}
      </Text>
      <Text
        height={1}
        flexShrink={0}
        wrapMode="none"
        truncate
        tone={review && status?.failed ? "danger" : "muted"}
      >
        {/* The review input takes the status row, so its problems show up here instead. */}
        {review && status?.failed
          ? inlineTerminalText(status.text)
          : inlineTerminalText(
              `${entry.headBranch} into ${entry.baseBranch} · ${detail?.state ?? entry.state}${
                detail?.isDraft ? " draft" : ""
              } · ${detail?.mergeability ?? entry.mergeability} · +${detail?.additions ?? entry.additions} -${
                detail?.deletions ?? entry.deletions
              }`,
            )}
      </Text>
      {view === "code" ? (
        <Stack height={rows} flexShrink={0} flexDirection="column" overflow="hidden">
          {diff.waiting && !patch ? (
            <Text tone="muted">Loading the changes...</Text>
          ) : AsyncResult.isFailure(diff) ? (
            <Text tone="danger">Could not load the changes. Esc and open it again to retry.</Text>
          ) : (
            codeRows.slice(start, start + rows).map((row, index) => (
              <Stack key={start + index} height={1} flexShrink={0} flexDirection="row">
                <Text height={1} width={1} flexShrink={0} tone="accent" wrapMode="none">
                  {start + index === Math.min(codeCursor, codeRows.length - 1)
                    ? capabilities.unicode
                      ? "▌"
                      : ">"
                    : " "}
                </Text>
                <DiffText
                  row={row}
                  path={diffPath(codeRows, start + index)}
                  width={Math.max(1, width - 1)}
                />
              </Stack>
            ))
          )}
        </Stack>
      ) : (
        <Text height={rows} flexShrink={0} wrapMode="none">
          {lines.slice(start, start + rows).join("\n")}
        </Text>
      )}
      {lineComment !== null ? (
        <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
          <Text height={1} flexShrink={0} tone="accent" wrapMode="none">
            Note
          </Text>
          <FormInput
            id="pull-request-line-comment"
            value={lineComment}
            placeholder="Comment on this line"
            focused={active}
            onInput={setLineComment}
          />
        </Stack>
      ) : review ? (
        <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
          <Text height={1} flexShrink={0} tone="accent" wrapMode="none">
            {VERDICT_LABEL[review.verdict]}
          </Text>
          <FormInput
            id="pull-request-review"
            value={review.body}
            placeholder={review.verdict === "approve" ? "Message (optional)" : "Message"}
            focused={active}
            onInput={(body) => {
              setStatus(null);
              setReview({ ...review, body });
            }}
          />
        </Stack>
      ) : (
        <Text
          height={1}
          flexShrink={0}
          wrapMode="none"
          truncate
          tone={confirming || discarding ? "warning" : status?.failed ? "danger" : "muted"}
        >
          {discarding
            ? `Discard ${pendingSummary}? Enter discards, Esc keeps.`
            : confirming
              ? `${confirming.confirm} Enter confirms, Esc cancels.`
              : inlineTerminalText(
                  status?.text ??
                    `${VIEWS.map((item) => (item === view ? `[${item}]` : item)).join(" ")}${
                      view === "code" && patch?.nextCursor ? " · Showing the first part" : ""
                    }${
                      drafts.length > 0
                        ? ` · ${drafts.length} ${drafts.length === 1 ? "note" : "notes"} for your review`
                        : ""
                    }${
                      layers.length > 1 && layerIndex >= 0
                        ? ` · Stack ${layerIndex + 1} of ${layers.length}`
                        : ""
                    }`,
                )}
        </Text>
      )}
    </Stack>
  );
}
