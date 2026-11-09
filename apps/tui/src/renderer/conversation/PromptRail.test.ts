import { describe, expect, it } from "@effect/vitest";
import { promptMarkWidth, promptRailWindow } from "./PromptRail.tsx";

describe("promptMarkWidth", () => {
  it("grows the hovered mark most and its neighbors a little, like a dock", () => {
    expect([0, 1, 2, 3, 4].map((index) => promptMarkWidth(index, 2))).toEqual([2, 3, 4, 3, 2]);
    expect(promptMarkWidth(2, null)).toBe(2);
  });
});

describe("promptRailWindow", () => {
  it("shows every prompt when they fit", () => {
    expect(promptRailWindow(5, 10, 4)).toEqual({ from: 0, to: 5 });
  });

  it("keeps the current prompt in view when there are more prompts than rows", () => {
    expect(promptRailWindow(30, 10, 15)).toEqual({ from: 10, to: 20 });
    expect(promptRailWindow(30, 10, 0)).toEqual({ from: 0, to: 10 });
    expect(promptRailWindow(30, 10, 29)).toEqual({ from: 20, to: 30 });
  });
});
