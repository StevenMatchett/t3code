import { describe, expect, it } from "@effect/vitest";

import { calculatePanelLayout, calculateShellLayout } from "./layout.ts";

describe("responsive shell layout", () => {
  it("uses two panes only when both navigation and conversation have usable space", () => {
    const wide = calculateShellLayout(120, 32);
    expect(wide.split).toBe(true);
    expect(wide.sidebarWidth + wide.mainWidth + 3).toBe(120);
    expect(wide.bodyHeight).toBe(28);
    expect(wide.contentWidth).toBeGreaterThanOrEqual(64);
    expect(calculateShellLayout(80, 24).split).toBe(false);
    expect(calculateShellLayout(120, 14).split).toBe(false);
  });
});

describe("calculatePanelLayout", () => {
  it.each([
    { width: 0, borderColumns: 0, paddingX: 0, contentWidth: 0 },
    { width: 1, borderColumns: 1, paddingX: 0, contentWidth: 0 },
    { width: 2, borderColumns: 2, paddingX: 0, contentWidth: 0 },
    { width: 3, borderColumns: 2, paddingX: 0, contentWidth: 1 },
    { width: 4, borderColumns: 2, paddingX: 1, contentWidth: 0 },
    { width: 40, borderColumns: 2, paddingX: 1, contentWidth: 36 },
  ])("keeps a $width-column bordered panel non-negative", (expected) => {
    const { width, ...layout } = expected;
    expect(calculatePanelLayout({ width })).toEqual(layout);
  });

  it("clamps requested padding to the space inside the border", () => {
    expect(calculatePanelLayout({ width: 9, paddingX: 10 })).toEqual({
      borderColumns: 2,
      contentWidth: 1,
      paddingX: 3,
    });
  });

  it("normalizes fractional, negative, and non-finite input", () => {
    expect(calculatePanelLayout({ bordered: false, paddingX: -2, width: 10.9 })).toEqual({
      borderColumns: 0,
      contentWidth: 10,
      paddingX: 0,
    });
    expect(calculatePanelLayout({ width: Number.POSITIVE_INFINITY })).toEqual({
      borderColumns: 0,
      contentWidth: 0,
      paddingX: 0,
    });
  });
});
