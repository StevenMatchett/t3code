import {
  EmbeddedTerminalRenderable,
  type EmbeddedTerminalDataSource,
  type KeyEvent,
} from "@opentui/core";
import {
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  readTerminalOutputUpdate,
  type TerminalOutputCursor,
  type TerminalOutputState,
} from "@t3tools/client-runtime/state/terminal";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { registerEmbeddedTerminal } from "./register.ts";
import {
  clampTerminalSize,
  copyTerminalSelection,
  createTerminalDataQueue,
  createTerminalResizeHandler,
  isTerminalFocusReleaseKey,
  type TerminalDataQueue,
  type TerminalSize,
} from "./terminalIo.ts";

registerEmbeddedTerminal();

interface PendingReset {
  readonly cursor: TerminalOutputCursor;
  readonly data: string;
}

export interface EmbeddedTerminalSurfaceHandle {
  focus(): void;
  blur(): void;
  paste(data: string | Uint8Array): void;
  copySelection(): boolean;
  drainInput(): Promise<void>;
}

export interface EmbeddedTerminalSurfaceProps {
  readonly output: TerminalOutputState;
  readonly focused: boolean;
  readonly onWrite: (
    data: string,
    source: EmbeddedTerminalDataSource,
  ) => Promise<unknown> | unknown;
  readonly onResize: (size: TerminalSize) => Promise<unknown> | unknown;
  readonly onReleaseFocus: () => void;
  readonly onCopy: (text: string) => Promise<unknown> | unknown;
  readonly onWriteError?: (error: unknown) => void;
  readonly id?: string;
  readonly initialCols?: number;
  readonly initialRows?: number;
  readonly maxScrollback?: number;
}

export const EmbeddedTerminalSurface = forwardRef<
  EmbeddedTerminalSurfaceHandle,
  EmbeddedTerminalSurfaceProps
>(function EmbeddedTerminalSurface(
  {
    output,
    focused,
    onWrite,
    onResize,
    onReleaseFocus,
    onCopy,
    onWriteError,
    id = "t3-embedded-terminal",
    initialCols = 80,
    initialRows = 24,
    maxScrollback = 5_000,
  },
  forwardedRef,
) {
  const terminalRef = useRef<EmbeddedTerminalRenderable | null>(null);
  const cursorRef = useRef<TerminalOutputCursor>(INITIAL_TERMINAL_OUTPUT_CURSOR);
  const pendingResetRef = useRef<PendingReset | null>(null);
  const initializedRef = useRef(false);
  const focusedRef = useRef(focused);
  const writeRef = useRef(onWrite);
  const resizeRef = useRef(onResize);
  const releaseFocusRef = useRef(onReleaseFocus);
  const copyRef = useRef(onCopy);
  const writeErrorRef = useRef(onWriteError);
  const [terminalEpoch, setTerminalEpoch] = useState(0);

  focusedRef.current = focused;
  writeRef.current = onWrite;
  resizeRef.current = onResize;
  releaseFocusRef.current = onReleaseFocus;
  copyRef.current = onCopy;
  writeErrorRef.current = onWriteError;

  const dataQueueRef = useRef<TerminalDataQueue | null>(null);
  if (dataQueueRef.current === null) {
    dataQueueRef.current = createTerminalDataQueue(
      (data, source) => writeRef.current(data, source),
      (error) => writeErrorRef.current?.(error),
    );
  }

  const resizeHandlerRef = useRef<((cols: number, rows: number) => void) | null>(null);
  if (resizeHandlerRef.current === null) {
    resizeHandlerRef.current = createTerminalResizeHandler((size) => resizeRef.current(size));
  }

  if (!initializedRef.current) {
    const initialUpdate = readTerminalOutputUpdate(output, cursorRef.current);
    if (initialUpdate.type === "reset") {
      pendingResetRef.current = initialUpdate;
    } else {
      cursorRef.current = initialUpdate.cursor;
    }
    initializedRef.current = true;
  }

  const setTerminalRef = useCallback((terminal: EmbeddedTerminalRenderable | null) => {
    terminalRef.current = terminal;
    if (terminal === null) return;

    const pendingReset = pendingResetRef.current;
    if (pendingReset !== null) {
      if (pendingReset.data.length > 0) terminal.write(pendingReset.data);
      cursorRef.current = pendingReset.cursor;
      pendingResetRef.current = null;
    }
    if (focusedRef.current) terminal.focus();
  }, []);

  const handleData = useCallback((data: Uint8Array, source: EmbeddedTerminalDataSource) => {
    dataQueueRef.current!.enqueue(data, source);
  }, []);

  const handleKeyDown = useCallback((event: KeyEvent) => {
    if (!isTerminalFocusReleaseKey(event)) return;

    event.preventDefault();
    event.stopPropagation();
    terminalRef.current?.blur();
    releaseFocusRef.current();
  }, []);

  useLayoutEffect(() => {
    const update = readTerminalOutputUpdate(output, cursorRef.current);
    if (update.type === "none") {
      cursorRef.current = update.cursor;
      return;
    }
    if (update.type === "append") {
      terminalRef.current?.write(update.data);
      cursorRef.current = update.cursor;
      return;
    }

    pendingResetRef.current = update;
    setTerminalEpoch((current) => current + 1);
  }, [output]);

  useLayoutEffect(() => {
    const terminal = terminalRef.current;
    if (focused) terminal?.focus();
    else terminal?.blur();
  }, [focused, terminalEpoch]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus() {
        terminalRef.current?.focus();
      },
      blur() {
        terminalRef.current?.blur();
      },
      paste(data) {
        const terminal = terminalRef.current;
        if (terminal === null) return;

        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        dataQueueRef.current!.enqueue(terminal.encodePaste(bytes), "input");
      },
      copySelection() {
        const terminal = terminalRef.current;
        return terminal === null
          ? false
          : copyTerminalSelection(terminal, (text) => copyRef.current(text));
      },
      drainInput() {
        return dataQueueRef.current!.drain();
      },
    }),
    [],
  );

  const initialSize = clampTerminalSize(initialCols, initialRows);

  return (
    <t3-embedded-terminal
      key={terminalEpoch}
      ref={setTerminalRef}
      id={id}
      width="100%"
      height="100%"
      cols={initialSize.cols}
      rows={initialSize.rows}
      maxScrollback={maxScrollback}
      selectable
      onData={handleData}
      onTerminalResize={resizeHandlerRef.current}
      onKeyDown={handleKeyDown}
    />
  );
});
