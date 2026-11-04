import {
  buildMenuItems,
  getGitActionDisabledReason,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
} from "@t3tools/client-runtime/state/vcs";
import type { GitStackedAction, VcsStatusResult } from "@t3tools/contracts";

export type GitMenuAction =
  | { readonly kind: "stacked"; readonly action: GitStackedAction; readonly commits: boolean }
  | { readonly kind: "view-pr" }
  | { readonly kind: "pull" }
  | { readonly kind: "branches" }
  | { readonly kind: "pull-requests" };

export interface GitMenuRow {
  readonly id: string;
  readonly label: string;
  readonly action: GitMenuAction;
  /** Why the row cannot run now. */
  readonly disabledReason: string | null;
}

/** Everything the git panel offers for this status, disabled rows included so they can explain. */
export function gitMenuRows(status: VcsStatusResult, busy: boolean): readonly GitMenuRow[] {
  const hasOrigin = status.hasPrimaryRemote;
  const items = buildMenuItems(status, busy, hasOrigin);
  const reason = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    return item
      ? getGitActionDisabledReason({
          item,
          gitStatus: status,
          isBusy: busy,
          hasOriginRemote: hasOrigin,
        })
      : null;
  };
  const canPublish = status.hasUpstream || hasOrigin;
  const commitReason = reason("commit");
  const publishReason =
    commitReason ??
    (status.refName === null
      ? "Detached HEAD: checkout a branch first."
      : status.behindCount > 0
        ? "Branch is behind upstream. Pull before pushing."
        : !canPublish
          ? 'Add an "origin" remote before pushing.'
          : null);
  const hasOpenPr = status.pr?.state === "open";
  return [
    {
      id: "commit",
      label: "Commit",
      action: { kind: "stacked", action: "commit", commits: true },
      disabledReason: commitReason,
    },
    {
      id: "commit-push",
      label: "Commit & push",
      action: { kind: "stacked", action: "commit_push", commits: true },
      disabledReason: publishReason,
    },
    ...(hasOpenPr
      ? []
      : [
          {
            id: "commit-push-pr",
            label: "Commit, push & create PR",
            action: { kind: "stacked", action: "commit_push_pr", commits: true } as const,
            disabledReason: publishReason,
          },
        ]),
    {
      id: "push",
      label: "Push",
      action: { kind: "stacked", action: "push", commits: false },
      disabledReason: reason("push"),
    },
    hasOpenPr
      ? {
          id: "pr",
          label: `View PR #${status.pr?.number}`,
          action: { kind: "view-pr" },
          disabledReason: reason("pr"),
        }
      : {
          id: "pr",
          label: "Create PR",
          action: { kind: "stacked", action: "create_pr", commits: false },
          disabledReason: reason("pr"),
        },
    {
      id: "pull",
      label: "Pull",
      action: { kind: "pull" },
      disabledReason: busy
        ? "Git action in progress."
        : !status.hasUpstream
          ? "This branch has no upstream to pull from."
          : null,
    },
    {
      id: "branches",
      label: "Switch branch...",
      action: { kind: "branches" },
      disabledReason: busy ? "Git action in progress." : null,
    },
    {
      id: "pull-requests",
      label: "Pull requests...",
      action: { kind: "pull-requests" },
      disabledReason: null,
    },
  ];
}

/** The same rows before the status is known. None can run yet, and each says why. */
export function gitMenuPlaceholderRows(): readonly GitMenuRow[] {
  const disabledReason = "Reading the Git status...";
  const stacked = (id: string, label: string, action: GitStackedAction, commits: boolean) => ({
    id,
    label,
    action: { kind: "stacked", action, commits } as const,
    disabledReason,
  });
  return [
    stacked("commit", "Commit", "commit", true),
    stacked("commit-push", "Commit & push", "commit_push", true),
    stacked("commit-push-pr", "Commit, push & create PR", "commit_push_pr", true),
    stacked("push", "Push", "push", false),
    stacked("pr", "Create PR", "create_pr", false),
    { id: "pull", label: "Pull", action: { kind: "pull" }, disabledReason },
    { id: "branches", label: "Switch branch...", action: { kind: "branches" }, disabledReason },
    {
      id: "pull-requests",
      label: "Pull requests...",
      action: { kind: "pull-requests" },
      disabledReason: null,
    },
  ];
}

/** The warning to show before this action publishes from the default branch, if it needs one. */
export function defaultBranchWarning(
  status: VcsStatusResult,
  action: GitStackedAction,
  commits: boolean,
) {
  if (
    !requiresDefaultBranchConfirmation(action, status.isDefaultRef) ||
    action === "commit" ||
    status.refName === null
  )
    return null;
  return resolveDefaultBranchActionDialogCopy({
    action,
    branchName: status.refName,
    includesCommit: commits,
  });
}

/** One line for the header: where the checkout is and how it compares to its upstream. */
export function gitStatusSummary(status: VcsStatusResult) {
  const parts = [
    status.refName ?? "Detached HEAD",
    ...(status.aheadCount > 0 ? [`${status.aheadCount} ahead`] : []),
    ...(status.behindCount > 0 ? [`${status.behindCount} behind`] : []),
    status.hasWorkingTreeChanges
      ? `${status.workingTree.files.length} ${status.workingTree.files.length === 1 ? "file" : "files"} changed`
      : "clean",
    ...(status.pr ? [`PR #${status.pr.number} ${status.pr.state}`] : []),
  ];
  return parts.join(" · ");
}
