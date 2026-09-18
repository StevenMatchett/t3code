import { describe, expect, it } from "@effect/vitest";

import {
  basicTerminalCapabilities,
  detectTerminalCapabilities,
  richTerminalCapabilities,
} from "./capabilities.ts";
import { defaultTheme, resolveThemeColor } from "./theme.ts";

describe("terminal capabilities", () => {
  it("keeps color and Unicode decisions independent", () => {
    expect(detectTerminalCapabilities({ LANG: "en_US.UTF-8", NO_COLOR: "" })).toEqual({
      color: false,
      unicode: true,
      animation: true,
    });
    expect(detectTerminalCapabilities({ LANG: "en_US.UTF-8", T3_TUI_ASCII: "1" })).toEqual({
      color: true,
      unicode: false,
      animation: true,
    });
  });

  it("uses the basic mode for a dumb terminal and honors an explicit color override", () => {
    expect(detectTerminalCapabilities({ TERM: "dumb" })).toEqual(basicTerminalCapabilities);
    expect(detectTerminalCapabilities({ FORCE_COLOR: "1", TERM: "dumb" })).toEqual({
      color: true,
      unicode: false,
      animation: false,
    });
  });

  it("treats C and POSIX locales as ASCII unless they declare an encoding", () => {
    expect(detectTerminalCapabilities({ LANG: "C" }).unicode).toBe(false);
    expect(detectTerminalCapabilities({ LANG: "POSIX" }).unicode).toBe(false);
    expect(detectTerminalCapabilities({ LANG: "C.UTF-8" }).unicode).toBe(true);
  });
});

describe("semantic theme", () => {
  it("returns semantic colors only when the terminal supports color", () => {
    expect(resolveThemeColor(defaultTheme, "danger", richTerminalCapabilities)).toBe(
      defaultTheme.danger,
    );
    expect(resolveThemeColor(defaultTheme, "danger", basicTerminalCapabilities)).toBeUndefined();
  });
});
