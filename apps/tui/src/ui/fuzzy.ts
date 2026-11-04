const wordStart = /[\s\-_/.:·]/u;

/**
 * Scores how well a query matches a label, higher first, or null for no match. A whole-word or
 * prefix hit beats letters scattered through the label, so the thing you meant ranks first.
 */
export function fuzzyScore(query: string, label: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  const haystack = label.toLocaleLowerCase();
  if (haystack === needle) return 1_000;
  if (haystack.startsWith(needle)) return 800 - haystack.length;
  const index = haystack.indexOf(needle);
  if (index >= 0)
    return (wordStart.test(haystack[index - 1] ?? " ") ? 600 : 400) - index - haystack.length / 100;
  let position = 0;
  let score = 200;
  let last = -1;
  for (const character of needle) {
    if (character === " ") continue;
    const next = haystack.indexOf(character, position);
    if (next < 0) return null;
    score += next === last + 1 ? 2 : wordStart.test(haystack[next - 1] ?? " ") ? 1 : -1;
    last = next;
    position = next + 1;
  }
  return score;
}
