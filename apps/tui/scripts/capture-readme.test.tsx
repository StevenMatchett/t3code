// Opt-in documentation capture. Uses the real renderer with synthetic, local-only data.
// From apps/tui: T3_TUI_MEDIA_DIR=../../docs/media/tui node scripts/run-with-node-ffi.mjs \
//   ../../node_modules/vite-plus/bin/vp test run --root . scripts/capture-readme.test.tsx
// Requires ImageMagick, FFmpeg, and the DejaVu Sans Mono font.
import { it, expect } from "@effect/vitest";
import { TextAttributes, type CapturedFrame, type RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import {
  CheckpointRef,
  EventId,
  MessageId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { EMPTY_TERMINAL_BUFFER_STATE } from "@t3tools/client-runtime/state/terminal";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { act } from "react";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { makeClientFixture } from "../src/testing/clientFixture.ts";
import { createTuiTestDriver } from "../src/testing/driver.tsx";
import { AppShell } from "../src/renderer/AppShell.tsx";

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const color = (value: RGBA) => `rgb(${value.toInts().slice(0, 3).join(",")})`;

function svg(frame: CapturedFrame) {
  const cell = 12,
    line = 24,
    padding = 24,
    top = 60;
  const width = frame.cols * cell + padding * 2;
  const height = frame.rows * line + top + padding;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="#0d1117"/>`,
    `<text x="24" y="32" font-family="DejaVu Sans Mono" font-size="16" fill="#8b949e">T3 TUI / interactive demo</text>`,
    `<g font-family="DejaVu Sans Mono" font-size="20" xml:space="preserve">`,
  ];
  frame.lines.forEach((row, y) => {
    let column = 0;
    for (const span of row.spans) {
      const x = padding + column * cell;
      const py = top + y * line;
      const inverse = (span.attributes & TextAttributes.INVERSE) !== 0;
      const bg = inverse ? span.fg : span.bg;
      const fg = inverse ? span.bg : span.fg;
      if (bg.a > 0)
        parts.push(
          `<rect x="${x}" y="${py}" width="${span.width * cell}" height="${line}" fill="${color(bg)}"/>`,
        );
      if (span.text.trim())
        parts.push(
          `<text x="${x}" y="${py + 19}" fill="${color(fg)}" font-weight="${span.attributes & TextAttributes.BOLD ? "bold" : "normal"}">${escapeXml(span.text)}</text>`,
        );
      column += span.width;
    }
  });
  return `${parts.join("\n")}</g></svg>`;
}

it.skipIf(!process.env.T3_TUI_MEDIA_DIR)(
  "captures README screenshots and scripted walkthroughs",
  async () => {
    const output = NodePath.resolve(process.env.T3_TUI_MEDIA_DIR!);
    const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-tui-media-"));
    NodeFS.mkdirSync(output, { recursive: true });
    const fixture = makeClientFixture();
    const registry = AtomRegistry.make();
    const releases = [
      ...fixture.states.map((state) => registry.mount(state)),
      registry.mount(fixture.providers),
    ];
    registry.update(fixture.providers, (catalog) => ({
      ...catalog,
      providers: catalog.providers.map((provider) => ({
        ...provider,
        displayName: "Codex",
        models: provider.models.map((model, index) => ({
          ...model,
          name: index === 0 ? "GPT-5 Codex" : model.name,
        })),
      })),
    }));
    const now = new Date().toISOString();
    const turnId = TurnId.make("demo-turn");
    const latestTurn = {
      turnId,
      state: "running" as const,
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      assistantMessageId: null,
    };
    const activities: OrchestrationThreadActivity[] = [];
    function activity(kind: string, summary: string, payload: Record<string, unknown>) {
      const event = {
        id: EventId.make(`demo-${activities.length}`),
        kind,
        summary,
        payload,
        tone: "tool" as const,
        turnId,
        sequence: activities.length + 1,
        createdAt: now,
      };
      activities.push(event);
      return event;
    }
    const thread = {
      ...fixture.details[0]!,
      title: "Add project search",
      latestTurn,
      messages: [
        {
          id: MessageId.make("demo-user"),
          role: "user" as const,
          text: "Add project search with keyboard navigation.\nKeep the current filters when I switch threads.",
          turnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: MessageId.make("demo-assistant"),
          role: "assistant" as const,
          text: "## Project search\n\nI found the project list and its navigation state.\n\n- Filter by project name or workspace path\n- Keep the search query when switching threads\n- Use **Up / Down** to select, **Enter** to open\n\n### Implementation\n\n```ts\nconst visible = projects.filter((project) =>\n  project.title.toLowerCase().includes(query)\n);\n```\n\nI am checking the empty-state and keyboard behavior next.",
          turnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      checkpoints: [
        {
          turnId,
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("refs/checkpoints/demo"),
          status: "ready" as const,
          files: [],
          assistantMessageId: null,
          completedAt: now,
        },
      ],
    };
    registry.update(fixture.states[0]!, (state) => ({ ...state, data: Option.some(thread) }));
    Object.assign(fixture.details[0]!, thread);
    const diff = [
      "diff --git a/src/projects/search.ts b/src/projects/search.ts",
      "--- a/src/projects/search.ts",
      "+++ b/src/projects/search.ts",
      "@@ -1,5 +1,10 @@",
      " export function searchProjects(projects, query) {",
      "-  return projects;",
      "+  const needle = query.trim().toLowerCase();",
      "+  return projects.filter((project) => {",
      "+    const searchable = [",
      "+      project.title, project.workspaceRoot,",
      "+    ].join(' ').toLowerCase();",
      "+    return searchable.includes(needle);",
      "+  });",
      " }",
      " ",
      " export const defaultQuery = '';",
      "diff --git a/src/projects/search.test.ts b/src/projects/search.test.ts",
      "--- a/src/projects/search.test.ts",
      "+++ b/src/projects/search.test.ts",
      "@@ -0,0 +1,4 @@",
      "+it('finds a project by workspace path', () => {",
      "+  const matches = searchProjects(projects, 'waypoint');",
      "+  expect(matches).toHaveLength(1);",
      "+});",
    ].join("\n");
    const client = {
      ...fixture.client,
      label: "Local development",
      diffs: {
        ...fixture.client.diffs,
        fullThreadDiff: ({ input }: Parameters<typeof fixture.client.diffs.fullThreadDiff>[0]) =>
          Atom.make(AsyncResult.success({ ...input, diff })),
      },
    };
    const driver = await createTuiTestDriver(<AppShell client={client} searchDebounceMs={0} />, {
      registry,
      width: 112,
      height: 32,
      kittyKeyboard: true,
    });
    const frames: Record<string, string> = {};
    const capture = async (name: string, contains: string) => {
      await driver.flush();
      expect(driver.captureFrame()).toContain(contains);
      const source = NodePath.join(scratch, `${name}.svg`);
      NodeFS.writeFileSync(source, svg(driver.captureSpans()));
      const target = NodePath.join(output, `${name}.png`);
      NodeChildProcess.execFileSync("magick", ["-background", "#0d1117", source, "-strip", target]);
      frames[name] = target;
    };
    const updateActivities = async () => {
      await act(async () =>
        registry.update(fixture.states[0]!, (state) => ({
          ...state,
          data: Option.map(state.data, (value) => ({ ...value, activities: [...activities] })),
        })),
      );
      await driver.flush();
    };
    try {
      await act(async () =>
        registry.update(fixture.shell, (state) => ({
          ...state,
          snapshot: Option.map(state.snapshot, (snapshot) => ({
            ...snapshot,
            projects: snapshot.projects.map((project, index) => ({
              ...project,
              title: index === 0 ? "Waypoint" : "Design system",
              workspaceRoot: index === 0 ? "/workspace/waypoint" : "/workspace/design-system",
            })),
            threads: snapshot.threads.map((value, index) => ({
              ...value,
              title: ["Add project search", "Improve onboarding", "Keyboard navigation"][index]!,
            })),
          })),
        })),
      );
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("RETURN");
      await capture("conversation", "Project search");
      await driver.input.pressKey("i");
      await driver.input.typeText("Also add a test for searching by workspace path.");
      await capture("compose", "Also add a test");
      await driver.input.pressKey("RETURN");
      await capture("queued-message", "Queued (1)");
      activity("tool.completed", "Read project navigation", {
        toolCallId: "read-navigation",
        detail: "Read src/projects/navigation.ts",
      });
      await updateActivities();
      await capture("message-sent", "Queued message sent.");
      await driver.input.pressKey("ESCAPE");
      activity("task.started", "Search implementation", {
        taskId: "builder",
        taskType: "subagent",
        agentKind: "agent",
        title: "Search implementation",
        model: "gpt-5.6-luna",
      });
      activity("tool.started", "Update search matching", {
        agentId: "builder",
        toolCallId: "edit-search",
        itemType: "fileChange",
        detail:
          "Match project titles and workspace paths, ignoring case.\n\nFiles under review:\n  src/projects/search.ts\n  src/projects/search.test.ts\n\nChecks:\n  Preserve the current query when opening a thread\n  Keep the selected row visible while filtering\n  Return all projects when the query is empty\n\nNext: run the focused search tests.",
      });
      activity("task.started", "Keyboard review", {
        taskId: "reviewer",
        taskType: "subagent",
        agentKind: "agent",
        title: "Keyboard review",
        model: "gpt-5.6-luna",
      });
      activity("task.progress", "Check focus and selection", {
        taskId: "reviewer",
        agentKind: "agent",
        summary: "Reviewing arrow keys, Enter, and Escape behavior.",
      });
      await updateActivities();
      await capture("agent-swarm", "Show agents (2)");
      const agent = driver.renderer.root.findDescendantById("agent-row-builder")!;
      await driver.mouse.click(agent.screenX + 2, agent.screenY, MouseButtons.LEFT, { delayMs: 0 });
      await capture("agent-output", "Agent: Search implementation");
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("d");
      await capture("diff-review", "search.ts");
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("k", { ctrl: true });
      await driver.input.typeText("workspace path");
      await capture("command-palette", "Search and commands");
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("t", { ctrl: true });
      const terminalText =
        "\u001b[32m$\u001b[0m git status --short\r\n M src/projects/search.ts\r\n M src/projects/search.test.ts\r\n\r\n\u001b[32m$\u001b[0m vp test run src/projects/search.test.ts\r\n\r\n \u001b[32mPASS\u001b[0m src/projects/search.test.ts\r\n   Finds projects by name\r\n   Finds projects by workspace path\r\n   Keeps matching case-insensitive\r\n\r\n Test Files  \u001b[32m1 passed\u001b[0m\r\n      Tests  \u001b[32m3 passed\u001b[0m\r\n\r\n\u001b[32m$\u001b[0m ";
      await act(async () =>
        registry.set(
          fixture.terminalBuffer,
          AsyncResult.success({
            ...EMPTY_TERMINAL_BUFFER_STATE,
            status: "running",
            version: 1,
            output: {
              generation: 1,
              resetVersion: 0,
              nextOffset: terminalText.length,
              retainedBytes: Buffer.byteLength(terminalText),
              chunks: [
                { startOffset: 0, data: terminalText, byteLength: Buffer.byteLength(terminalText) },
              ],
            },
          }),
        ),
      );
      await capture("terminal", "search.test.ts");
      const movie = (name: string, sequence: string[]) => {
        const manifest = NodePath.join(scratch, `${name}.txt`);
        NodeFS.writeFileSync(
          manifest,
          [
            ...sequence.flatMap((frame) => [`file '${frames[frame]}'`, "duration 2.5"]),
            `file '${frames[sequence.at(-1)!]}'`,
          ].join("\n"),
        );
        NodeChildProcess.execFileSync("ffmpeg", [
          "-v",
          "error",
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          manifest,
          "-vf",
          "fps=12",
          "-t",
          String(sequence.length * 2.5),
          "-c:v",
          "libx264",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          NodePath.join(output, `${name}.mp4`),
        ]);
        NodeChildProcess.execFileSync("ffmpeg", [
          "-v",
          "error",
          "-y",
          "-i",
          NodePath.join(output, `${name}.mp4`),
          "-filter_complex",
          "fps=4,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
          "-loop",
          "0",
          NodePath.join(output, `${name}.gif`),
        ]);
      };
      movie("queue-walkthrough", ["conversation", "compose", "queued-message", "message-sent"]);
      movie("review-walkthrough", [
        "agent-swarm",
        "agent-output",
        "agent-swarm",
        "diff-review",
        "terminal",
      ]);
    } finally {
      releases.forEach((release) => release());
      await driver.close();
      NodeFS.rmSync(scratch, { recursive: true, force: true });
    }
  },
  120_000,
);
