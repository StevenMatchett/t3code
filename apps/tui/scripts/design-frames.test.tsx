// Opt-in design feedback loop. Run through scripts/design-frames.mjs, never as part of the suite.
import { PlanId, TurnItemId } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { act } from "react";

import { AppShell } from "../src/renderer/AppShell.tsx";
import { basicTerminalCapabilities, richTerminalCapabilities } from "../src/ui/capabilities.ts";
import { UiProvider } from "../src/ui/context.tsx";
import { createTuiTestDriver, type TuiTestDriver } from "../src/testing/driver.tsx";
import {
  assistantMessage,
  designAgents,
  designApproval,
  designQuestion,
  longTranscript,
  makeDesignFixture,
  runningTurn,
  updateShellThread,
  updateThread,
  type DesignFixture,
} from "../src/testing/designFixture.ts";
import { frameToSvg } from "../src/testing/frameImage.ts";

const output = process.env.T3_TUI_FRAMES_DIR;
const only = process.env.T3_TUI_FRAMES_ONLY ? new RegExp(process.env.T3_TUI_FRAMES_ONLY) : null;
const images = process.env.T3_TUI_FRAMES_IMAGES !== "0";

type Harness = { readonly driver: TuiTestDriver; readonly fixture: DesignFixture };
type Step = (harness: Harness, capture: (label: string) => Promise<void>) => Promise<void>;

const openConversation = async ({ driver }: Harness) => {
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
};
const set = async (
  { driver, fixture }: Harness,
  index: number,
  update: Parameters<typeof updateThread>[3],
) => {
  await act(async () => updateThread(driver.registry, fixture, index, update));
  await driver.flush();
};

/** Screens captured once in each size. */
const screens: Record<string, (harness: Harness) => Promise<void>> = {
  projects: async () => {},
  threads: async ({ driver }) => driver.input.pressKey("RETURN"),
  recent: async ({ driver }) => driver.input.pressKey("b", { ctrl: true }),
  archived: async ({ driver }) => {
    await driver.input.pressKey("b", { ctrl: true });
    await driver.input.pressKey("b", { ctrl: true });
  },
  inbox: async ({ driver, fixture }) => {
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("inbox sidebar");
    await driver.input.pressKey("RETURN");
    await act(async () => {
      const seen = { lastVisitedAt: "2026-03-02T15:00:00.000Z" };
      updateShellThread(driver.registry, fixture, 0, (thread) => ({ ...thread, ...seen }));
      updateShellThread(driver.registry, fixture, 1, (thread) => ({
        ...thread,
        latestTurn: runningTurn,
      }));
      updateShellThread(driver.registry, fixture, 2, (thread) => ({
        ...thread,
        hasPendingApprovals: true,
        pinnedAt: "2026-03-02T15:00:00.000Z",
        branch: "t3/keyboard-navigation-audit-with-a-long-name",
      }));
    });
    await driver.flush();
  },
  conversation: openConversation,
  composer: async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("i");
    await harness.driver.input.typeText("Also add a test for searching by workspace path.");
  },
  running: async (harness) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({
      ...thread,
      latestTurn: runningTurn,
      messages: [...thread.messages, assistantMessage("stream", "Checking the empty state", true)],
    }));
  },
  approval: async (harness) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({ ...thread, requests: designApproval() }));
  },
  question: async (harness) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({ ...thread, requests: designQuestion() }));
  },
  plan: async (harness) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({
      ...thread,
      proposedPlan: {
        id: PlanId.make("plan-1"),
        status: "active",
        markdown:
          "# Add project search\n\n## Summary\n\nIndex the projects and filter them as you type.\n\n## Steps\n\n1. Build the index in `src/projects/search.ts`.\n2. Add the filter input with Up and Down to move.\n3. Keep the query when switching threads.\n\n## Risks\n\n- Large workspaces may need the index built in the background.\n",
      },
    }));
    await harness.driver.input.pressKey("l", { ctrl: true });
  },
  mention: async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("i");
    await harness.driver.input.typeText("Check @search");
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    await harness.driver.flush();
  },
  slash: async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("i");
    await harness.driver.input.typeText("/");
    await harness.driver.flush();
  },
  secret: async (harness) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({
      ...thread,
      secretRequests: [
        {
          id: TurnItemId.make("secret-1"),
          threadId: thread.id,
          label: "GitHub token",
          reason:
            "The agent needs a token with repo scope to open the pull request for this branch.",
        },
      ],
    }));
    await harness.driver.input.typeText("ghp_example");
    await harness.driver.flush();
  },
  queue: async (harness) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({ ...thread, latestTurn: runningTurn }));
    await harness.driver.input.pressKey("i");
    await harness.driver.input.typeText("Then update the docs.");
    await harness.driver.input.pressKey("RETURN");
  },
  agents: async (harness) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({ ...thread, agents: designAgents() }));
    await harness.driver.input.pressKey("TAB");
  },
  find: async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("/");
    await harness.driver.input.typeText("search");
  },
  "model-menu": async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("i");
    await harness.driver.input.pressKey("TAB");
    await harness.driver.input.pressKey("RETURN");
  },
  palette: async ({ driver }) => driver.input.pressKey("k", { ctrl: true }),
  "palette-commands": async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("k", { ctrl: true });
    await harness.driver.input.typeText(">");
  },
  help: async ({ driver }) => driver.input.typeText("?"),
  "help-conversation": async (harness) => {
    await openConversation(harness);
    await harness.driver.input.typeText("?");
  },
  diff: async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("d");
  },
  restore: async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("e");
  },
  "new-thread": async ({ driver }) => driver.input.pressKey("n"),
  "new-project": async ({ driver }) => driver.input.pressKey("p"),
  manage: async ({ driver }) => {
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("m");
  },
  favorites: async ({ driver }) => {
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("favorite models");
    await driver.input.pressKey("RETURN");
  },
  theme: async ({ driver }) => {
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("theme");
    await driver.input.pressKey("RETURN");
  },
  "light-theme": async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("k", { ctrl: true });
    await harness.driver.input.typeText("theme");
    await harness.driver.input.pressKey("RETURN");
    await harness.driver.input.pressKey("ARROW_DOWN");
    await harness.driver.input.pressKey("ARROW_DOWN");
  },
  terminal: async (harness) => {
    await openConversation(harness);
    await harness.driver.input.pressKey("t", { ctrl: true });
  },
  "empty-workspace": async ({ driver, fixture }) => {
    await act(async () =>
      driver.registry.update(fixture.shell, (shell) => ({
        ...shell,
        snapshot: Option.map(shell.snapshot, (snapshot) => ({
          ...snapshot,
          projects: [],
          threads: [],
        })),
      })),
    );
    await driver.flush();
  },
  "loading-workspace": async ({ driver, fixture }) => {
    await act(async () =>
      driver.registry.update(fixture.shell, (shell) => ({
        ...shell,
        snapshot: Option.none(),
        status: "connecting" as never,
      })),
    );
    await driver.flush();
  },
  offline: async (harness) => {
    await openConversation(harness);
    const { driver, fixture } = harness;
    await act(async () =>
      driver.registry.update(fixture.client.connection as never, (state: object) => ({
        ...state,
        phase: "backoff",
      })),
    );
    await driver.flush();
  },
  "loading-thread": async (harness) => {
    await openConversation(harness);
    const { driver, fixture } = harness;
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...EMPTY_ENVIRONMENT_THREAD_STATE,
        data: Option.none(),
      }),
    );
    await driver.flush();
  },
};

