import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
const source = NodeURL.fileURLToPath(
  new URL("../../server/src/provider/testFixtures/", import.meta.url),
);

export async function preparePeer(root, scenario) {
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
  peer = peer.replace(
    'if (method === "turn/start") {',
    'if (method === "thread/read" || method === "thread/revert") { write({ id, result: { thread: { ...fixture.responses.threadStart.thread, historyMode: "paginated", turns: [] } } }); return; }\n  if (method === "thread/turns/list") { write({ id, result: { data: [fixture.responses.turnStart.turn], nextCursor: null } }); return; }\n  if (method === "turn/start") {',
  );
  await NodeFSP.writeFile(NodePath.join(directory, "codexCollabMockPeer.mjs"), peer);
  await NodeFSP.writeFile(
    NodePath.join(directory, "codexMultiAgentWire.json"),
    JSON.stringify(wire).replaceAll("/workspace/repo", NodePath.join(root, "workspace")),
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
        isBlocking: true,
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
  NodeChildProcess.execFileSync(
    "git",
    [
      "-C",
      workspace,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Initial checkpoint",
    ],
    { stdio: "ignore" },
  );
  return {
    T3_CODEX_COLLAB_SCRIPT: scriptPath,
    CODEX_HOME: NodePath.join(root, "codex-home"),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.test",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.test",
  };
}
