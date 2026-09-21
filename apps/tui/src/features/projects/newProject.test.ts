import { describe, expect, it } from "@effect/vitest";
import { defaultCloneDestination } from "./newProject.ts";

describe("new project helpers", () => {
  it("derives a clone folder from GitHub URLs and shorthand", () => {
    expect(defaultCloneDestination("~/code", "https://github.com/acme/widgets.git")).toBe(
      "~/code/widgets",
    );
    expect(defaultCloneDestination("~/code/", "acme/widgets")).toBe("~/code/widgets");
  });
});
