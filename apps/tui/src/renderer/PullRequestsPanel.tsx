import { RegistryContext } from "@effect/atom-react";
import { useRenderer } from "@opentui/react";
import type {
  PullRequestChecks,
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

const STATES: readonly PullRequestListState[] = ["open", "closed", "merged", "all"];
const failureText = (failure: unknown, fallback: string) =>
  failure instanceof Error && failure.message ? failure.message : fallback;

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
}: {
  readonly pulls: TuiPullRequests;
  readonly source: Parameters<TuiPullRequests["startThread"]>[2];
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
  readonly onOpenThread: (projectId: PullRequestListEntry["projectId"], threadId: ThreadId) => void;
}) {
  const registry = useContext(RegistryContext);
  const [state, setState] = useState<PullRequestListState>("open");
  const [entries, setEntries] = useState<readonly PullRequestListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<PullRequestListEntry | null>(null);
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
        pulls={pulls}
        entry={open}
        source={source}
        active={active}
        width={width}
        height={height}
        onBack={() => {
          setOpen(null);
          load();
        }}
        onOpenThread={onOpenThread}
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

function PullRequestDetailView({
  pulls,
  entry,
  source,
  active,
  width,
  height,
  onBack,
  onOpenThread,
}: {
  readonly pulls: TuiPullRequests;
  readonly entry: PullRequestListEntry;
  readonly source: Parameters<TuiPullRequests["startThread"]>[2];
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onBack: () => void;
  readonly onOpenThread: (projectId: PullRequestListEntry["projectId"], threadId: ThreadId) => void;
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
  const lines = useMemo(() => {
    if (!detail) return [];
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
  }, [detail, checks, width, capabilities.unicode]);
  const rows = Math.max(1, height - 3);
  const start = Math.min(offset, Math.max(0, lines.length - rows));
  const scroll = (next: number) =>
    setOffset(Math.max(0, Math.min(Math.max(0, lines.length - rows), next)));
  useKeyLayer("pullRequestDetail", {
    active: active && confirming === null,
    modal: true,
    bindings: {
      "pullRequestDetail.back": { enabled: !busy, run: onBack },
      "pullRequestDetail.up": () => scroll(start - 1),
      "pullRequestDetail.down": () => scroll(start + 1),
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
      "pullRequestDetail.thread": { enabled: !busy, run: startThread },
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
    active: active && confirming !== null,
    modal: true,
    bindings: {
      "pullRequestConfirm.yes": () => {
        if (confirming) void run(confirming);
      },
      "pullRequestConfirm.no": () => setConfirming(null),
    },
  });
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <Text height={1} flexShrink={0} wrapMode="none" truncate strong>
        {inlineTerminalText(`#${entry.number} ${detail?.title ?? entry.title}`)}
      </Text>
      <Text height={1} flexShrink={0} wrapMode="none" truncate tone="muted">
        {inlineTerminalText(
          `${entry.headBranch} into ${entry.baseBranch} · ${detail?.state ?? entry.state}${
            detail?.isDraft ? " draft" : ""
          } · ${detail?.mergeability ?? entry.mergeability} · +${detail?.additions ?? entry.additions} -${
            detail?.deletions ?? entry.deletions
          }`,
        )}
      </Text>
      <Text height={rows} flexShrink={0} wrapMode="none">
        {lines.slice(start, start + rows).join("\n")}
      </Text>
      <Text
        height={1}
        flexShrink={0}
        wrapMode="none"
        truncate
        tone={confirming ? "warning" : status?.failed ? "danger" : "muted"}
      >
        {confirming
          ? `${confirming.confirm} Enter confirms, Esc cancels.`
          : inlineTerminalText(status?.text ?? "")}
      </Text>
    </Stack>
  );
}
