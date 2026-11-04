import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { MessageId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useContext, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { checkpointRestoreTargets } from "../features/chat/checkpointRestore.ts";
import { ListFilterRow } from "../ui/FormField.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { ListView } from "../ui/ListView.tsx";
import { EmptyState } from "../ui/StateMessage.tsx";
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
  const page = state.history;
  const thread = Option.getOrNull(state.data);
  const [filter, setFilter] = useState<string | null>(null);
  const needle = filter?.trim().toLocaleLowerCase();
  const targets = (thread ? checkpointRestoreTargets(thread).toReversed() : []).filter(
    (entry) => !needle || entry.message.text.toLocaleLowerCase().includes(needle),
  );
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
  const move = (offset: number) => {
    if (messageId) setChoice((choice + offset + 3) % 3);
    else setCursor(Math.max(0, Math.min(targets.length - 1, selected + offset)));
  };
  useKeyLayer("restore", {
    active,
    modal: true,
    typing: filter !== null,
    bindings: {
      "restore.back": () => {
        if (pending) return;
        if (filter !== null) setFilter(null);
        else if (messageId) setMessageId(null);
        else onClose();
      },
      "restore.filter": {
        enabled: !pending && !messageId && filter === null,
        run: () => {
          setFilter("");
          setCursor(0);
        },
      },
      "restore.up": {
        enabled: !pending,
        run: (key) => {
          if (filter !== null && key?.name !== "up") return false;
          move(-1);
        },
      },
      "restore.down": {
        enabled: !pending,
        run: (key) => {
          if (filter !== null && key?.name !== "down") return false;
          move(1);
        },
      },
      "restore.confirm": {
        enabled: !pending,
        run: () => {
          if (messageId) void choose(choice);
          else if (targets[selected]) select(targets[selected].message.id);
        },
      },
      "restore.loadOlder": {
        enabled:
          !pending &&
          !messageId &&
          filter === null &&
          Boolean(page?.hasMoreHistory) &&
          !page?.loading,
        run: () => {
          client.loadOlder(registry, threadId);
        },
      },
    },
  });
  const count = Math.max(1, height - 4);
  return (
    <Stack flexDirection="column" width="100%" height="100%">
      <ListFilterRow
        id="restore-filter"
        value={filter}
        focused={active}
        onInput={(value) => {
          setFilter(value);
          setCursor(0);
        }}
      >
        <Text height={1} flexShrink={0} strong>
          {messageId ? "Edit from here?" : "Select a prompt to edit from"}
        </Text>
      </ListFilterRow>
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
          <ListView
            items={["Cancel", "Revert files too", "Revert and keep changes"]}
            selected={choice}
            height={3}
            showCounter={false}
            itemKey={(label) => label}
            onActivate={(_label, index) => {
              if (active && !pending) void choose(index);
            }}
            renderItem={(label, index) => (
              <SelectionRow selected={choice === index} active={active && !pending} label={label} />
            )}
          />
        </>
      ) : (
        <>
          <ListView
            items={targets}
            selected={selected}
            height={count}
            itemKey={(entry) => entry.message.id}
            empty={
              <EmptyState
                title={filter ? "No prompts match." : "No checkpointed prompts available."}
                description={
                  filter ? "Esc clears the filter." : "Checkpoints appear after a turn finishes."
                }
              />
            }
            onActivate={(entry) => {
              if (active) select(entry.message.id);
            }}
            renderItem={(entry, index) => (
              <SelectionRow
                selected={index === selected}
                active={active}
                label={inlineTerminalText(
                  `Before turn ${entry.turnCount + 1} · ${entry.message.text}`,
                )}
              />
            )}
          />
          {page?.hasMoreHistory ? <Text tone="muted">L Load older prompts</Text> : null}
        </>
      )}
      {pending ? <Text tone="warning">Rewinding chat… Waiting for the environment.</Text> : null}
      {interaction.error ? <Text tone="danger">{interaction.error}</Text> : null}
    </Stack>
  );
}
