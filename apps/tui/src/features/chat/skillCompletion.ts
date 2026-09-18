export interface SkillCompletion {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export function skillCompletionAt(text: string, cursor: number): SkillCompletion | null {
  const position = Math.max(0, Math.min(text.length, cursor));
  const match = /(?:^|\s)\/([^\s/]*)$/u.exec(text.slice(0, position));
  if (!match || match.index + match[0].length !== position) return null;
  const query = match[1]!;
  const start = position - query.length - 1;
  let end = position;
  while (end < text.length && !/\s/u.test(text[end]!)) end += 1;
  if (text.slice(start + 1, end).includes("/")) return null;
  return { text, start, end, query };
}

export function completeSkillDraft(
  text: string,
  prefix: string,
  completion?: SkillCompletion,
  previousPrefix?: string,
) {
  const removePrefix =
    previousPrefix && text.startsWith(previousPrefix) ? previousPrefix.length : 0;
  if (!completion) return { text: prefix + text.slice(removePrefix), cursor: prefix.length };
  const before = text.slice(removePrefix, Math.max(removePrefix, completion.start));
  let after = text.slice(completion.end);
  if (after.startsWith(" ") && (!before || /\s$/u.test(before))) after = after.slice(1);
  return { text: prefix + before + after, cursor: prefix.length + before.length };
}
