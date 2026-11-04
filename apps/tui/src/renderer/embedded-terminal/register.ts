import { EmbeddedTerminalRenderable, KeyEvent, type OptimizedBuffer } from "@opentui/core";
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

export class TuiEmbeddedTerminalRenderable extends EmbeddedTerminalRenderable {
  private pendingOutput: Array<string | Uint8Array> | null = [];

  /**
   * Sets the emulator's default colors, so the shell matches the app's theme and programs asking the
   * terminal for its background get the true answer. This is local state, not shell output.
   */
  setDefaultColors(background: string, foreground: string): void {
    super.write(`\u001b]11;${background}\u0007\u001b]10;${foreground}\u0007`);
    this.requestRender();
  }

  override write(data: string | Uint8Array): void {
    if (this.pendingOutput !== null) {
      this.pendingOutput.push(typeof data === "string" ? data : data.slice());
      this.requestRender();
      return;
    }
    super.write(data);
  }

  override render(buffer: OptimizedBuffer, deltaTime: number): void {
    // Layout must size the emulator before replaying cursor-addressed application output.
    const pending = this.pendingOutput;
    if (pending !== null) {
      this.pendingOutput = null;
      for (const data of pending) super.write(data);
    }
    super.render(buffer, deltaTime);
  }

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
