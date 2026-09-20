export function suggestedReplies(text: string): readonly string[] {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let start = 1; start < lines.length; start += 1) {
    const question = lines[start - 1]!;
    if (!/[?:]$/u.test(question)) continue;
    const choices: string[] = [];
    for (let index = start; index < lines.length; index += 1) {
      const match = /^(\d{1,2})[.)]\s+(.+)$/u.exec(lines[index]!);
      if (!match || Number(match[1]) !== choices.length + 1) {
        choices.length = 0;
        break;
      }
      choices.push(match[2]!.trim());
    }
    if (
      choices.length >= 2 &&
      choices.length <= 9 &&
      new Set(choices).size === choices.length &&
      choices.every((choice) => choice.length <= 160 && !choice.endsWith("?"))
    )
      return choices;
  }
  return [];
}
