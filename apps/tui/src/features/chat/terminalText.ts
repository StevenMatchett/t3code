export const DEFAULT_TIMELINE_LINE_LENGTH = 4_096;

export interface TerminalTextOptions {
  readonly maxLineLength?: number;
}

function consumeControlString(value: string, start: number, bellTerminates: boolean): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (bellTerminates && code === 0x07) return index + 1;
    if (code === 0x9c) return index + 1;
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
  }
  return value.length;
}

function consumeControlSequence(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return value.length;
}

function consumeEscape(value: string, start: number): number {
  if (start >= value.length) return value.length;

  switch (value.charCodeAt(start)) {
    case 0x5b:
      return consumeControlSequence(value, start + 1);
    case 0x5d:
      return consumeControlString(value, start + 1, true);
    case 0x50:
    case 0x58:
    case 0x5e:
    case 0x5f:
      return consumeControlString(value, start + 1, false);
    default: {
      let index = start;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || code > 0x2f) break;
        index += 1;
      }
      if (index >= value.length) return value.length;
      const finalCode = value.charCodeAt(index);
      return finalCode >= 0x30 && finalCode <= 0x7e ? index + 1 : index;
    }
  }
}

function stripTerminalSequences(value: string): string {
  let result = "";
  let index = 0;

  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      index = consumeEscape(value, index + 1);
      continue;
    }
    if (code === 0x9b) {
      index = consumeControlSequence(value, index + 1);
      continue;
    }
    if (code === 0x9d) {
      index = consumeControlString(value, index + 1, true);
      continue;
    }
    if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      index = consumeControlString(value, index + 1, false);
      continue;
    }
    result += value[index];
    index += 1;
  }

  return result;
}

function truncateLine(value: string, maxLength: number): string {
  let prefix = "";
  let finalCharacter = "";
  let count = 0;

  for (const character of value) {
    count += 1;
    if (count < maxLength) {
      prefix += character;
    } else if (count === maxLength) {
      finalCharacter = character;
    } else {
      return `${prefix}…`;
    }
  }

  return count === maxLength ? `${prefix}${finalCharacter}` : prefix;
}

function resolveMaxLineLength(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_TIMELINE_LINE_LENGTH;
}

/** Removes terminal control sequences while retaining ordinary Unicode and line breaks. */
export function normalizeTerminalText(value: string, options: TerminalTextOptions = {}): string {
  const maxLineLength = resolveMaxLineLength(options.maxLineLength);
  return stripTerminalSequences(value.toWellFormed())
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, "    ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "")
    .split("\n")
    .map((line) => truncateLine(line, maxLineLength))
    .join("\n");
}
