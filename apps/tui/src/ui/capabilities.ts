export interface TerminalCapabilities {
  readonly color: boolean;
  readonly unicode: boolean;
  readonly animation?: boolean;
}

export type TerminalEnvironment = Readonly<Record<string, string | undefined>>;

export const richTerminalCapabilities: TerminalCapabilities = Object.freeze({
  color: true,
  unicode: true,
});

export const basicTerminalCapabilities: TerminalCapabilities = Object.freeze({
  color: false,
  unicode: false,
  animation: false,
});

function supportsColor(environment: TerminalEnvironment) {
  if (environment.FORCE_COLOR !== undefined) return environment.FORCE_COLOR !== "0";
  return environment.NO_COLOR === undefined && environment.TERM !== "dumb";
}

function supportsUnicode(environment: TerminalEnvironment) {
  if (environment.T3_TUI_ASCII === "1" || environment.TERM === "dumb") return false;

  const locale = environment.LC_ALL ?? environment.LC_CTYPE ?? environment.LANG;
  if (locale === undefined) return true;
  return !/^(?:C|POSIX)$/i.test(locale);
}

export function detectTerminalCapabilities(environment: TerminalEnvironment): TerminalCapabilities {
  return {
    color: supportsColor(environment),
    unicode: supportsUnicode(environment),
    animation: environment.T3_TUI_ANIMATION !== "0" && environment.TERM !== "dumb",
  };
}
