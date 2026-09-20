import type { TerminalCapabilities } from "./capabilities.ts";

export interface SemanticTheme {
  readonly accent: string;
  readonly border: string;
  readonly borderFocused: string;
  readonly danger: string;
  readonly muted: string;
  readonly panel: string;
  readonly success: string;
  readonly selection: string;
  readonly syntaxCommand: string;
  readonly syntaxFlag: string;
  readonly syntaxNumber: string;
  readonly syntaxOperator: string;
  readonly syntaxString: string;
  readonly syntaxVariable: string;
  readonly text: string;
  readonly warning: string;
}

export type ThemeToken = keyof SemanticTheme;

export const defaultTheme: SemanticTheme = Object.freeze({
  accent: "#58a6ff",
  border: "#30363d",
  borderFocused: "#58a6ff",
  danger: "#f85149",
  muted: "#8b949e",
  panel: "#0d1117",
  success: "#3fb950",
  selection: "#1c2e45",
  syntaxCommand: "#79c0ff",
  syntaxFlag: "#ff7b72",
  syntaxNumber: "#a5d6ff",
  syntaxOperator: "#56d4dd",
  syntaxString: "#a5d6a7",
  syntaxVariable: "#d2a8ff",
  text: "#e6edf3",
  warning: "#d29922",
});

export function resolveThemeColor(
  theme: SemanticTheme,
  token: ThemeToken,
  capabilities: TerminalCapabilities,
) {
  return capabilities.color ? theme[token] : undefined;
}
