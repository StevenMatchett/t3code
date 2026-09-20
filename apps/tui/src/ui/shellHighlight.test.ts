import { describe, expect, it } from "@effect/vitest";
import { shellHighlightTokens } from "./shellHighlight.ts";

describe("shellHighlightTokens", () => {
  it("classifies commands, flags, operators, strings, variables, and numbers", () => {
    expect(
      shellHighlightTokens('[completed] git diff --check && printf "%s" "$HOME" 2').filter(
        (token) => token.kind !== "plain",
      ),
    ).toEqual([
      { text: "git", kind: "command" },
      { text: "--check", kind: "flag" },
      { text: "&&", kind: "operator" },
      { text: "printf", kind: "command" },
      { text: '"%s"', kind: "string" },
      { text: '"$HOME"', kind: "string" },
      { text: "2", kind: "number" },
    ]);
  });

  it("keeps command wrappers looking for the executable", () => {
    const tokens = shellHighlightTokens("sudo env MODE=test bun run lint");
    expect(tokens.filter((token) => token.kind === "command").map((token) => token.text)).toEqual([
      "sudo",
      "env",
      "bun",
    ]);
    expect(tokens).toContainEqual({ text: "MODE=test", kind: "variable" });
  });
});
