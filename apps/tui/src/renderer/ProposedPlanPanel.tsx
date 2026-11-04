import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useRenderer } from "@opentui/react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useContext, useMemo, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import {
  planExportContents,
  planFilename,
  planIsActionable,
} from "../features/chat/proposedPlan.ts";
import { useUi } from "../ui/context.tsx";
import { FormInput, FormRow } from "../ui/FormField.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { markdownLines } from "../ui/markdownLines.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { EmptyState } from "../ui/StateMessage.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

const STATUS_NOTE = {
  draft: "Still being written.",
  active: "",
  completed: "Already implemented.",
  superseded: "A newer plan replaced this one.",
} as const;

/** The thread's latest proposed plan, with everything that can be done with it. */
export function ProposedPlanPanel({
  client,
  threadId,
  cwd,
  active,
  width,
  height,
  onClose,
  onRefine,
  onOpenThread,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly cwd: string | null;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
  readonly onRefine: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const registry = useContext(RegistryContext);
  const renderer = useRenderer();
  const { capabilities } = useUi();
  const thread = Option.getOrNull(useAtomValue(client.thread(threadId)).data);
  const plan = thread?.proposedPlan ?? null;
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const [savePath, setSavePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = useMemo(
    () => (plan ? markdownLines(plan.markdown, width, true, capabilities.unicode) : []),
    [plan, width, capabilities.unicode],
  );
  const rows = Math.max(1, height - 2);
  const maximum = Math.max(0, lines.length - rows);
  const start = Math.min(offset, maximum);
  const scroll = (next: number) => setOffset(Math.max(0, Math.min(maximum, next)));
  const actionable = plan !== null && planIsActionable(plan) && !busy;
  const running = thread?.latestTurn?.state === "running";
  const implement = async () => {
    if (!plan || !actionable) return;
    setBusy(true);
    if (await client.actions.implementPlan(registry, threadId, plan)) onClose();
    else {
      setBusy(false);
      setStatus({ text: "The plan was not sent. Check the thread for the reason.", failed: true });
    }
  };
  const implementInNewThread = async () => {
    if (!plan || !thread || !actionable) return;
    setBusy(true);
    const created = await client.implementPlanInNewThread(registry, thread, plan);
    if (created) {
      onClose();
      onOpenThread(created);
    } else {
      setBusy(false);
      setStatus({ text: "The new thread was not created.", failed: true });
    }
  };
  const save = async (relativePath: string) => {
    if (!plan || !cwd || busy) return;
    setBusy(true);
    const saved = await client.writeProjectFile(registry, {
      cwd,
      relativePath,
      contents: planExportContents(plan.markdown),
    });
    setBusy(false);
    setSavePath(null);
    setStatus(
      saved
        ? { text: `Saved to ${relativePath}.`, failed: false }
        : { text: `Could not save ${relativePath}.`, failed: true },
    );
  };
  useKeyLayer("plan", {
    active: active && savePath === null,
    modal: true,
    bindings: {
      "plan.close": onClose,
      "plan.up": () => scroll(start - 1),
      "plan.down": () => scroll(start + 1),
      "plan.pageUp": () => scroll(start - rows),
      "plan.pageDown": () => scroll(start + rows),
      "plan.implement": { enabled: actionable && !running, run: implement },
      "plan.implementNew": { enabled: actionable, run: implementInNewThread },
      "plan.refine": { enabled: actionable, run: onRefine },
      "plan.copy": {
        enabled: plan !== null,
        run: () => {
          const copied = plan ? renderer.copyToClipboardOSC52(plan.markdown) : false;
          setStatus(
            copied
              ? { text: "Plan copied.", failed: false }
              : { text: "Copy unavailable in this terminal.", failed: true },
          );
        },
      },
      "plan.save": {
        enabled: plan !== null && cwd !== null,
        run: () => {
          if (plan) setSavePath(planFilename(plan.markdown));
        },
      },
    },
  });
  useKeyLayer("planSave", {
    active: active && savePath !== null,
    modal: true,
    typing: true,
    bindings: {
      "planSave.confirm": {
        enabled: Boolean(savePath?.trim()) && !busy,
        run: () => {
          if (savePath?.trim()) void save(savePath.trim());
        },
      },
      "planSave.cancel": () => setSavePath(null),
    },
  });
  if (!plan) return <EmptyState title="This thread has no proposed plan yet." />;
  const note =
    status?.text ??
    (running && actionable ? "The agent is still working." : STATUS_NOTE[plan.status]);
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <Stack height={rows} flexShrink={0} flexDirection="column" overflow="hidden">
        <Text height={rows} wrapMode="none">
          {lines
            .slice(start, start + rows)
            .map((line) => line.text)
            .join("\n")}
        </Text>
      </Stack>
      {savePath !== null ? (
        <FormRow label="Save as">
          <FormInput id="plan-save-path" value={savePath} focused={active} onInput={setSavePath} />
        </FormRow>
      ) : (
        <Text
          height={1}
          flexShrink={0}
          wrapMode="none"
          truncate
          tone={status?.failed ? "danger" : "muted"}
        >
          {inlineTerminalText(note)}
        </Text>
      )}
      <Text height={1} flexShrink={0} wrapMode="none" truncate tone="muted">
        {lines.length > rows
          ? `Lines ${start + 1}-${Math.min(lines.length, start + rows)} of ${lines.length}`
          : ""}
      </Text>
    </Stack>
  );
}
