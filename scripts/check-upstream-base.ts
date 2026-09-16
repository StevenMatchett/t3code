import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface UpstreamBase {
  readonly repository: string;
  readonly branch: string;
  readonly commit: string;
  readonly recordedAt: string;
  readonly sourceCommittedAt: string;
  readonly forkIntegrationBranch: string;
  readonly license: string;
}

const root = resolve(import.meta.dirname, "..");
const base = JSON.parse(readFileSync(resolve(root, "UPSTREAM_BASE"), "utf8")) as UpstreamBase;

if (!/^[0-9a-f]{40}$/.test(base.commit)) {
  throw new Error("UPSTREAM_BASE.commit must be a full lowercase 40-character Git SHA");
}

const git = (...args: readonly string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const resolvedCommit = git("rev-parse", `${base.commit}^{commit}`);
if (resolvedCommit !== base.commit) {
  throw new Error(`UPSTREAM_BASE commit resolved to ${resolvedCommit}`);
}

const mergeBase = git("merge-base", base.commit, "HEAD");
if (mergeBase !== base.commit) {
  throw new Error(`HEAD does not descend from the recorded upstream base: ${base.commit}`);
}

console.log(`Recorded upstream base is valid: ${base.commit}`);
