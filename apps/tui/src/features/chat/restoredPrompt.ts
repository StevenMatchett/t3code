// Adapted from apps/web/src/components/chat/composerPromptHistory.ts (MIT).
// Keep GUI-added context out of a prompt restored through another client.
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:\n";

const CLAUDE_ULTRATHINK_PREFIX = "Ultrathink:\n";
const REVIEW_COMMENT_BLOCK_PATTERN = /<review_comment\b[^>]*>[\s\S]*?<\/review_comment>/g;
const TRAILING_LEGACY_CONTEXT =
  /\n*<(terminal_context|element_context|preview_annotation)>\n([\s\S]*?)\n<\/\1>\s*$/;

/** Text sent in place of an empty prompt when a message is attachments only. */
export const ATTACHMENT_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more files without additional text. Respond using the conversation context and the attached files.]";

function stripTrailingReviewComments(prompt: string): string {
  let cut = prompt.length;
  for (const match of [...prompt.matchAll(REVIEW_COMMENT_BLOCK_PATTERN)].toReversed()) {
    const blockEnd = match.index + match[0].length;
    if (prompt.slice(blockEnd, cut).trim().length > 0) break;
    cut = match.index;
  }
  return cut === prompt.length ? prompt : prompt.slice(0, cut).trimEnd();
}

/**
 * Inline terminal chips are sent as `@terminal-1:12-13` labels in the text
 * with their content in the trailing block. Once the block is stripped the
 * label points at nothing, so remove it too. Each block entry removes one
 * label (the first match) and the single space beside it. Nothing else in
 * the prompt is touched, so indented code and typed labels survive. Block
 * headers look like `Terminal 1 lines 12-13`.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripInlineTerminalLabels(prompt: string, headers: ReadonlyArray<string>): string {
  let result = prompt;
  for (const header of headers) {
    const match = /^(.+?) lines? (\d+(?:-\d+)?)$/.exec(header);
    if (!match) continue;
    const label = `@${match[1]!.trim().toLowerCase().replace(/\s+/g, "-")}:${match[2]}`;
    // Whole label only: `@terminal-1:4` must not match inside `@terminal-1:40`
    // or `@terminal-1:4-12`.
    const labelPattern = new RegExp(`(?<![\\w@.-])${escapeRegExp(label)}(?![\\d-])`);
    const index = result.search(labelPattern);
    if (index < 0) continue;
    let end = index + label.length;
    let start = index;
    if (result[end] === " ") end += 1;
    else if (result[start - 1] === " ") start -= 1;
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

/**
 * Reduce a sent message to the text the user typed. Send-time appends
 * (terminal and element context blocks, preview annotations, review
 * comments, the Claude ultrathink prefix) are stripped so a recalled prompt
 * never carries stale context from another turn.
 */
export function recallableComposerPrompt(messageText: string): string {
  let prompt = messageText.trim();
  if (prompt.startsWith(CLAUDE_ULTRATHINK_PREFIX)) {
    prompt = prompt.slice(CLAUDE_ULTRATHINK_PREFIX.length);
  }

  while (prompt.length > 0) {
    const withoutReviewComments = stripTrailingReviewComments(prompt);
    if (withoutReviewComments !== prompt) {
      prompt = withoutReviewComments;
      continue;
    }
    const legacy = TRAILING_LEGACY_CONTEXT.exec(prompt);
    if (legacy) {
      if (
        legacy[1] === "preview_annotation" &&
        /^<preview_annotation>\s*$/m.test(legacy[2]!) &&
        !/^(?:Id|Page|Comment|Targets): /m.test(legacy[2]!)
      )
        break;
      const headers = Array.from(legacy[2]!.matchAll(/^- (.+):$/gm), (match) => match[1]!);
      if (legacy[1] !== "preview_annotation" && headers.length === 0) break;
      prompt = prompt.slice(0, legacy.index).trimEnd();
      if (legacy[1] === "terminal_context") prompt = stripInlineTerminalLabels(prompt, headers);
      continue;
    }
    break;
  }

  // Recall is text-only: never create dangling chips without their backing records.
  for (const reference of collectComposerContextReferences(prompt).toReversed()) {
    let { start, end } = reference;
    if (prompt[end] === " ") end += 1;
    else if (prompt[start - 1] === " ") start -= 1;
    prompt = prompt.slice(0, start) + prompt.slice(end);
  }

  // App-composed sends are not text the user typed, so they are not history.
  const trimmed = prompt.trim();
  if (
    trimmed === ATTACHMENT_ONLY_BOOTSTRAP_PROMPT ||
    trimmed.startsWith(PLAN_IMPLEMENTATION_PROMPT_PREFIX)
  ) {
    return "";
  }
  return trimmed;
}
