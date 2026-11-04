import type { TuiActivity, TuiThread, TuiThreadShell } from "../connection/models.ts";
import { CheckpointRef, EventId, MessageId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { TuiSessionState } from "../persistence/sessionState.ts";
import { makeClientFixture } from "./clientFixture.ts";
import { requestFixture } from "./requestFixture.ts";
import { agentFixture } from "./agentFixture.ts";

const time = "2026-03-02T15:04:05.000Z";
const turnId = TurnId.make("design-turn");

const assistantMarkdown = `## Project search

I found the project list and its navigation state in \`src/projects/navigation.ts\`.

- Filter by project name or workspace path
- Keep the query when switching threads
- Use **Up / Down** to select and **Enter** to open

\`\`\`ts
const visible = projects.filter((project) =>
  project.title.toLowerCase().includes(query),
);
\`\`\`

See the [search docs](https://example.com/search) for the matching rules.`;

export const designDiff = [
  "diff --git a/src/projects/search.ts b/src/projects/search.ts",
  "--- a/src/projects/search.ts",
  "+++ b/src/projects/search.ts",
  "@@ -1,5 +1,10 @@",
  " export function searchProjects(projects, query) {",
  "-  return projects;",
  "+  const needle = query.trim().toLowerCase();",
  "+  return projects.filter((project) => {",
  "+    return project.title.toLowerCase().includes(needle);",
  "+  });",
  " }",
  "diff --git a/src/projects/search.test.ts b/src/projects/search.test.ts",
  "--- a/src/projects/search.test.ts",
  "+++ b/src/projects/search.test.ts",
  "@@ -0,0 +1,4 @@",
  "+it('finds a project by workspace path', () => {",
  "+  expect(searchProjects(projects, 'waypoint')).toHaveLength(1);",
  "+});",
].join("\n");

function message(id: string, role: "user" | "assistant", text: string, streaming = false) {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId,
    streaming,
    createdAt: time,
    updatedAt: time,
  };
}

function toolActivity(id: string, summary: string, detail: string, kind = "tool.completed") {
  return {
    id: EventId.make(id),
    kind,
    summary,
    tone: "tool" as const,
    turnId,
    payload: { toolCallId: id, detail },
    sequence: 1,
    createdAt: time,
  } as unknown as TuiActivity;
}

const completedTurn = {
  turnId,
  state: "completed" as const,
  requestedAt: "2026-03-02T15:01:00.000Z",
  startedAt: "2026-03-02T15:01:01.000Z",
  completedAt: "2026-03-02T15:03:12.000Z",
  assistantMessageId: null,
};

/** A recognisable workspace for frames, feel checks, and performance measurements. */
export function makeDesignFixture(session?: TuiSessionState) {
  const fixture = makeClientFixture(undefined, undefined, session);
  const titles = ["Add project search", "Improve onboarding copy", "Keyboard navigation audit"];
  const projectNames = [
    { title: "Atlas", root: "/home/dev/code/atlas" },
    { title: "Design system", root: "/home/dev/code/design-system" },
  ];
  fixture.projects.forEach((project, index) =>
    Object.assign(project, {
      title: projectNames[index]!.title,
      workspaceRoot: projectNames[index]!.root,
    }),
  );
  const conversation: Partial<TuiThread> = {
    latestTurn: completedTurn,
    branch: "t3/project-search",
    messages: [
      message(
        "design-user",
        "user",
        "Add project search with keyboard navigation.\nKeep the filters when I switch threads.",
      ),
      message("design-assistant", "assistant", assistantMarkdown),
    ],
    activities: [
      toolActivity("read-1", "Read files", "Read src/projects/navigation.ts"),
      toolActivity("edit-1", "Edit search matching", "Edited src/projects/search.ts"),
    ],
    checkpoints: [
      {
        turnId,
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("refs/checkpoints/design"),
        status: "ready" as const,
        files: [
          { path: "src/projects/search.ts", kind: "modified", additions: 5, deletions: 1 },
          { path: "src/projects/search.test.ts", kind: "added", additions: 3, deletions: 0 },
        ],
        assistantMessageId: null,
        completedAt: time,
      },
    ],
  };
  fixture.details.forEach((thread, index) =>
    Object.assign(thread, { title: titles[index] }, index === 0 ? conversation : {}),
  );
  fixture.threads.forEach((thread, index) =>
    Object.assign(thread, { title: titles[index] }, index === 0 ? conversation : {}),
  );
  const client: typeof fixture.client = {
    ...fixture.client,
    label: "Local workspace",
    diffs: {
      ...fixture.client.diffs,
      fullThreadDiff: () =>
        Atom.make(
          AsyncResult.success({
            threadId: fixture.details[0]!.id,
            fromTurnCount: 0,
            toTurnCount: 1,
            diff: designDiff,
          }),
        ),
    },
  };
  const first = fixture.details[0]!;
  return { ...fixture, client, first };
}

