import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import { it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { CommandId, ProjectId, ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import {
  makeTerminalEnvironmentFixture,
  openTerminalFixtureConnection,
} from "./terminal-fixture.mjs";

const peerSource = NodeURL.fileURLToPath(
  new URL("../../server/src/provider/testFixtures/", import.meta.url),
);
const gitEnv = (root) => ({
  PATH: `${NodePath.dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: root,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: NodeOS.devNull,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.test",
});
const git = (root, cwd, ...args) =>
  NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], {
    env: gitEnv(root),
    encoding: "utf8",
  }).trim();

async function prepare(root) {
  const peer = NodePath.join(root, "peer");
  const workspace = NodePath.join(root, "workspace");
  const state = NodePath.join(root, "state", "userdata");
  await Promise.all([
    NodeFSP.mkdir(peer),
    NodeFSP.mkdir(workspace),
    NodeFSP.mkdir(state, { recursive: true }),
  ]);
  const wire = JSON.parse(
    await NodeFSP.readFile(NodePath.join(peerSource, "codexMultiAgentWire.json"), "utf8"),
  );
  let source = await NodeFSP.readFile(NodePath.join(peerSource, "codexCollabMockPeer.mjs"), "utf8");
  source = source.replace(
    'if (method === "turn/start") {',
    'if (method === "turn/start") {\n    NodeFS.appendFileSync(`${process.env.T3_CODEX_COLLAB_SCRIPT}.turns`, `${JSON.stringify({ cwd: process.cwd(), input: message.params.input })}\\n`);',
  );
  source = source.replace(
    "write({ id, result: { data: [] } });",
    'write({ id, result: { data: method === "model/list" ? script.models : [], nextCursor: null } });',
  );
  await NodeFSP.writeFile(NodePath.join(peer, "codexCollabMockPeer.mjs"), source);
  await NodeFSP.copyFile(
    NodePath.join(peerSource, "codexMultiAgentWire.json"),
    NodePath.join(peer, "codexMultiAgentWire.json"),
  );
  await NodeFSP.copyFile(
    NodePath.join(peerSource, "codexCollabMockPeer.sh"),
    NodePath.join(peer, "codex"),
  );
  await NodeFSP.chmod(NodePath.join(peer, "codex"), 0o755);
  const scriptPath = NodePath.join(peer, "script.json");
  const model = {
    id: "gpt-fixture",
    model: "gpt-fixture",
    displayName: "Fixture model",
    description: "Synthetic test",
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "low",
    inputModalities: ["text"],
    supportsPersonality: false,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    defaultServiceTier: null,
    serviceTiers: [],
    additionalSpeedTiers: [],
  };
  await NodeFSP.writeFile(
    scriptPath,
    JSON.stringify({ rootThreadId: wire.rootThreadId, notifications: [], models: [model] }),
  );
  const config = {
    enabled: true,
    binaryPath: NodePath.join(peer, "codex"),
    homePath: NodePath.join(root, "codex-home"),
  };
  await NodeFSP.writeFile(
    NodePath.join(state, "settings.json"),
    JSON.stringify({
      providers: { codex: config },
      providerInstances: { codex: { driver: "codex", enabled: true, config } },
    }),
  );
  git(root, workspace, "init", "-b", "main");
  await NodeFSP.writeFile(NodePath.join(workspace, "tracked.txt"), "committed content\n");
  git(root, workspace, "add", "tracked.txt");
  git(root, workspace, "commit", "-m", "Synthetic worktree fixture");
  await NodeFSP.writeFile(NodePath.join(workspace, "tracked.txt"), "uncommitted content\n");
  return {
    ...gitEnv(root),
    T3_CODEX_COLLAB_SCRIPT: scriptPath,
    CODEX_HOME: NodePath.join(root, "codex-home"),
  };
}

it.live(
  "creates checkout and worktree threads on the server without launching an agent, then runs the worktree prompt in that worktree",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeTerminalEnvironmentFixture({
        serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
        prepare,
      });
      const seed = yield* openTerminalFixtureConnection(fixture);
      const workspace = NodePath.join(fixture.root, "workspace");
      const projectId = ProjectId.make("new-thread-project");
      yield* seed.client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
        type: "project.create",
        commandId: CommandId.make("new-thread-project-create"),
        projectId,
        title: "Creation fixture",
        workspaceRoot: workspace,
        defaultModelSelection: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const client = createTuiClient({
        readiness: fixture.readiness,
        bearer: fixture.environment.bearer,
      });
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() => AtomRegistry.make()),
        (value) => Effect.sync(() => value.dispose()),
      );
      const waitAtom = (atom, predicate) =>
        AtomRegistry.toStream(registry, atom).pipe(
          Stream.filter(predicate),
          Stream.take(1),
          Stream.runCollect,
          Effect.map((values) => values[0]),
          Effect.timeout("20 seconds"),
        );
      for (const atom of [client.connection, client.shell, client.providers]) {
        const unmount = registry.mount(atom);
        yield* Effect.addFinalizer(() => Effect.sync(unmount));
      }
      yield* waitAtom(client.connection, (value) => value.phase === "connected");
      yield* waitAtom(
        client.shell,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.snapshot) &&
          value.snapshot.value.projects.some((project) => project.id === projectId),
      );
      const catalog = yield* waitAtom(
        client.providers,
        (value) =>
          value.status === "live" &&
          value.providers.some(
            (provider) =>
              provider.instanceId === "codex" && provider.installed && provider.models.length > 0,
          ),
      );
      const provider = catalog.providers.find((item) => item.instanceId === "codex");
      const modelSelection = { instanceId: provider.instanceId, model: provider.models[0].slug };
      const request = {
        projectId,
        title: "Checkout thread",
        mode: "local",
        baseRef: "HEAD",
        modelSelection,
        runtimeMode: "auto",
      };
      const localId = yield* Effect.promise(() => client.newThreads.create(registry, request));
      NodeAssert.ok(localId);
      let shared = yield* waitAtom(
        client.shell,
        (value) =>
          Option.isSome(value.snapshot) &&
          value.snapshot.value.threads.some((thread) => thread.id === localId),
      );
      NodeAssert.equal(
        shared.snapshot.value.threads.find((thread) => thread.id === localId).worktreePath,
        null,
      );
      client.newThreads.reset(registry);
      const treeId = yield* Effect.promise(() =>
        client.newThreads.create(registry, {
          ...request,
          title: "Worktree thread",
          mode: "worktree",
        }),
      );
      NodeAssert.ok(treeId);
      shared = yield* waitAtom(
        client.shell,
        (value) =>
          Option.isSome(value.snapshot) &&
          value.snapshot.value.threads.some(
            (thread) => thread.id === treeId && thread.worktreePath,
          ),
      );
      const thread = shared.snapshot.value.threads.find((item) => item.id === treeId);
      NodeAssert.ok(thread.worktreePath.startsWith(fixture.root));
      NodeAssert.match(thread.branch, /^t3-tui\/[a-f0-9]+$/);
      NodeAssert.equal(
        yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(thread.worktreePath, "tracked.txt"), "utf8"),
        ),
        "committed content\n",
      );
      NodeAssert.equal(
        yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(workspace, "tracked.txt"), "utf8"),
        ),
        "uncommitted content\n",
      );
      NodeAssert.equal(git(fixture.root, workspace, "branch", "--show-current"), "main");
      NodeAssert.equal(
        git(fixture.root, thread.worktreePath, "branch", "--show-current"),
        thread.branch,
      );
      yield* Effect.promise(() =>
        NodeAssert.rejects(NodeFSP.access(NodePath.join(fixture.root, "peer/script.json.turns")), {
          code: "ENOENT",
        }),
      );
      const other = createTuiClient({
        readiness: fixture.readiness,
        bearer: fixture.environment.bearer,
      });
      const otherRegistry = yield* Effect.acquireRelease(
        Effect.sync(() => AtomRegistry.make()),
        (value) => Effect.sync(() => value.dispose()),
      );
      const observed = yield* AtomRegistry.toStream(otherRegistry, other.shell).pipe(
        Stream.filter(
          (value) =>
            Option.isSome(value.snapshot) &&
            value.snapshot.value.threads.some((item) => item.id === treeId),
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("15 seconds"),
      );
      NodeAssert.equal(
        observed[0].snapshot.value.threads.find((item) => item.id === treeId).worktreePath,
        thread.worktreePath,
      );
      const unmountThread = registry.mount(client.thread(treeId));
      yield* Effect.addFinalizer(() => Effect.sync(unmountThread));
      const details = yield* waitAtom(
        client.thread(treeId),
        (value) => value.status === "live" && Option.isSome(value.data),
      );
      NodeAssert.equal(details.data.value.messages.length, 0);
      client.actions.setDraft(registry, treeId, "Synthetic worktree prompt");
      NodeAssert.equal(yield* Effect.promise(() => client.actions.send(registry, treeId)), true);
      yield* waitAtom(
        client.thread(treeId),
        (value) => Option.isSome(value.data) && value.data.value.latestTurn?.state === "completed",
      );
      const turn = JSON.parse(
        (yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(fixture.root, "peer/script.json.turns"), "utf8"),
        )).trim(),
      );
      NodeAssert.equal(
        yield* Effect.promise(() => NodeFSP.realpath(turn.cwd)),
        yield* Effect.promise(() => NodeFSP.realpath(thread.worktreePath)),
      );
      NodeAssert.equal(git(fixture.root, workspace, "branch", "--show-current"), "main");
      client.newThreads.reset(registry);
      const beforeFailure = Option.getOrThrow(registry.get(client.shell).snapshot).threads.length;
      NodeAssert.equal(
        yield* Effect.promise(() =>
          client.newThreads.create(registry, {
            ...request,
            mode: "worktree",
            baseRef: "missing-ref-tui-fixture",
          }),
        ),
        null,
      );
      NodeAssert.equal(registry.get(client.newThreads.state).phase, "error");
      NodeAssert.equal(registry.get(client.newThreads.state).attempt.worktree, null);
      NodeAssert.equal(
        Option.getOrThrow(registry.get(client.shell).snapshot).threads.length,
        beforeFailure,
      );
      NodeAssert.equal(git(fixture.root, workspace, "branch", "--show-current"), "main");
    }).pipe(Effect.scoped),
  60_000,
);
