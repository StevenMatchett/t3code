import { EmbeddedTerminalRenderable, KeyEvent } from "@opentui/core";
import { extend } from "@opentui/react";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "t3-embedded-terminal": typeof EmbeddedTerminalRenderable;
  }
}

const navigationKeys: Readonly<Record<string, string>> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  home: "Home",
  end: "End",
};

class TuiEmbeddedTerminalRenderable extends EmbeddedTerminalRenderable {
  override encodeKey(key: KeyEvent): Uint8Array {
    const name = key.name.toUpperCase();
    const code = /^F(?:[1-9]|1\d|2[0-4])$/.test(name) ? name : navigationKeys[key.name];
    return super.encodeKey(code ? new KeyEvent({ ...key, code }) : key);
  }
}

let registered = false;

export function registerEmbeddedTerminal(): void {
  if (registered) return;

  extend({
    "t3-embedded-terminal": TuiEmbeddedTerminalRenderable,
  });
  registered = true;
}
