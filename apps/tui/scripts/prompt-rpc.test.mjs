import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { AtomRegistry } from "effect/reactivity";
import {
  CommandId,
  WS_METHODS,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  ORCHESTRATION_V2_WS_METHODS,
} from "@t3tools/contracts";
import { createTuiClient } from "../dist/connection/clientRuntime.js";
import {
  makeTerminalEnvironmentFixture,
  openTerminalFixtureConnection,
} from "./terminal-fixture.mjs";

import { preparePeer } from "./provider-peer-fixture.mjs";

it.live.each(["complete", "interrupt", "approval", "question", "choices"])(
  "sends a prompt and handles %s through a real T3 server and synthetic Codex peer",
  (scenario) =>
    Effect.gen(function* () {
      const fixture = yield* makeTerminalEnvironmentFixture({
        serverEntryPath: process.env.TUI_TEST_SERVER_ENTRY,
        prepare: (root) => preparePeer(root, scenario),
      });
      const seed = yield* openTerminalFixtureConnection(fixture);
      const command = seed.client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand];
      const projectId = ProjectId.make("prompt-project");
      const threadId = ThreadId.make("prompt-thread");
      const modelSelection = {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      };
      yield* (
        fixture.readiness.descriptor.orchestrationProtocolVersion === 1
          ? command
          : seed.client[WS_METHODS.projectsMutate]
      )({
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
        createdBy: "user",
        creationSource: "web",
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
        NodeAssert.equal(client.actions.selectSkill(registry, threadId, provider.skills[0]), true);
      }
      const expectedPrompt =
        scenario === "choices"
          ? "$fixture-review Synthetic prompt from the TUI"
          : "Synthetic prompt from the TUI";
      NodeAssert.equal(yield* Effect.promise(() => client.actions.send(registry, threadId)), true);
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

      if (scenario === "interrupt") {
        const running = yield* waitFor((thread) => thread.latestTurn?.state === "running");
        NodeAssert.ok(running.latestTurn.turnId);
        NodeAssert.equal(
          yield* Effect.promise(() => client.actions.interrupt(registry, threadId)),
          true,
        );
      } else if (scenario === "approval") {
        const thread = yield* waitFor((value) => value.requests.approvals.length > 0);
        const request = thread.requests.approvals[0];
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
        const thread = yield* waitFor((value) => value.requests.userInputs.length > 0);
        const request = thread.requests.userInputs[0];
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
      if (scenario === "complete") {
        yield* waitFor((thread) => thread.checkpoints.length > 0);
        const prompt = finished.messages.find((message) => message.role === "user");
        NodeAssert.equal(
          yield* Effect.promise(() =>
            client.actions.restoreCheckpoint(registry, threadId, prompt.id, false).then((ok) => {
              if (!ok) throw new Error(registry.get(client.actions.state(threadId)).error);
              return ok;
            }),
          ),
          true,
        );
        const rewound = yield* waitFor((thread) => thread.messages.length === 0);
        NodeAssert.equal(rewound.latestTurn, null);
        NodeAssert.equal(registry.get(client.actions.state(threadId)).draft, expectedPrompt);
      }
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
        NodeAssert.equal(
          interrupt.turnId,
          JSON.parse(
            yield* Effect.promise(() =>
              NodeFSP.readFile(
                NodePath.join(fixture.root, "peer/codexMultiAgentWire.json"),
                "utf8",
              ),
            ),
          ).responses.turnStart.turn.id,
        );
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