export type DesignFixture = ReturnType<typeof makeDesignFixture>;

export function updateThread(
  registry: AtomRegistry.AtomRegistry,
  fixture: DesignFixture,
  index: number,
  update: (thread: TuiThread) => TuiThread,
) {
  registry.update(fixture.states[index]!, (state) => ({
    ...state,
    data: Option.map(state.data, update),
  }));
}

export function updateShellThread(
  registry: AtomRegistry.AtomRegistry,
  fixture: DesignFixture,
  index: number,
  update: (thread: TuiThreadShell) => TuiThreadShell,
) {
  registry.update(fixture.shell, (shell) => ({
    ...shell,
    snapshot: Option.map(shell.snapshot, (snapshot) => ({
      ...snapshot,
      threads: snapshot.threads.map((thread) =>
        thread.id === fixture.details[index]!.id ? update(thread) : thread,
      ),
    })),
  }));
}

export const runningTurn = {
  turnId: TurnId.make("running-turn"),
  state: "running" as const,
  requestedAt: "2026-03-02T15:01:00.000Z",
  startedAt: "2026-03-02T15:01:01.000Z",
  completedAt: null,
  assistantMessageId: null,
};

export const designApproval = () =>
  requestFixture("approval", {
    requestId: "approval-1",
    requestKind: "command",
    detail:
      "Run: pnpm test src/projects/search.test.ts\nWorking directory: /home/dev/code/waypoint",
  });

export const designQuestion = () =>
  requestFixture("user-input", {
    requestId: "question-1",
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "Should search include archived projects?",
        options: [
          { label: "Active only", description: "Keep results short." },
          { label: "Include archived", description: "Show everything." },
        ],
      },
    ],
  });

export const designAgents = () => [
  agentFixture("builder", "Search implementation", "gpt-5.6-luna"),
  agentFixture("reviewer", "Keyboard review", "gpt-5.6-luna"),
];

/** Long transcript for scrolling, streaming, and input-latency measurement. */
export function longTranscript(rows: number) {
  const messages = [];
  const at = (offset: number) => new Date(Date.UTC(2026, 2, 2, 12, 0, offset)).toISOString();
  for (let index = 0; index < rows; index += 2) {
    messages.push(
      {
        ...message(`long-user-${index}`, "user", `Prompt ${index}: keep going with the next step.`),
        createdAt: at(index),
      },
      {
        ...message(
          `long-assistant-${index}`,
          "assistant",
          `Reply ${index}: finished step ${index} with a **short** summary, \`inline code\`, and enough text that it wraps once on a narrow terminal.`,
        ),
        createdAt: at(index + 1),
      },
    );
  }
  return messages;
}

/** A message newer than everything in the fixture, as a live reply would be. */
export const assistantMessage = (id: string, text: string, streaming = false) => ({
  ...message(id, "assistant", text, streaming),
  createdAt: "2026-12-01T00:00:00.000Z",
});

export const DESIGN_THREAD_IDS = ["thread-0", "thread-1", "thread-2"].map((id) =>
  ThreadId.make(id),
);
export const DESIGN_PROJECT_IDS = ["alpha", "beta"].map((id) => ProjectId.make(id));
