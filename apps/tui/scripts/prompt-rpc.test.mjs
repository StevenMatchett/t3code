import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import { it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import {
  CommandId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  ORCHESTRATION_WS_METHODS,
} from "@t3tools/contracts";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import {
  makeTerminalEnvironmentFixture,
  openTerminalFixtureConnection,
} from "./terminal-fixture.mjs";

const source = NodeURL.fileURLToPath(
  new URL("../../server/src/provider/testFixtures/", import.meta.url),
);

async function preparePeer(root, scenario) {
  const directory = NodePath.join(root, "peer");
  await NodeFSP.mkdir(directory);
  const wire = JSON.parse(
    await NodeFSP.readFile(NodePath.join(source, "codexMultiAgentWire.json"), "utf8"),
  );
  let peer = await NodeFSP.readFile(NodePath.join(source, "codexCollabMockPeer.mjs"), "utf8");
  peer = peer.replace(
    "    write({ id, result: {} });\n    return;\n  }\n  if (id !== undefined)",
    '    write({ id, result: {} });\n    write({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: script.rootThreadId, turn: { ...activeTurn, status: "interrupted" } } });\n    return;\n  }\n  if (id !== undefined)',
  );
  peer = peer.replace(
    "write({ id, result: { data: [] } });",
    'write({ id, result: { data: method === "skills/list" ? script.skills ?? [] : script.models ?? [], nextCursor: null } });',
  );
  peer = peer.replace(
    'if (method === "turn/start") {',
    'if (method === "turn/start") {\n    NodeFS.appendFileSync(`${process.env.T3_CODEX_COLLAB_SCRIPT}.turns`, `${JSON.stringify(message.params)}\\n`);',
  );
  await NodeFSP.writeFile(NodePath.join(directory, "codexCollabMockPeer.mjs"), peer);
  await NodeFSP.copyFile(
    NodePath.join(source, "codexMultiAgentWire.json"),
    NodePath.join(directory, "codexMultiAgentWire.json"),
  );
  await NodeFSP.copyFile(
    NodePath.join(source, "codexCollabMockPeer.sh"),
    NodePath.join(directory, "codex"),
  );
  await NodeFSP.chmod(NodePath.join(directory, "codex"), 0o755);
  const threadId = wire.rootThreadId;
  const turnId = wire.responses.turnStart.turn.id;
  const script = {
    rootThreadId: threadId,
    holdTurnOpen: scenario !== "complete" && scenario !== "choices",
    completeTurnOnServerResponse: true,
    notifications: [
      {
        method: "item/agentMessage/delta",
        params: {
          threadId,
          turnId,
          itemId: "fixture-message",
          delta: "Synthetic agent response\n\n",
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: {
            type: "agentMessage",
            id: "fixture-message",
            text: "Synthetic agent response\n\n",
            phase: "final_answer",
          },
        },
      },
    ],
    serverRequests: [],
  };
  if (scenario === "approval")
    script.serverRequests.push({
      id: 7001,
      method: "mcpServer/elicitation/request",
      params: {
        mode: "form",
        message: "Allow the synthetic tool?",
        serverName: "fixture-tool",
        threadId,
        turnId,
        requestedSchema: {
          type: "object",
          properties: { approval: { type: "string", enum: ["once", "session", "always"] } },
          required: ["approval"],
        },
      },
    });
  if (scenario === "question")
    script.serverRequests.push({
      id: 7002,
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId,
        itemId: "question-item",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Choose scope",
            isOther: false,
            isSecret: false,
            options: [
              { label: "Small", description: "Small change" },
              { label: "Large", description: "Large change" },
            ],
          },
        ],
      },
    });
  if (scenario === "choices") {
    script.models = [
      {
        id: "fixture-model-b",
        model: "fixture-model-b",
        displayName: "Fixture Model B",
        description: "Synthetic test",
        hidden: false,
        isDefault: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Quick" },
          { reasoningEffort: "high", description: "Deep" },
        ],
        defaultReasoningEffort: "low",
        inputModalities: ["text"],
        supportsPersonality: false,
        upgrade: null,
        upgradeInfo: null,
        availabilityNux: null,
        defaultServiceTier: null,
        serviceTiers: [],
        additionalSpeedTiers: [],
      },
    ];
    script.skills = [
      {
        cwd: NodePath.join(root, "workspace"),
        errors: [],
        skills: [
          {
            name: "fixture-review",
            path: NodePath.join(root, "workspace/.agents/skills/fixture-review/SKILL.md"),
            description: "Synthetic review skill",
            enabled: true,
            scope: "repo",
            interface: null,
            dependencies: null,
            shortDescription: null,
          },
        ],
      },
    ];
  }
  const scriptPath = NodePath.join(directory, "script.json");
  await NodeFSP.writeFile(scriptPath, JSON.stringify(script));
  const state = NodePath.join(root, "state", "userdata");
  await NodeFSP.mkdir(state, { recursive: true });
  const config = {
    enabled: true,
    binaryPath: NodePath.join(directory, "codex"),
    homePath: NodePath.join(root, "codex-home"),
  };
  await NodeFSP.writeFile(
    NodePath.join(state, "settings.json"),
    JSON.stringify({
      responseStreamingMode: "token",
      enableLegacyTokenStreaming: true,
      providers: { codex: config },
      providerInstances: { codex: { driver: "codex", enabled: true, config } },
    }),
  );
  const workspace = NodePath.join(root, "workspace");
  await NodeFSP.mkdir(workspace);
  NodeChildProcess.execFileSync("git", ["init", "-b", "main", workspace], { stdio: "ignore" });
  return {
    T3_CODEX_COLLAB_SCRIPT: scriptPath,
    CODEX_HOME: NodePath.join(root, "codex-home"),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.test",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.test",
  };
}

