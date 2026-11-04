import type { TerminalCapabilities } from "./capabilities.ts";

export interface SemanticTheme {
  readonly accent: string;
  readonly border: string;
  readonly borderFocused: string;
  readonly danger: string;
  readonly hover: string;
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
export type ThemeMode = "dark" | "light";
export type ThemePreference = ThemeMode | "auto";

export const darkTheme: SemanticTheme = Object.freeze({
  accent: "#58a6ff",
  border: "#30363d",
  borderFocused: "#58a6ff",
  danger: "#f85149",
  hover: "#161f2b",
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

export const lightTheme: SemanticTheme = Object.freeze({
  accent: "#0969da",
  border: "#d0d7de",
  borderFocused: "#0969da",
  danger: "#cf222e",
  hover: "#f0f4f8",
  muted: "#59636e",
  panel: "#ffffff",
  success: "#1a7f37",
  selection: "#ddf0ff",
  syntaxCommand: "#0550ae",
  syntaxFlag: "#cf222e",
  syntaxNumber: "#0550ae",
  syntaxOperator: "#116329",
  syntaxString: "#0a3069",
  syntaxVariable: "#8250df",
  text: "#1f2328",
  warning: "#9a6700",
});

export const defaultTheme = darkTheme;

export const THEME_CHOICES: ReadonlyArray<{
  readonly id: ThemePreference;
  readonly label: string;
  readonly detail: string;
}> = [
  { id: "auto", label: "Match terminal", detail: "Follows your terminal's background." },
  { id: "dark", label: "Dark", detail: "Light text on a dark background." },
  { id: "light", label: "Light", detail: "Dark text on a light background." },
];

/** Reads the `fg;bg` hint terminals such as rxvt and Konsole export. Colors 0-6 and 8 are dark. */
export function themeModeFromColorfgbg(value: string | undefined): ThemeMode | null {
  const background = Number(value?.split(";").at(-1));
  if (value === undefined || !Number.isInteger(background)) return null;
  return background === 7 || background >= 9 ? "light" : "dark";
}

export function resolveThemeMode(
  preference: ThemePreference,
  detected: ThemeMode | null,
  colorfgbg: string | undefined,
): ThemeMode {
  if (preference !== "auto") return preference;
  return detected ?? themeModeFromColorfgbg(colorfgbg) ?? "dark";
}

export const themes: Readonly<{ readonly [Mode in ThemeMode]: SemanticTheme }> = {
  dark: darkTheme,
  light: lightTheme,
};

export function resolveThemeColor(
  theme: SemanticTheme,
  token: ThemeToken,
  capabilities: TerminalCapabilities,
) {
  return capabilities.color ? theme[token] : undefined;
}
