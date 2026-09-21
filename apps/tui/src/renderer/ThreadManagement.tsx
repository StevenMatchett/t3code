import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import type { OrchestrationThreadShell } from "@t3tools/contracts";
import { useContext, useEffect, useMemo, useState } from "react";

import type { TuiClient } from "../connection/clientRuntime.ts";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { useThemeColor } from "../ui/context.tsx";

type ActionTarget = "title" | "save" | "archive" | "delete" | "cancel";

export function ThreadActionsForm({
  client,
  thread,
  active,
  onClose,
  onRemoved,
}: {
  readonly client: TuiClient;
  readonly thread: OrchestrationThreadShell;
  readonly active: boolean;
  readonly onClose: () => void;
  readonly onRemoved: (action: "archive" | "unarchive" | "delete") => void;
}) {
  const registry = useContext(RegistryContext);
  const [target, setTarget] = useState<ActionTarget>("title");
  const [title, setTitle] = useState(thread.title);
  const [pending, setPending] = useState<ActionTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedBackground = useThemeColor("selection");
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

  useKeyboard((key) => {
    if (!active || pending || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onClose();
      return;
    }
    if (key.name === "tab" || key.name === "up" || key.name === "down") {
      const offset = key.name === "up" || (key.name === "tab" && key.shift) ? -1 : 1;
      const index = targets.indexOf(target);
      setTarget(targets[(index + offset + targets.length) % targets.length]!);
    } else if ((key.name === "return" || key.name === "enter") && target !== "title") {
      if (!key.repeated) activate(target);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });

  const button = (id: Exclude<ActionTarget, "title">, label: string, danger = false) => (
    <Stack
      id={`thread-action-${id}`}
      height={1}
      flexGrow={1}
      minWidth={0}
      {...(target === id && selectedBackground ? { backgroundColor: selectedBackground } : {})}
      onMouseDown={(event) => {
        if (event.button !== 0 || pending) return;
        event.preventDefault();
        event.stopPropagation();
        activate(id);
      }}
    >
      <Text
        height={1}
        tone={danger ? "danger" : target === id ? "accent" : "muted"}
        strong={target === id}
        wrapMode="none"
        truncate
      >
        {label}
      </Text>
    </Stack>
  );

  return (
    <Stack width="100%" height="100%" flexDirection="column" gap={1}>
      <Text strong>{inlineTerminalText(thread.title)}</Text>
      <Text tone="muted" wrapMode="none" truncate>
        Rename this thread or change whether it appears in the active thread list.
      </Text>
      <input
        id="thread-action-title"
        focused={active && target === "title"}
        width="100%"
        value={title}
        placeholder="Thread title"
        onInput={(value) => {
          setTitle(value);
          setConfirmDelete(false);
        }}
        onMouseDown={() => setTarget("title")}
        onSubmit={() => void run("save")}
      />
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
      >
        {message ?? "Tab selects an action. Delete requires confirmation."}
      </Text>
    </Stack>
  );
}

export function ArchivedThreadsPanel({
  client,
  active,
  onClose,
  onManage,
}: {
  readonly client: TuiClient;
  readonly active: boolean;
  readonly onClose: () => void;
  readonly onManage: (thread: OrchestrationThreadShell) => void;
}) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(client.archivedThreads);
  const [cursor, setCursor] = useState(0);
  const rows = useMemo(
    () => [...state.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.threads],
  );
  const selected = Math.max(0, Math.min(cursor, rows.length - 1));
  useEffect(() => {
    client.refreshArchivedThreads(registry);
  }, [client, registry]);
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") onClose();
    else if (key.name === "r") client.refreshArchivedThreads(registry);
    else if (rows.length > 0 && key.name === "up")
      setCursor((current) => (current - 1 + rows.length) % rows.length);
    else if (rows.length > 0 && key.name === "down")
      setCursor((current) => (current + 1) % rows.length);
    else if (
      rows[selected] &&
      (key.name === "return" || key.name === "enter" || key.name === "right")
    )
      onManage(rows[selected]);
    else return;
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack width="100%" height="100%" flexDirection="column">
      <Text height={1} tone="muted">
        {state.status === "loading"
          ? "Loading archived threads..."
          : state.status === "error"
            ? "Could not load archived threads. R retries."
            : `${rows.length} archived thread${rows.length === 1 ? "" : "s"}`}
      </Text>
      <Stack flexGrow={1} flexDirection="column" overflow="hidden">
        {rows.length === 0 && state.status === "live" ? (
          <Text tone="muted">No archived threads.</Text>
        ) : (
          rows.map((thread, index) => (
            <Stack
              key={thread.id}
              id={`archived-thread-${thread.id}`}
              height={1}
              flexShrink={0}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                setCursor(index);
                onManage(thread);
              }}
            >
              <SelectionRow
                selected={index === selected}
                active={active}
                label={`${thread.title}  ${thread.modelSelection.model}`}
              />
            </Stack>
          ))
        )}
      </Stack>
      <Text height={1} tone="muted">
        Enter manages a thread · R refreshes · Esc closes
      </Text>
    </Stack>
  );
}
