import type { TuiThreadShell } from "../connection/models.ts";
import { RegistryContext } from "@effect/atom-react";

import { useContext, useState } from "react";

import type { TuiClient } from "../connection/clientRuntime.ts";
import { useKeyLayer } from "../ui/keymap.ts";
import { Button } from "../ui/Button.tsx";
import { FormInput, FormRow } from "../ui/FormField.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

type ActionTarget = "title" | "save" | "archive" | "delete" | "cancel";

export function ThreadActionsForm({
  client,
  thread,
  active,
  onClose,
  onRemoved,
  initialAction = "rename",
}: {
  readonly initialAction?: "rename" | "delete";
  readonly client: TuiClient;
  readonly thread: TuiThreadShell;
  readonly active: boolean;
  readonly onClose: () => void;
  readonly onRemoved: (action: "archive" | "unarchive" | "delete") => void;
}) {
  const registry = useContext(RegistryContext);
  const [target, setTarget] = useState<ActionTarget>(
    initialAction === "delete" ? "delete" : "title",
  );
  const [title, setTitle] = useState(thread.title);
  const [pending, setPending] = useState<ActionTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(initialAction === "delete");
  const archived = thread.archivedAt !== null;
  const targets: readonly ActionTarget[] = ["title", "save", "archive", "delete", "cancel"];

  const run = async (action: Exclude<ActionTarget, "title" | "cancel">) => {
    if (pending) return;
    if (action === "delete" && !confirmDelete) {
      setConfirmDelete(true);
      setTarget("delete");
      setMessage("Press Delete again to permanently remove this thread.");
      return;
    }
    setPending(action);
    setMessage(null);
    const accepted =
      action === "save"
        ? await client.threadManagement.rename(registry, thread.id, title)
        : action === "delete"
          ? await client.threadManagement.delete(registry, thread.id)
          : archived
            ? await client.threadManagement.unarchive(registry, thread.id)
            : await client.threadManagement.archive(registry, thread.id);
    setPending(null);
    if (!accepted) {
      setMessage(
        action === "save" && !title.trim()
          ? "Enter a thread title."
          : "The environment did not accept that change.",
      );
      return;
    }
    if (action === "save") {
      setTitle(title.trim());
      setMessage("Thread renamed.");
      return;
    }
    onRemoved(action === "archive" ? (archived ? "unarchive" : "archive") : "delete");
  };

  const activate = (next: ActionTarget) => {
    setTarget(next);
    if (next === "cancel") onClose();
    else if (next !== "title") void run(next);
  };

  const move = (offset: number) => {
    const index = targets.indexOf(target);
    setTarget(targets[(index + offset + targets.length) % targets.length]!);
  };
  useKeyLayer("manage", {
    active,
    modal: true,
    typing: target === "title",
    // A pending change cannot be interrupted, so the dialog keeps its keys until it settles.
    ...(pending ? { raw: () => true } : {}),
    bindings: {
      "manage.close": onClose,
      "manage.next": () => move(1),
      "manage.previous": () => move(-1),
      "manage.activate": () => {
        if (target === "title") void run("save");
        else activate(target);
      },
    },
  });

  const button = (id: Exclude<ActionTarget, "title">, label: string, danger = false) => (
    <Button
      id={`thread-action-${id}`}
      label={label}
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      focused={target === id}
      disabled={pending !== null}
      {...(danger ? { tone: "danger" as const } : {})}
      onPress={() => activate(id)}
    />
  );

  return (
    <Stack width="100%" height="100%" flexDirection="column" gap={1}>
      <Text strong wrapMode="none" truncate>
        {inlineTerminalText(thread.title)}
      </Text>
      <FormRow label="Title" labelWidth={7} focused={target === "title"}>
        <FormInput
          id="thread-action-title"
          focused={active && target === "title"}
          value={title}
          placeholder="Thread title"
          onInput={(value) => {
            setTitle(value);
            setConfirmDelete(false);
          }}
          onFocusRequest={() => setTarget("title")}
        />
      </FormRow>
      <Stack height={1} flexDirection="row" gap={1}>
        {button("save", pending === "save" ? "[ Saving... ]" : "[ Save title ]")}
        {button(
          "archive",
          pending === "archive"
            ? "[ Working... ]"
            : archived
              ? "[ Restore thread ]"
              : "[ Archive thread ]",
        )}
      </Stack>
      <Stack height={1} flexDirection="row" gap={1}>
        {button(
          "delete",
          pending === "delete"
            ? "[ Deleting... ]"
            : confirmDelete
              ? "[ Confirm delete ]"
              : "[ Delete thread ]",
          true,
        )}
        {button("cancel", "[ Close ]")}
      </Stack>
      <Text
        height={1}
        tone={message === null ? "muted" : message.includes("renamed") ? "success" : "danger"}
        wrapMode="none"
        truncate
      >
        {message ?? "Delete asks for confirmation first."}
      </Text>
    </Stack>
  );
}