/** Interaction sequences: one frame per step, so jumps and flicker are visible. */
const sequences: Record<string, Step> = {
  "thread-switch": async (harness, capture) => {
    await harness.driver.input.pressKey("RETURN");
    await capture("thread-list");
    await harness.driver.input.pressKey("RETURN");
    await capture("opened-first");
    await harness.driver.input.pressKey("ESCAPE");
    await capture("back-to-list");
    await harness.driver.input.pressKey("ARROW_DOWN");
    await capture("selected-second");
    await harness.driver.input.pressKey("RETURN");
    await capture("opened-second");
    await harness.driver.input.pressKey("ESCAPE");
    await harness.driver.input.pressKey("ARROW_UP");
    await harness.driver.input.pressKey("RETURN");
    await capture("back-on-first");
  },
  overlay: async (harness, capture) => {
    await openConversation(harness);
    await capture("base");
    await harness.driver.input.pressKey("k", { ctrl: true });
    await capture("palette");
    await harness.driver.input.pressKey("ESCAPE");
    await capture("palette-closed");
    await harness.driver.input.pressKey("d");
    await capture("diff");
    await harness.driver.input.pressKey("ESCAPE");
    await capture("diff-closed");
    await harness.driver.input.typeText("?");
    await capture("help");
    await harness.driver.input.pressKey("ESCAPE");
    await capture("help-closed");
  },
  streaming: async (harness, capture) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({ ...thread, latestTurn: runningTurn }));
    await capture("started");
    let text = "";
    for (const [step, part] of [
      "I am checking the empty state ",
      "and the keyboard behaviour next. ",
      "The filter keeps its query when ",
      "you switch threads.\n\n- first point\n",
      "- second point\n\n```ts\nconst query = 1;\n```",
    ].entries()) {
      text += part;
      const current = text;
      await set(harness, 0, (thread) => ({
        ...thread,
        messages: [
          ...thread.messages.filter((item) => item.id !== "stream"),
          assistantMessage("stream", current, true),
        ],
      }));
      await capture(`chunk-${step}`);
    }
  },
  scrolling: async (harness, capture) => {
    await set(harness, 0, (thread) => ({ ...thread, messages: longTranscript(80) }));
    await openConversation(harness);
    await capture("live-edge");
    await harness.driver.input.pressKey("ARROW_UP");
    await capture("up-1");
    await harness.driver.input.pressKey("\u001b[5~");
    await capture("page-up");
    await set(harness, 0, (thread) => ({
      ...thread,
      messages: [...thread.messages, assistantMessage("late", "A late reply arrives")],
    }));
    await capture("late-output-while-reading");
    await harness.driver.input.pressKey("END");
    await capture("end-returns-to-live");
  },
  resize: async (harness, capture) => {
    await set(harness, 0, (thread) => ({ ...thread, messages: longTranscript(80) }));
    await openConversation(harness);
    await harness.driver.input.pressKey("\u001b[5~");
    await capture("reading");
    await harness.driver.resize(100, 30);
    await capture("resized-100x30");
    await harness.driver.resize(60, 20);
    await capture("resized-60x20");
  },
  approve: async (harness, capture) => {
    await openConversation(harness);
    await set(harness, 0, (thread) => ({ ...thread, latestTurn: runningTurn }));
    await capture("running");
    await set(harness, 0, (thread) => ({ ...thread, requests: designApproval() }));
    await capture("approval-arrives");
    await harness.driver.input.pressKey("ARROW_UP");
    await capture("choice-moves");
    await harness.driver.input.pressKey("RETURN");
    await capture("response-sent");
    await set(harness, 0, (thread) => ({
      ...thread,
      requests: { approvals: [], userInputs: [] },
    }));
    await capture("resolved");
  },
};

