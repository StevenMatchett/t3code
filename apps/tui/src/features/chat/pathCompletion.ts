export interface PathCompletion {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

/** The `@query` the cursor is in, when one is being typed. */
export function pathCompletionAt(text: string, cursor: number): PathCompletion | null {
  const position = Math.max(0, Math.min(text.length, cursor));
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(text.slice(0, position));
  if (!match) return null;
  const query = match[1]!;
  const start = position - query.length - 1;
  let end = position;
  while (end < text.length && !/\s/u.test(text[end]!)) end += 1;
  return { start, end, query };
}

/** Replaces the `@query` with the chosen path and leaves the cursor ready for more text. */
export function completePathDraft(text: string, completion: PathCompletion, path: string) {
  const mention = `@${path} `;
  const after = text.slice(completion.end).replace(/^ /u, "");
  return {
    text: `${text.slice(0, completion.start)}${mention}${after}`,
    cursor: completion.start + mention.length,
  };
}
