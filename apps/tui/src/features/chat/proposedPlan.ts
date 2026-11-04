import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Hex from "effect/encoding/Hex";
import type { TuiCommand } from "../../connection/commands.ts";
import type { TuiProposedPlan, TuiThread } from "../../connection/models.ts";

/** The heading the agent gave the plan, if any. */
export function proposedPlanTitle(markdown: string): string | null {
  const heading = markdown.match(/^\s{0,3}#{1,6}\s+(.+)$/mu)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : null;
}

/** The message that approves a plan. The prefix matches the GUI, which recognizes it. */
export function planImplementationPrompt(markdown: string) {
  return `PLEASE IMPLEMENT THIS PLAN:\n${markdown.trim()}`;
}

export function planImplementationThreadTitle(markdown: string) {
  const title = proposedPlanTitle(markdown);
  return title ? `Implement ${title}` : "Implement plan";
}

export function planFilename(markdown: string) {
  const slug = (proposedPlanTitle(markdown) ?? "plan")
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return `${slug.length > 0 ? slug : "plan"}.md`;
}

export const planExportContents = (markdown: string) => `${markdown.trimEnd()}\n`;

export const planIsActionable = (plan: TuiProposedPlan) => plan.status === "active";

/** Where the plan came from, so the server can mark it implemented. */
export const planSource = (threadId: ThreadId, plan: TuiProposedPlan) => ({
  threadId,
  planId: plan.id,
});

export type PlanSourceThread = Pick<
  TuiThread,
  "id" | "projectId" | "modelSelection" | "runtimeMode" | "branch" | "worktreePath"
>;

const randomId = () => Hex.encode(globalThis.crypto.getRandomValues(new Uint8Array(16)));

/** What implementing a plan in a new thread dispatches, in order. */
export function planThreadCommands(source: PlanSourceThread, plan: TuiProposedPlan) {
  const threadId = ThreadId.make(randomId());
  const createdAt = DateTime.formatIso(DateTime.nowUnsafe());
  const title = planImplementationThreadTitle(plan.markdown).slice(0, 80);
  return [
    {
      type: "thread.create",
      commandId: CommandId.make(randomId()),
      threadId,
      projectId: source.projectId,
      title,
      modelSelection: source.modelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: "default",
      branch: source.branch,
      worktreePath: source.worktreePath,
      createdAt,
    },
    {
      type: "thread.turn.start",
      commandId: CommandId.make(randomId()),
      threadId,
      createdAt,
      message: {
        messageId: MessageId.make(randomId()),
        role: "user",
        text: planImplementationPrompt(plan.markdown),
        attachments: [],
      },
      modelSelection: source.modelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: "default",
      sourceProposedPlan: planSource(source.id, plan),
    },
  ] as const satisfies readonly [TuiCommand, TuiCommand];
}
