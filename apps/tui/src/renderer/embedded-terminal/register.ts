import { EmbeddedTerminalRenderable } from "@opentui/core";
import { extend } from "@opentui/react";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "t3-embedded-terminal": typeof EmbeddedTerminalRenderable;
  }
}

let registered = false;

export function registerEmbeddedTerminal(): void {
  if (registered) return;

  extend({
    "t3-embedded-terminal": EmbeddedTerminalRenderable,
  });
  registered = true;
}
