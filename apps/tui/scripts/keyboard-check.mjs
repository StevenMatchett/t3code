import { AtomRegistry } from "effect/unstable/reactivity";
import { useKeyboard } from "@opentui/react";
import { createElement, useState } from "react";

import { PromptEditor } from "../dist/renderer/PromptEditor.js";
import { startRendererRuntime } from "../dist/renderer/runtime.js";

// Local-only probe: retain Enter metadata, never draft text or other keystrokes.
const events = [];
const result = { events, submissions: 0 };
const finished = Promise.withResolvers();

function recordSubmission() {
  result.submissions += 1;
}

function KeyboardCheck() {
  const [draft, setDraft] = useState("");
  const [last, setLast] = useState("Waiting for Enter...");
  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      key.preventDefault();
      key.stopPropagation();
      finished.resolve();
      return;
    }
    if (key.name !== "return" && key.name !== "enter" && key.name !== "linefeed") return;
    const event = {
      name: key.name,
      shift: key.shift,
      ctrl: key.ctrl,
      sequence: key.sequence,
    };
    events.push(event);
    setLast(JSON.stringify(event));
  });
  return createElement(
    "box",
    { flexDirection: "column" },
    createElement("text", {}, "Press Enter, then Shift+Enter, then Esc. Nothing is sent or saved."),
    createElement("text", {}, last),
    createElement(PromptEditor, {
      value: draft,
      onChange: setDraft,
      onSubmit: recordSubmission,
      focused: true,
    }),
    createElement("text", {}, `Editor lines: ${draft.split("\n").length}`),
  );
}

const runtime = await startRendererRuntime({
  registry: AtomRegistry.make(),
  children: createElement(KeyboardCheck),
  onError: (error) => finished.reject(error),
});
try {
  await finished.promise;
} finally {
  await runtime.close();
}
process.stdout.write(`Keyboard check: ${JSON.stringify(result)}\n`);
