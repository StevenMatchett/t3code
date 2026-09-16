// @effect-diagnostics nodeBuiltinImport:off - This static boundary test reads the TUI source tree.
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const sourceRoot = NodePath.resolve(import.meta.dirname, "..");
const allowedOpenTuiDirectories = ["renderer/", "testing/", "ui/"];
const sourceExtension = /\.[cm]?[jt]sx?$/;
const openTuiImport = /\b(?:from|import)\s*(?:\(\s*)?["'](@opentui\/[^"']+)["']/g;
const hostElement = /<([a-z][\w-]*)\b/g;

function sourceFiles(directory: string): readonly string[] {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtension.test(entry.name) ? [path] : [];
  });
}

function relativeSourcePath(path: string) {
  return NodePath.relative(sourceRoot, path).split(NodePath.sep).join("/");
}

describe("OpenTUI boundary", () => {
  it("keeps OpenTUI imports inside UI, renderer, and test adapters", () => {
    const violations = sourceFiles(sourceRoot).flatMap((path) => {
      const relativePath = relativeSourcePath(path);
      if (allowedOpenTuiDirectories.some((directory) => relativePath.startsWith(directory))) {
        return [];
      }

      return [...NodeFS.readFileSync(path, "utf8").matchAll(openTuiImport)].map(
        (match) => `${relativePath}: ${match[1]}`,
      );
    });

    expect(violations).toEqual([]);
  });

  it("keeps OpenTUI host elements out of application components", () => {
    const appRoot = NodePath.join(sourceRoot, "app");
    const violations = sourceFiles(appRoot).flatMap((path) =>
      [...NodeFS.readFileSync(path, "utf8").matchAll(hostElement)].map(
        (match) => `${relativeSourcePath(path)}: <${match[1]}>`,
      ),
    );

    expect(violations).toEqual([]);
  });
});
