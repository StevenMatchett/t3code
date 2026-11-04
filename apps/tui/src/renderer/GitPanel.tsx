import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useRenderer } from "@opentui/react";
import type { GitStackedAction, ProjectId, ThreadId, VcsStatusResult } from "@t3tools/contracts";
import { useCallback, useContext, useEffect, useState } from "react";
import type { TuiClient, TuiGit } from "../connection/clientRuntime.ts";
import { defaultBranchWarning, gitMenuRows, gitStatusSummary } from "../features/git/gitMenu.ts";
import { FormInput } from "../ui/FormField.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { ListView } from "../ui/ListView.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateMessage.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

type Step =
  | { readonly type: "menu" }
  | { readonly type: "message"; readonly action: GitStackedAction; readonly message: string }
  | {
      readonly type: "default-branch";
      readonly action: GitStackedAction;
      readonly commitMessage: string;
      readonly commits: boolean;
      readonly cursor: number;
    };

const errorMessage = (failure: unknown, fallback: string) =>
  failure instanceof Error && failure.message ? failure.message : fallback;

/** Commits, pushes, opens pull requests, and pulls for one checkout, with live progress. */
export function GitPanel({
  client,
  ...props
}: {
  readonly client: TuiClient;
  readonly cwd: string;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
  readonly onViewPullRequest: () => void;
  readonly onBranches: () => void;
}) {
  if (!client.git) return <NeedsNewerServer active={props.active} onClose={props.onClose} />;
  return <GitActions git={client.git} {...props} />;
}

function NeedsNewerServer({
  active,
  onClose,
}: {
  readonly active: boolean;
  readonly onClose: () => void;
}) {
  useKeyLayer("git", { active, modal: true, bindings: { "git.close": onClose } });
  return <EmptyState title="Git actions need a newer T3 Code server." />;
}

