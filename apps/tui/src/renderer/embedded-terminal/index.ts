export {
  EmbeddedTerminalSurface,
  type EmbeddedTerminalSurfaceHandle,
  type EmbeddedTerminalSurfaceProps,
} from "./EmbeddedTerminalSurface.tsx";
export {
  clampTerminalSize,
  copyTerminalSelection,
  createTerminalDataQueue,
  createTerminalResizeHandler,
  decodeTerminalData,
  isTerminalFocusReleaseKey,
  MAX_TERMINAL_COLUMNS,
  MAX_TERMINAL_ROWS,
  MAX_TERMINAL_WRITE_UNITS,
  splitTerminalWrite,
  type TerminalDataQueue,
  type TerminalDataWriter,
  type TerminalSize,
} from "./terminalIo.ts";
