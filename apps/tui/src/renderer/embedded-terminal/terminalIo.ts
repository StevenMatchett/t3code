import type {
  EmbeddedTerminalDataSource,
  EmbeddedTerminalRenderable,
  KeyEvent,
} from "@opentui/core";

export const MAX_TERMINAL_WRITE_UNITS = 65_536;
export const MAX_TERMINAL_COLUMNS = 1_000;
export const MAX_TERMINAL_ROWS = 500;

const terminalDataDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalDataWriter = (
  data: string,
  source: EmbeddedTerminalDataSource,
) => Promise<unknown> | unknown;

export interface TerminalDataQueue {
  enqueue(data: Uint8Array, source: EmbeddedTerminalDataSource): void;
  drain(): Promise<void>;
  dispose(): void;
}

export function decodeTerminalData(data: Uint8Array): string {
  return terminalDataDecoder.decode(data);
}

export function splitTerminalWrite(
  data: string,
  maxUnits = MAX_TERMINAL_WRITE_UNITS,
): ReadonlyArray<string> {
  if (data.length === 0) return [];
  if (!Number.isInteger(maxUnits) || maxUnits < 1) {
    throw new RangeError("maxUnits must be a positive integer");
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + maxUnits, data.length);
    if (
      end < data.length &&
      end > start &&
      isHighSurrogate(data.charCodeAt(end - 1)) &&
      isLowSurrogate(data.charCodeAt(end))
    ) {
      end = end - start === 1 ? end + 1 : end - 1;
    }
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

export function createTerminalDataQueue(
  write: TerminalDataWriter,
  onError: (error: unknown) => void = () => undefined,
): TerminalDataQueue {
  let tail = Promise.resolve();
  let disposed = false;

  return {
    enqueue(data, source) {
      if (disposed) return;
      const decoded = decodeTerminalData(data);
      for (const chunk of splitTerminalWrite(decoded)) {
        tail = tail
          .then(() => (disposed ? undefined : write(chunk, source)))
          .then(
            () => undefined,
            (error) => {
              if (!disposed) onError(error);
            },
          );
      }
    },
    drain() {
      return tail;
    },
    dispose() {
      disposed = true;
    },
  };
}

export function clampTerminalSize(cols: number, rows: number): TerminalSize {
  return {
    cols: clampCellCount(cols, MAX_TERMINAL_COLUMNS),
    rows: clampCellCount(rows, MAX_TERMINAL_ROWS),
  };
}

export function createTerminalResizeHandler(
  resize: (size: TerminalSize) => Promise<unknown> | unknown,
  onError: (error: unknown) => void = () => undefined,
): (cols: number, rows: number) => void {
  let previous: TerminalSize | null = null;

  return (cols, rows) => {
    const next = clampTerminalSize(cols, rows);
    if (previous?.cols === next.cols && previous.rows === next.rows) return;

    previous = next;
    try {
      void Promise.resolve(resize(next)).catch(onError);
    } catch (error) {
      onError(error);
    }
  };
}

export function isTerminalFocusReleaseKey(
  event: Pick<KeyEvent, "ctrl" | "name" | "sequence">,
): boolean {
  return event.ctrl && (event.name === "\\" || event.sequence === "\x1c");
}

export function copyTerminalSelection(
  terminal: Pick<EmbeddedTerminalRenderable, "getSelectedText" | "hasSelection">,
  copy: (text: string) => Promise<unknown> | unknown,
  onError: (error: unknown) => void = () => undefined,
): boolean {
  if (!terminal.hasSelection()) return false;

  try {
    void Promise.resolve(copy(terminal.getSelectedText())).catch(onError);
  } catch (error) {
    onError(error);
  }
  return true;
}

function clampCellCount(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), maximum);
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}
