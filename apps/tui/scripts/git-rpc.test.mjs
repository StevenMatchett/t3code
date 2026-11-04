import * as NodeAssert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { ThreadId, ProjectId, TurnItemId } from "@t3tools/contracts";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import { makeTerminalEnvironmentFixture } from "./terminal-fixture.mjs";
import { preparePeer } from "./provider-peer-fixture.mjs";

const run = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  }).trim();

it.live(
  "drives git, path search, file writes, and secret answers through a real T3 server",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeTerminalEnvironmentFixture({
        serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
        prepare: (root) => preparePeer(root, "complete"),
      });
      const cwd = NodePath.join(fixture.root, "workspace");
      NodeFS.mkdirSync(NodePath.join(cwd, "src"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(cwd, "src", "alpha.ts"), "export const alpha = 1;\n");
      run(cwd, "init", "-b", "main");
      run(cwd, "config", "user.name", "Fixture");
      run(cwd, "config", "user.email", "fixture@example.com");
      run(cwd, "add", ".");
      run(cwd, "commit", "-m", "Initial");
      const client = createTuiClient({
        readiness: fixture.readiness,
        bearer: fixture.environment.bearer,
      });
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() => AtomRegistry.make()),
        (value) => Effect.sync(() => value.dispose()),
      );
      const unmountConnection = registry.mount(client.connection);
      yield* Effect.addFinalizer(() => Effect.sync(unmountConnection));
      yield* AtomRegistry.toStream(registry, client.connection).pipe(
        Stream.filter((state) => state.phase === "connected"),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
      const target = {
        cwd,
        threadId: ThreadId.make("git-thread"),
        projectId: ProjectId.make("git-project"),
      };
      yield* Effect.promise(async () => {
        const git = client.git;
        NodeAssert.ok(git, "this server speaks the current protocol");

        // Status sees an edit, and a commit with a message clears it.
        NodeFS.writeFileSync(NodePath.join(cwd, "src", "beta.ts"), "export const beta = 2;\n");
        const dirty = await git.status(registry, cwd);
        NodeAssert.equal(dirty.refName, "main");
        NodeAssert.equal(dirty.hasWorkingTreeChanges, true);
        const committed = await git.run(registry, target, {
          action: "commit",
          commitMessage: "Add beta",
        });
        NodeAssert.equal(committed.commit.status, "created");
        NodeAssert.equal(run(cwd, "log", "-1", "--format=%s"), "Add beta");
        NodeAssert.equal((await git.status(registry, cwd)).hasWorkingTreeChanges, false);

        // Branches: create switches, and switching back moves the checkout.
        NodeAssert.equal(await git.createRef(registry, { cwd, refName: "feature" }), "feature");
        NodeAssert.equal(run(cwd, "branch", "--show-current"), "feature");
        const refs = await git.listRefs(registry, cwd);
        NodeAssert.deepEqual(refs.map((ref) => ref.name).toSorted(), ["feature", "main"]);
        await git.switchRef(registry, { cwd, refName: "main" });
        NodeAssert.equal(run(cwd, "branch", "--show-current"), "main");

        // A push with no remote fails with a message, and the checkout is untouched.
        await NodeAssert.rejects(
          git.run(registry, target, { action: "push" }),
          (failure) => failure instanceof Error && failure.message.length > 0,
        );

        // Pull from a real upstream.
        const upstream = NodePath.join(fixture.root, "upstream.git");
        run(fixture.root, "init", "--bare", "-b", "main", upstream);
        run(cwd, "remote", "add", "origin", upstream);
        run(cwd, "push", "-u", "origin", "main");
        const pulled = await git.pull(registry, cwd);
        NodeAssert.equal(pulled.status, "skipped_up_to_date");

        // Pushing a branch that has no upstream publishes it.
        await git.switchRef(registry, { cwd, refName: "feature" });
        NodeFS.writeFileSync(NodePath.join(cwd, "src", "gamma.ts"), "export const gamma = 3;\n");
        const published = await git.run(registry, target, {
          action: "commit_push",
          commitMessage: "Add gamma",
        });
        NodeAssert.equal(published.push.status, "pushed");
        NodeAssert.equal(published.push.setUpstream, true);
        NodeAssert.equal(run(upstream, "log", "-1", "--format=%s", "feature"), "Add gamma");

        // The rest of the composer and plan paths.
        const search = await client.searchProjectEntries(registry, {
          cwd,
          query: "alpha",
          limit: 5,
        });
        NodeAssert.ok(search.entries.some((entry) => entry.path === "src/alpha.ts"));
        NodeAssert.equal(
          await client.writeProjectFile(registry, {
            cwd,
            relativePath: "plan.md",
            contents: "# Plan\n",
          }),
          true,
        );
        NodeAssert.equal(NodeFS.readFileSync(NodePath.join(cwd, "plan.md"), "utf8"), "# Plan\n");

        // Answering a request that does not exist fails without echoing the value.
        const secret = "never-echo-this-value";
        await NodeAssert.rejects(
          client.answerSecretRequest(registry, {
            threadId: target.threadId,
            turnItemId: TurnItemId.make("missing"),
            answer: { type: "save", secret },
          }),
          (failure) => !String(failure?.message).includes(secret),
        );
      });
    }).pipe(Effect.scoped),
  120_000,
);
