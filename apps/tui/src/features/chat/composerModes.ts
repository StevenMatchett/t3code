import type { RuntimeMode, ServerProvider } from "@t3tools/contracts";

export const permissionChoices = [
  { id: "approval-required", label: "Supervised", detail: "Ask before commands and file changes." },
  {
    id: "auto-accept-edits",
    label: "Auto-accept edits",
    detail: "Auto-approve edits, ask before other actions.",
  },
  {
    id: "auto",
    label: "Auto",
    detail: "Supported providers approve routine actions; others still ask.",
  },
  { id: "full-access", label: "Full access", detail: "Allow commands and edits without prompts." },
] satisfies readonly { id: RuntimeMode; label: string; detail: string }[];

export function planModeProblem(
  provider: Pick<ServerProvider, "showInteractionModeToggle"> | null | undefined,
): string | null {
  if (!provider || provider.showInteractionModeToggle === false)
    return "This provider does not support plan mode.";
  return null;
}