function GitActions({
  git,
  cwd,
  threadId,
  projectId,
  active,
  width,
  height,
  onClose,
  onViewPullRequest,
  onBranches,
}: {
  readonly git: TuiGit;
  readonly cwd: string;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
  readonly onViewPullRequest: () => void;
  readonly onBranches: () => void;
}) {
  const registry = useContext(RegistryContext);
  const renderer = useRenderer();
  const progress = useAtomValue(git.actionState(cwd));
  const [status, setStatus] = useState<VcsStatusResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [step, setStep] = useState<Step>({ type: "menu" });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null);
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
  const reload = useCallback(() => {
    setLoadError(null);
    git.status(registry, cwd).then(setStatus, (failure: unknown) => {
      setLoadError(errorMessage(failure, "Could not read the Git status."));
    });
  }, [git, registry, cwd]);
  useEffect(reload, [reload, active]);
  const busy = running || progress.isRunning;
  const rows = status ? gitMenuRows(status, busy) : [];
  const index = Math.min(cursor, Math.max(0, rows.length - 1));
  const selected = rows[index];
  const run = async (action: GitStackedAction, commitMessage: string, featureBranch: boolean) => {
    setStep({ type: "menu" });
    setRunning(true);
    setResult(null);
    setPullRequestUrl(null);
    try {
      const outcome = await git.run(
        registry,
        { cwd, threadId, projectId },
        {
          action,
          ...(commitMessage ? { commitMessage } : {}),
          ...(featureBranch ? { featureBranch } : {}),
        },
      );
      setPullRequestUrl(outcome.pr.url ?? null);
      setResult({
        text: outcome.toast.description
          ? `${outcome.toast.title} ${outcome.toast.description}`
          : outcome.toast.title,
        failed: false,
      });
    } catch (failure) {
      setResult({ text: errorMessage(failure, "The Git action failed."), failed: true });
    } finally {
      setRunning(false);
      reload();
    }
  };
  const proceed = (action: GitStackedAction, commits: boolean, commitMessage: string) => {
    if (status && defaultBranchWarning(status, action, commits)) {
      setStep({ type: "default-branch", action, commitMessage, commits, cursor: 0 });
      return;
    }
    void run(action, commitMessage, false);
  };
  const pull = async () => {
    setRunning(true);
    setResult(null);
    try {
      const outcome = await git.pull(registry, cwd);
      setResult({
        text:
          outcome.status === "skipped_up_to_date"
            ? "Already up to date."
            : `Pulled into ${outcome.refName ?? "this branch"}.`,
        failed: false,
      });
    } catch (failure) {
      setResult({ text: errorMessage(failure, "Could not pull."), failed: true });
    } finally {
      setRunning(false);
      reload();
    }
  };
  const choose = () => {
    if (!selected) return;
    if (selected.disabledReason) {
      setResult({ text: selected.disabledReason, failed: true });
      return;
    }
    const { action } = selected;
    if (action.kind === "view-pr") onViewPullRequest();
    else if (action.kind === "branches") onBranches();
    else if (action.kind === "pull") void pull();
    else if (action.commits) setStep({ type: "message", action: action.action, message: "" });
    else proceed(action.action, false, "");
  };
  const warning =
    step.type === "default-branch" && status
      ? defaultBranchWarning(status, step.action, step.commits)
      : null;
  const choices = warning
    ? [
        { id: "cancel", label: "Cancel" },
        { id: "feature", label: "Create a feature branch" },
        { id: "continue", label: warning.continueLabel },
      ]
    : [];
  useKeyLayer("git", {
    active: active && step.type !== "message",
    modal: true,
    bindings: {
      "git.close": () => {
        if (step.type === "default-branch") setStep({ type: "menu" });
        else if (!busy) onClose();
      },
      "git.up": () => {
        if (step.type === "default-branch")
          setStep({ ...step, cursor: Math.max(0, step.cursor - 1) });
        else setCursor(Math.max(0, index - 1));
      },
      "git.down": () => {
        if (step.type === "default-branch")
          setStep({ ...step, cursor: Math.min(choices.length - 1, step.cursor + 1) });
        else setCursor(Math.min(rows.length - 1, index + 1));
      },
      "git.choose": {
        enabled: !busy && (step.type === "default-branch" || selected !== undefined),
        run: () => {
          if (step.type !== "default-branch") {
            choose();
            return;
          }
          const choice = choices[step.cursor]?.id;
          if (choice === "cancel") setStep({ type: "menu" });
          else void run(step.action, step.commitMessage, choice === "feature");
        },
      },
      "git.refresh": { enabled: !busy, run: reload },
      "git.copyUrl": {
        enabled: pullRequestUrl !== null,
        run: () => {
          if (!pullRequestUrl) return;
          const copied = renderer.copyToClipboardOSC52(pullRequestUrl);
          setResult({
            text: copied ? "PR URL copied." : `Copy unavailable: ${pullRequestUrl}`,
            failed: !copied,
          });
        },
      },
    },
  });
  useKeyLayer("gitCommit", {
    active: active && step.type === "message",
    modal: true,
    typing: true,
    bindings: {
      "gitCommit.confirm": () => {
        if (step.type === "message") proceed(step.action, true, step.message.trim());
      },
      "gitCommit.cancel": () => setStep({ type: "menu" }),
    },
  });
  if (loadError && !status)
    return <ErrorState title={loadError} description="Press R to try again." />;
  if (!status) return <LoadingState title="Reading the Git status..." />;
  if (!status.isRepo) return <EmptyState title="This folder is not a Git repository." />;
  const progressLine = [progress.currentLabel, progress.hookName, progress.lastOutputLine]
    .filter(Boolean)
    .join(" · ");
  const footer = busy
    ? { text: progressLine || "Working...", failed: false }
    : (result ?? { text: selected?.disabledReason ?? "", failed: false });
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <Text height={1} flexShrink={0} wrapMode="none" truncate strong>
        {inlineTerminalText(gitStatusSummary(status))}
      </Text>
      <Text height={1} flexShrink={0}>
        {" "}
      </Text>
      {step.type === "message" ? (
        <Stack flexDirection="column" flexGrow={1}>
          <Text height={1} flexShrink={0} tone="muted">
            Commit message, or leave empty to have one written.
          </Text>
          <FormInput
            id="git-commit-message"
            width={width}
            value={step.message}
            placeholder="Commit message"
            focused={active}
            onInput={(message) => setStep({ ...step, message })}
          />
        </Stack>
      ) : warning && step.type === "default-branch" ? (
        <Stack flexDirection="column" flexGrow={1}>
          <Text height={1} flexShrink={0} strong>
            {inlineTerminalText(warning.title)}
          </Text>
          <Text flexShrink={0} tone="warning">
            {inlineTerminalText(warning.description)}
          </Text>
          {choices.map((choice, choiceIndex) => (
            <SelectionRow
              key={choice.id}
              label={choice.label}
              selected={choiceIndex === step.cursor}
              active={active}
            />
          ))}
        </Stack>
      ) : (
        <ListView
          items={rows}
          selected={index}
          height={Math.max(1, height - 4)}
          showCounter={false}
          itemKey={(row) => row.id}
          onActivate={(_row, rowIndex) => {
            setCursor(rowIndex);
          }}
          renderItem={(row, rowIndex) => (
            <SelectionRow
              label={row.label}
              selected={rowIndex === index}
              active={active && !row.disabledReason && !busy}
            />
          )}
        />
      )}
      <Text
        height={1}
        flexShrink={0}
        wrapMode="none"
        truncate
        tone={footer.failed ? "danger" : "muted"}
      >
        {inlineTerminalText(footer.text)}
      </Text>
    </Stack>
  );
}
