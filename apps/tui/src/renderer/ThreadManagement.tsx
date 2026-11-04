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
  orphanedWorktree = null,
}: {
  /** The worktree only this thread uses, which deleting it would strand. */
  readonly orphanedWorktree?: { readonly cwd: string; readonly path: string } | null;
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
  const [cleanup, setCleanup] = useState<"keep" | "remove" | null>(null);
  const archived = thread.archivedAt !== null;
  const targets: readonly ActionTarget[] = ["title", "save", "archive", "delete", "cancel"];

  const run = async (
    action: Exclude<ActionTarget, "title" | "cancel">,
    worktreeChoice = cleanup,
  ) => {
    if (pending) return;
    if (
      action === "delete" &&
      worktreeChoice === null &&
      confirmDelete &&
      orphanedWorktree &&
      client.git
    ) {
      // Asked before deleting, because a deleted thread takes this dialog with it. Keep comes
      // first, so Enter on a prompt that just appeared cannot remove files.
      setCleanup("keep");
      setMessage(`Also remove the worktree at ${orphanedWorktree.path}?`);
      return;
    }
    if (action === "delete" && worktreeChoice === "remove" && orphanedWorktree) {
      setPending("delete");
      try {
        await client.git?.removeWorktree(registry, orphanedWorktree);
      } catch (failure) {
        // Removing first means a refusal leaves the thread and its history untouched.
        setPending(null);
        setCleanup(null);
        setMessage(failure instanceof Error ? failure.message : "Could not remove the worktree.");
        return;
      }
    }
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
      "manage.close": () => {
        if (cleanup) {
          setCleanup(null);
          setMessage(null);
        } else onClose();
      },
      "manage.next": () => {
        if (cleanup) setCleanup(cleanup === "keep" ? "remove" : "keep");
        else move(1);
      },
      "manage.previous": () => {
        if (cleanup) setCleanup(cleanup === "keep" ? "remove" : "keep");
        else move(-1);
      },
      "manage.activate": () => {
        if (cleanup) {
          void run("delete");
          return;
        }
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
        {cleanup ? (
          <>
            <Button
              id="thread-worktree-keep"
              label="[ Keep worktree ]"
              flexGrow={1}
              focused={cleanup === "keep"}
              onPress={() => void run("delete", "keep")}
            />
            <Button
              id="thread-worktree-remove"
              label="[ Remove worktree ]"
              tone="danger"
              flexGrow={1}
              focused={cleanup === "remove"}
              onPress={() => void run("delete", "remove")}
            />
          </>
        ) : (
          <>
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
          </>
        )}
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
