import type { BoxProps } from "@opentui/react";

import { useThemeColor, useUi } from "./context.tsx";

export type KeyName =
  | "backspace"
  | "ctrl"
  | "down"
  | "enter"
  | "escape"
  | "left"
  | "meta"
  | "right"
  | "shift"
  | "space"
  | "tab"
  | "up"
  | (string & {});

const commonKeyLabels: Readonly<Record<string, string>> = Object.freeze({
  backspace: "Backspace",
  ctrl: "Ctrl",
  enter: "Enter",
  escape: "Esc",
  meta: "Meta",
  shift: "Shift",
  space: "Space",
  tab: "Tab",
});

const unicodeKeyLabels: Readonly<Record<string, string>> = Object.freeze({
  down: "↓",
  left: "←",
  right: "→",
  up: "↑",
});

const asciiKeyLabels: Readonly<Record<string, string>> = Object.freeze({
  down: "Down",
  left: "Left",
  right: "Right",
  up: "Up",
});

export function formatKeySequence(keys: KeyName | readonly KeyName[], unicode: boolean) {
  const sequence = typeof keys === "string" ? [keys] : keys;
  return sequence
    .map((key) => {
      const normalized = key.toLowerCase();
      return (
        commonKeyLabels[normalized] ??
        (unicode ? unicodeKeyLabels[normalized] : asciiKeyLabels[normalized]) ??
        (key.length === 1 ? key.toUpperCase() : key)
      );
    })
    .join("+");
}

export interface KeyHintProps extends Omit<BoxProps, "children"> {
  readonly keys: KeyName | readonly KeyName[];
  readonly label?: string;
}

export function KeyHint({ keys, label, ...props }: KeyHintProps) {
  const { capabilities } = useUi();
  const keyColor = useThemeColor("accent");
  const labelColor = useThemeColor("muted");

  return (
    <box {...props} flexDirection="row" height={1}>
      <text {...(keyColor ? { fg: keyColor } : {})}>
        [{formatKeySequence(keys, capabilities.unicode)}]
      </text>
      {label ? <text {...(labelColor ? { fg: labelColor } : {})}> {label}</text> : null}
    </box>
  );
}
