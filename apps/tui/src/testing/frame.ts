export interface FrameReplacement {
  readonly value: string;
  readonly replacement: string;
}

/** Produces compact frame text while replacing only values named by the test. */
export function normalizeFrame(
  frame: string,
  replacements: readonly FrameReplacement[] = [],
): string {
  let normalized = frame.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  const orderedReplacements = [...replacements].sort(
    (left, right) => right.value.length - left.value.length,
  );
  for (const { value, replacement } of orderedReplacements) {
    if (value.length === 0) {
      throw new TypeError("Frame replacement values must not be empty");
    }
    normalized = normalized.replaceAll(
      value.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
      replacement,
    );
  }

  const lines = normalized.split("\n").map((line) => line.trimEnd());
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}
