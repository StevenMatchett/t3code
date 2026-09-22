import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import type { MessageId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useContext, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { checkpointRestoreTargets } from "../features/chat/checkpointRestore.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

export function CheckpointRestore({
  client,
  threadId,
  active,
  height,
  onClose,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly height: number;
  readonly onClose: (restored?: boolean) => void;
}) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(client.thread(threadId));
  const interaction = useAtomValue(client.actions.state(threadId));
  const page = Option.getOrNull(state.page);
  const thread = Option.getOrNull(state.data);
  const targets = thread ? checkpointRestoreTargets(thread).toReversed() : [];
  const [cursor, setCursor] = useState(0);
  const [messageId, setMessageId] = useState<MessageId | null>(null);
  const [choice, setChoice] = useState(0);
  const selected = Math.min(cursor, Math.max(0, targets.length - 1));
  const pending = interaction.pending === "rewind";
  const target = targets.find((entry) => entry.message.id === messageId);
  const choose = async (index: number) => {
    if (pending) return;
    if (index === 0) {
      setMessageId(null);
      return;
    }
    if (!target) return;
    if (await client.actions.restoreCheckpoint(registry, threadId, target.message.id, index === 1))
      onClose(true);
  };
  const select = (id: MessageId) => {
    setMessageId(id);
    setChoice(0);
  };
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") {
      if (pending) return;
      if (messageId) setMessageId(null);
      else onClose();
    } else if (pending) return;
    else if (key.name === "up" || key.name === "down" || key.name === "tab") {
      const offset = key.name === "up" || (key.name === "tab" && key.shift) ? -1 : 1;
      if (messageId) setChoice((choice + offset + 3) % 3);
      else setCursor(Math.max(0, Math.min(targets.length - 1, selected + offset)));
    } else if (key.name === "return" || key.name === "enter") {
      if (key.repeated) return;
      if (messageId) void choose(choice);
      else if (targets[selected]) select(targets[selected].message.id);
    } else if (key.name === "l" && !messageId && page?.hasMore && !page.loadingOlder) {
      client.loadOlder(threadId);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  const count = Math.max(1, height - 7);
  const start = Math.max(0, selected - count + 1);
  return (
    <Stack flexDirection="column" width="100%" height="100%" gap={1}>
      <Text strong>{messageId ? "Edit from here?" : "Select a prompt to edit from"}</Text>
      {messageId ? (
        <>
          <Text>
            Rewind chat to before this message. Your prompt and attachments return to the composer.
          </Text>
          <Text tone="muted">
            {inlineTerminalText(
              target?.message.text ?? "The selected message is no longer available.",
            )}
          </Text>
          <Text tone="warning">
            Reverting files also discards workspace changes after this checkpoint.
          </Text>
          {["Cancel", "Revert files too", "Revert and keep changes"].map((label, index) => (
            <Stack
              key={label}
              height={1}
              onMouseDown={(event) => {
                if (!active || event.button !== 0 || pending) return;
                event.preventDefault();
                event.stopPropagation();
                void choose(index);
              }}
            >
              <SelectionRow selected={choice === index} active={active && !pending} label={label} />
            </Stack>
          ))}
        </>
      ) : (
        <>
          <Stack flexGrow={1} flexDirection="column" overflow="hidden">
            {targets.length === 0 ? (
              <Text tone="muted">No checkpointed prompts available.</Text>
            ) : (
              targets.slice(start, start + count).map((entry, index) => (
                <Stack
                  key={entry.message.id}
                  height={1}
                  onMouseDown={(event) => {
                    if (!active || event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    select(entry.message.id);
                  }}
                >
                  <SelectionRow
                    selected={start + index === selected}
                    active={active}
                    label={inlineTerminalText(
                      `Before turn ${entry.turnCount + 1} · ${entry.message.text}`,
                    )}
                  />
                </Stack>
              ))
            )}
          </Stack>
          {page?.hasMore ? <Text tone="muted">L Load older prompts</Text> : null}
        </>
      )}
      {pending ? <Text tone="warning">Rewinding chat… Waiting for the environment.</Text> : null}
      {interaction.error ? <Text tone="danger">{interaction.error}</Text> : null}
      <Text tone="muted">↑↓ Select · Enter Confirm · Esc Back</Text>
    </Stack>
  );
}
