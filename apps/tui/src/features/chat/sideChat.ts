import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import type { TuiThread } from "../../connection/models.ts";

/** Why this thread cannot start a side chat, in the GUI's words, or null when it can. */
export function sideChatProblem(
  thread: Pick<TuiThread, "lineage"> | null,
  capabilities: ExecutionEnvironmentCapabilities,
) {
  if (!thread) return "Side chats are not ready yet. Try again in a moment.";
  if (thread.lineage?.sideChat === true) return "Side chats cannot start side chats.";
  if (thread.lineage?.relationshipToParent === "subagent")
    return "Subagent threads cannot start side chats.";
  if (capabilities.sideChats !== true)
    return "Update this environment's T3 Code server to use side chats.";
  return null;
}

/** A side chat's row in its parent's list: its title, when it started, and whether it runs. */
export function sideChatLabel(thread: {
  readonly title: string;
  readonly createdAt: string;
  readonly latestTurn?: { readonly state: string } | null | undefined;
}) {
  const started = new Date(thread.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${thread.title} · ${started}${thread.latestTurn?.state === "running" ? " · running" : ""}`;
}