const sizes = [
  { name: "80x24", width: 80, height: 24 },
  { name: "120x40", width: 120, height: 40 },
  { name: "200x60", width: 200, height: 60 },
];

async function withHarness(
  { width, height, ascii = false }: { width: number; height: number; ascii?: boolean },
  run: (harness: Harness) => Promise<void>,
) {
  const fixture = makeDesignFixture();
  const driver = await createTuiTestDriver(
    <UiProvider capabilities={ascii ? basicTerminalCapabilities : richTerminalCapabilities}>
      <AppShell
        client={{
          ...fixture.client,
          threadCapabilities: Atom.make({
            repositoryIdentity: true,
            threadPinning: true,
            threadPinReorder: true,
            threadSettlement: true,
            threadSnooze: true,
            threadVisitedTracking: true,
          }),
        }}
        searchDebounceMs={0}
      />
    </UiProvider>,
    { width, height, kittyKeyboard: true },
  );
  const releases = fixture.states.map((state) => driver.registry.mount(state));
  try {
    await act(async () => updateShellThread(driver.registry, fixture, 0, (thread) => thread));
    await run({ driver, fixture });
    await driver.flush();
  } finally {
    releases.forEach((release) => release());
    await driver.close();
  }
}

function write(directory: string, name: string, driver: TuiTestDriver, title: string) {
  NodeFS.mkdirSync(directory, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(directory, `${name}.txt`), driver.captureFrame() + "\n");
  if (!images) return;
  const svg = NodePath.join(directory, `${name}.svg`);
  NodeFS.writeFileSync(svg, frameToSvg(driver.captureSpans(), { title }));
  try {
    NodeChildProcess.execFileSync("rsvg-convert", [
      "-o",
      NodePath.join(directory, `${name}.png`),
      svg,
    ]);
    NodeFS.rmSync(svg);
  } catch {
    // Keep the SVG when no converter is installed.
  }
}

it.skipIf(!output)(
  "renders canonical screens and interaction sequences",
  async () => {
    const failures: string[] = [];
    const attempt = async (label: string, run: () => Promise<void>) => {
      if (only && !only.test(label)) return;
      try {
        await run();
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    for (const [name, scene] of Object.entries(screens)) {
      for (const size of sizes) {
        await attempt(`${size.name}/${name}`, () =>
          withHarness(size, async (harness) => {
            await scene(harness);
            await harness.driver.flush();
            write(NodePath.join(output!, size.name), name, harness.driver, `${name} ${size.name}`);
          }),
        );
      }
      await attempt(`ascii/${name}`, () =>
        withHarness({ width: 80, height: 24, ascii: true }, async (harness) => {
          await scene(harness);
          await harness.driver.flush();
          write(NodePath.join(output!, "ascii-no-color"), name, harness.driver, `${name} ascii`);
        }),
      );
    }
    for (const [name, sequence] of Object.entries(sequences)) {
      for (const size of sizes) {
        await attempt(`sequence/${size.name}/${name}`, () =>
          withHarness(size, async (harness) => {
            let step = 0;
            await sequence(harness, async (label) => {
              await harness.driver.flush();
              write(
                NodePath.join(output!, "sequences", size.name, name),
                `${String(step++).padStart(2, "0")}-${label}`,
                harness.driver,
                `${name} / ${label}`,
              );
            });
          }),
        );
      }
    }
    if (failures.length) throw new Error(`Scenes failed:\n${failures.join("\n")}`);
  },
  600_000,
);