for (const scenario of ["complete", "interrupt", "approval", "question", "choices"]) {
  it.live(
    `sends a prompt and handles ${scenario} through a real T3 server and synthetic Codex peer`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeTerminalEnvironmentFixture({
          serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
          prepare: (root) => preparePeer(root, scenario),
        });
        const seed = yield* openTerminalFixtureConnection(fixture);
        const command = seed.client[ORCHESTRATION_WS_METHODS.dispatchCommand];
        const projectId = ProjectId.make("prompt-project");
        const threadId = ThreadId.make("prompt-thread");
        const modelSelection = {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        };
        yield* command({
          type: "project.create",
          commandId: CommandId.make("prompt-project-create"),
          projectId,
          title: "Prompt fixture",
          workspaceRoot: NodePath.join(fixture.root, "workspace"),
          defaultModelSelection: modelSelection,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
        yield* command({
          type: "thread.create",
          commandId: CommandId.make("prompt-thread-create"),
          projectId,
          threadId,
          title: "Prompt fixture",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:01.000Z",
        });
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
        const unmount = registry.mount(client.thread(threadId));
        yield* Effect.addFinalizer(() => Effect.sync(unmount));
        yield* AtomRegistry.toStream(registry, client.connection).pipe(
          Stream.filter((state) => state.phase === "connected"),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("15 seconds"),
        );
        const waitFor = (predicate) =>
          AtomRegistry.toStream(registry, client.thread(threadId)).pipe(
            Stream.filter(
              (state) =>
                state.status === "live" && Option.isSome(state.data) && predicate(state.data.value),
            ),
            Stream.take(1),
            Stream.runCollect,
            Effect.map((values) => values[0].data.value),
            Effect.timeout("20 seconds"),
          );
        yield* waitFor(() => registry.get(client.connection).phase === "connected");
        client.actions.setDraft(registry, threadId, "Synthetic prompt from the TUI");
        if (scenario === "choices") {
          const unmountProviders = registry.mount(client.providers);
          yield* Effect.addFinalizer(() => Effect.sync(unmountProviders));
          const unmountShell = registry.mount(client.shell);
          yield* Effect.addFinalizer(() => Effect.sync(unmountShell));
          const catalogs = yield* AtomRegistry.toStream(registry, client.providers).pipe(
            Stream.filter(
              (value) =>
                value.status === "live" &&
                value.providers.some((provider) =>
                  provider.models.some((model) => model.slug === "fixture-model-b"),
                ),
            ),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout("15 seconds"),
          );
          const provider = catalogs[0].providers.find((item) => item.instanceId === "codex");
          // Warm the workspace cache, then simulate a model catalog changing upstream.
          NodeAssert.equal(
            yield* Effect.promise(() => client.refreshProvider(registry, threadId, false)),
            true,
          );
          yield* Effect.promise(async () => {
            const scriptPath = NodePath.join(fixture.root, "peer", "script.json");
            const script = JSON.parse(await NodeFSP.readFile(scriptPath, "utf8"));
            script.models[0] = {
              ...script.models[0],
              id: "fixture-model-c",
              model: "fixture-model-c",
              displayName: "Fixture Model C",
            };
            await NodeFSP.writeFile(scriptPath, JSON.stringify(script));
          });
          NodeAssert.equal(
            yield* Effect.promise(() => client.refreshProvider(registry, threadId, true)),
            true,
          );
          yield* AtomRegistry.toStream(registry, client.providers).pipe(
            Stream.filter((value) =>
              value.providers.some(
                (item) =>
                  item.instanceId === provider.instanceId &&
                  item.models.some((model) => model.slug === "fixture-model-c") &&
                  !item.models.some((model) => model.slug === "fixture-model-b"),
              ),
            ),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout("15 seconds"),
          );
          NodeAssert.equal(
            yield* Effect.promise(() =>
              client.actions.changeModel(registry, threadId, {
                instanceId: provider.instanceId,
                model: "fixture-model-c",
                options: [{ id: "reasoningEffort", value: "high" }],
              }),
            ),
            true,
          );
          yield* waitFor((thread) => thread.modelSelection.model === "fixture-model-c");
          client.actions.observe(registry, threadId);
          NodeAssert.equal(
            client.actions.selectSkill(registry, threadId, provider.skills[0]),
            true,
          );
        }
        const expectedPrompt =
          scenario === "choices"
            ? "$fixture-review Synthetic prompt from the TUI"
            : "Synthetic prompt from the TUI";
        NodeAssert.equal(
          yield* Effect.promise(() => client.actions.send(registry, threadId)),
          true,
        );
        const visible = yield* waitFor((thread) =>
          thread.messages.some(
            (message) =>
              message.role === "assistant" && message.text.includes("Synthetic agent response"),
          ),
        );
        NodeAssert.ok(
          visible.messages.some(
            (message) => message.role === "user" && message.text === expectedPrompt,
          ),
        );
        let interruptedTurnId = null;
        if (scenario === "interrupt") {
          const running = yield* waitFor((thread) => thread.latestTurn?.state === "running");
          interruptedTurnId = running.latestTurn.turnId;
          NodeAssert.equal(
            yield* Effect.promise(() => client.actions.interrupt(registry, threadId)),
            true,
          );
        } else if (scenario === "approval") {
          const thread = yield* waitFor(
            (value) => derivePendingRequests(value.activities).approvals.length > 0,
          );
          const request = derivePendingRequests(thread.activities).approvals[0];
          NodeAssert.equal(
            yield* Effect.promise(() =>
              client.actions.reply(registry, threadId, {
                kind: "approval",
                requestId: request.requestId,
                decision: "accept",
              }),
            ),
            true,
          );
        } else if (scenario === "question") {
          const thread = yield* waitFor(
            (value) => derivePendingRequests(value.activities).userInputs.length > 0,
          );
          const request = derivePendingRequests(thread.activities).userInputs[0];
          const question = request.questions[0];
          const option = question.options[0];
          NodeAssert.equal(
            yield* Effect.promise(() =>
              client.actions.reply(registry, threadId, {
                kind: "user-input",
                requestId: request.requestId,
                answers: { [question.id]: option.value ?? option.label },
              }),
            ),
            true,
          );
        }
        const finished = yield* waitFor((thread) =>
          scenario === "interrupt"
            ? thread.latestTurn?.state === "interrupted" || thread.latestTurn?.state === "completed"
            : thread.latestTurn?.state === "completed",
        );
        NodeAssert.equal(finished.messages.filter((message) => message.role === "user").length, 1);
        if (scenario === "choices") {
          const turn = JSON.parse(
            (yield* Effect.promise(() =>
              NodeFSP.readFile(NodePath.join(fixture.root, "peer/script.json.turns"), "utf8"),
            )).trim(),
          );
          NodeAssert.equal(turn.model, "fixture-model-c");
          NodeAssert.equal(turn.effort, "high");
          NodeAssert.ok(
            turn.input.some((item) => item.type === "text" && item.text.includes(expectedPrompt)),
          );
        }
        if (scenario === "interrupt") {
          const interrupt = JSON.parse(
            (yield* Effect.promise(() =>
              NodeFSP.readFile(NodePath.join(fixture.root, "peer/script.json.interrupts"), "utf8"),
            )).trim(),
          );
          NodeAssert.equal(interrupt.turnId, interruptedTurnId);
        }
        if (scenario === "approval" || scenario === "question") {
          const response = JSON.parse(
            (yield* Effect.promise(() =>
              NodeFSP.readFile(NodePath.join(fixture.root, "peer/script.json.responses"), "utf8"),
            )).trim(),
          );
          NodeAssert.equal(response.id, scenario === "approval" ? 7001 : 7002);
          NodeAssert.equal(response.error, undefined);
          if (scenario === "approval") NodeAssert.equal(response.result.action, "accept");
          else NodeAssert.deepEqual(response.result.answers.scope.answers, ["Small"]);
        }
      }).pipe(Effect.scoped),
    45_000,
  );
}
