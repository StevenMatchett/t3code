import type {
  PullRequestAction,
  PullRequestDetail,
  PullRequestListEntry,
} from "@t3tools/contracts";

const CHECKS = {
  passing: "checks pass",
  failing: "checks fail",
  pending: "checks running",
} as const;
const REVIEW: Record<string, string> = {
  approved: "approved",
  changes_requested: "changes requested",
  review_required: "needs review",
};

/** What a list row says after its number and title. */
export function pullRequestRowDetail(entry: PullRequestListEntry) {
  return [
    entry.isDraft ? "draft" : entry.state === "open" ? null : entry.state,
    entry.author?.login ?? null,
    entry.checksState ? CHECKS[entry.checksState] : null,
    entry.reviewDecision ? (REVIEW[entry.reviewDecision] ?? null) : null,
    entry.mergeability === "conflicting" ? "conflicts" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface PullRequestActionChoice {
  readonly action: PullRequestAction;
  readonly label: string;
  /** Hard to take back, so it asks first. */
  readonly confirm?: string;
}

/** The actions both the host and this viewer can take, given the pull request's state. */
export function pullRequestActions(detail: PullRequestDetail): readonly PullRequestActionChoice[] {
  const allowed = (action: PullRequestAction) =>
    detail.capabilities.actions.includes(action) &&
    detail.viewerPermissions.actions.includes(action);
  const open = detail.state === "open";
  const choices: readonly (PullRequestActionChoice & { readonly when: boolean })[] = [
    {
      action: "merge",
      label: "Merge",
      when: open && !detail.isDraft,
      confirm: `Merge #${detail.number} into ${detail.baseBranch}?`,
    },
    { action: "ready", label: "Mark ready", when: open && detail.isDraft },
    { action: "draft", label: "Mark draft", when: open && !detail.isDraft },
    { action: "update-branch", label: "Update branch", when: open },
    {
      action: "close",
      label: "Close",
      when: open,
      confirm: `Close #${detail.number} without merging?`,
    },
    { action: "reopen", label: "Reopen", when: detail.state === "closed" },
  ];
  return choices
    .filter((choice) => choice.when && allowed(choice.action))
    .map(({ when: _when, ...choice }) => choice);
}
