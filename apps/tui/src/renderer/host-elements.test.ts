import { describe, expect, it } from "@effect/vitest";
import { TextRenderable } from "@opentui/core";
import { extend, getComponentCatalogue } from "@opentui/react";

describe("OpenTUI host elements", () => {
  it("registers a custom renderable", () => {
    extend({ "b0-probe": TextRenderable });

    expect(getComponentCatalogue()["b0-probe"]).toBe(TextRenderable);
  });
});
