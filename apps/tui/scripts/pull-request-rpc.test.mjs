import * as NodeAssert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import { makeTerminalEnvironmentFixture } from "./terminal-fixture.mjs";
import { preparePeer } from "./provider-peer-fixture.mjs";

// A stand-in for the GitHub CLI: a real server drives it, and no account is ever involved.
const FAKE_GH = `#!/bin/sh
echo "$*" >> "$(dirname "$0")/calls.log"
case "$1 $2" in
  "auth status") echo "Logged in to github.com account fixture"; exit 0 ;;
  "--version "*) echo "gh version 2.70.0"; exit 0 ;;
  "repo view") case "$*" in *--jq*) echo main; exit 0 ;; esac; echo '{"nameWithOwner":"example/repo","defaultBranchRef":{"name":"main"},"url":"https://github.com/example/repo"}'; exit 0 ;;
  "pr list")
    if [ -f "$(dirname "$0")/created" ]; then
      echo '[{"number":42,"title":"Add beta","url":"https://github.com/example/repo/pull/42","baseRefName":"main","headRefName":"feature","state":"OPEN","updatedAt":"2026-01-01T00:00:00Z"}]'
    else
      echo '[]'
    fi
    exit 0 ;;
  "pr create") touch "$(dirname "$0")/created"; echo "https://github.com/example/repo/pull/42"; exit 0 ;;
  "pr view") echo '{"number":42,"title":"Add beta","url":"https://github.com/example/repo/pull/42","baseRefName":"main","headRefName":"feature","state":"OPEN"}'; exit 0 ;;
esac
echo '{}'
exit 0
`;

const FAKE_CODEX = `#!/bin/sh
if [ "$1" = exec ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = --output-last-message ]; then
      printf '{"title":"Add beta","body":"Adds beta."}' > "$2"
    fi
    shift
  done
  exit 0
fi
exec "$(dirname "$0")/codex-peer" "$@"
`;

it.live(
  "creates a pull request through a real server and a stand-in gh",
  () =>
    Effect.gen(function* () {
      let shim = "";
      const fixture = yield* makeTerminalEnvironmentFixture({
        serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
        prepare: async (root) => {
          const env = await preparePeer(root, "complete");
          shim = NodePath.join(root, "shim");
          NodeFS.mkdirSync(shim);
          NodeFS.writeFileSync(NodePath.join(shim, "gh"), FAKE_GH, { mode: 0o755 });
          // PR text comes from a one-shot `codex exec`, which the peer does not answer.
          const peer = NodePath.join(root, "peer");
          NodeFS.renameSync(NodePath.join(peer, "codex"), NodePath.join(peer, "codex-peer"));
          NodeFS.writeFileSync(NodePath.join(peer, "codex"), FAKE_CODEX, { mode: 0o755 });
          return { ...env, PATH: `${shim}:${NodePath.dirname(process.execPath)}:/usr/bin:/bin` };
        },
      });
      const cwd = NodePath.join(fixture.root, "workspace");
      const git = (...args) =>
        execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
      NodeFS.mkdirSync(cwd, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(cwd, "a.ts"), "export const a = 1;\n");
      const upstream = NodePath.join(fixture.root, "upstream.git");
      execFileSync("git", ["init", "--bare", "-b", "main", upstream], { stdio: "ignore" });
      git("init", "-b", "main");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.com");
      git("add", ".");
      git("commit", "-m", "Initial");
      git("remote", "add", "origin", upstream);
      git("push", "-u", "origin", "main");
      git("checkout", "-b", "feature");
      NodeFS.writeFileSync(NodePath.join(cwd, "b.ts"), "export const b = 2;\n");
      git("add", ".");
      git("commit", "-m", "Add beta");
      git("push", "-u", "origin", "feature");
      // The server picks its host from the fetch URL. Pushes still land in the local bare repo.
      git("remote", "set-url", "origin", "https://github.com/example/repo.git");
      git("remote", "set-url", "--push", "origin", upstream);

      const client = createTuiClient({
        readiness: fixture.readiness,
        bearer: fixture.environment.bearer,
      });
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() => AtomRegistry.make()),
        (value) => Effect.sync(() => value.dispose()),
      );
      const unmount = registry.mount(client.connection);
      yield* Effect.addFinalizer(() => Effect.sync(unmount));
      yield* AtomRegistry.toStream(registry, client.connection).pipe(
        Stream.filter((state) => state.phase === "connected"),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
      yield* Effect.promise(async () => {
        const result = await client.git.run(
          registry,
          {
            cwd,
            threadId: ThreadId.make("pr-thread"),
            projectId: ProjectId.make("pr-project"),
          },
          { action: "create_pr" },
        );
        const calls = NodeFS.readFileSync(NodePath.join(shim, "calls.log"), "utf8");
        NodeAssert.match(calls, /pr create/u, calls);
        NodeAssert.equal(result.pr.status, "created", JSON.stringify(result.pr));
        NodeAssert.equal(result.pr.number, 42);
        NodeAssert.equal(result.pr.url, "https://github.com/example/repo/pull/42");
      });
    }).pipe(Effect.scoped),
  120_000,
);

it.live(
  "offers no current-server features on the older protocol",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeTerminalEnvironmentFixture({
        serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
        prepare: (root) => preparePeer(root, "complete"),
      });
      const { descriptor } = fixture.readiness;
      const older = createTuiClient({
        readiness: {
          ...fixture.readiness,
          descriptor: { ...descriptor, orchestrationProtocolVersion: 1 },
        },
        bearer: fixture.environment.bearer,
      });
      NodeAssert.equal(older.git, undefined);
      NodeAssert.equal(older.pullRequests, undefined);
      NodeAssert.equal(older.forkThreadFromRun, undefined);
      const current = createTuiClient({
        readiness: fixture.readiness,
        bearer: fixture.environment.bearer,
      });
      NodeAssert.ok(current.git && current.pullRequests && current.forkThreadFromRun);
    }).pipe(Effect.scoped),
  60_000,
);
