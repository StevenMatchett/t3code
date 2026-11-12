import { describe, expect, it } from "@effect/vitest";
import { composerCommands } from "./composerCommands.ts";

describe("composerCommands", () => {
  it("offers /side and /btw only where side chats can start", () => {
    const names = (sideChats: boolean) =>
      composerCommands(undefined, { sideChats }).map((command) => command.name);
    expect(names(true)).toEqual(expect.arrayContaining(["side", "btw"]));
    expect(names(false)).not.toContain("side");
    expect(names(false)).not.toContain("btw");
  });
});
