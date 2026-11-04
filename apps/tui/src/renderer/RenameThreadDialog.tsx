import type { TuiThreadShell } from "../connection/models.ts";
import { RegistryContext } from "@effect/atom-react";

import { useContext, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { useKeyLayer } from "../ui/keymap.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { FormInput } from "../ui/FormField.tsx";
import { Stack, Text } from "../ui/primitives.tsx";

export function RenameThreadDialog({
  client,
  thread,
  onClose,
}: {
  readonly client: TuiClient;
  readonly thread: TuiThreadShell;
  readonly onClose: () => void;
}) {
  const registry = useContext(RegistryContext);
  const [title, setTitle] = useState(thread.title);
  const [target, setTarget] = useState<"title" | "save" | "cancel">("title");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (pending) return;
    if (!title.trim()) {
      setError("Enter a thread title.");
      setTarget("title");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (await client.threadManagement.rename(registry, thread.id, title)) {
        onClose();
      } else {
        setError("Could not rename. Try again.");
      }
    } catch {
      setError("Could not rename. Try again.");
    } finally {
      setPending(false);
    }
  };
  const targets = ["title", "save", "cancel"] as const;
  useKeyLayer("rename", {
    modal: true,
    typing: target === "title",
    ...(pending ? { raw: () => true } : {}),
    bindings: {
      "rename.close": onClose,
      "rename.next": () => setTarget(targets[(targets.indexOf(target) + 1) % targets.length]!),
      "rename.previous": () => setTarget(targets[(targets.indexOf(target) + 2) % targets.length]!),
      "rename.confirm": () => {
        if (target === "cancel") onClose();
        else void save();
      },
    },
  });
  return (
    <Dialog
      id="thread-rename-dialog"
      title="Rename thread"
      width={46}
      height={error ? 9 : 7}
      gap={1}
      paddingTop={1}
    >
      <FormInput
        id="thread-rename-title"
        width="100%"
        value={title}
        focused={!pending && target === "title"}
        onInput={setTitle}
        onFocusRequest={() => {
          if (!pending) setTarget("title");
        }}
      />
      <Stack height={1} flexDirection="row" gap={2}>
        <Button
          id="thread-rename-save"
          label={pending ? "Saving..." : "[ Save ]"}
          width={14}
          focused={target === "save"}
          disabled={pending}
          onPress={() => void save()}
        />
        <Button
          id="thread-rename-cancel"
          label="[ Cancel ]"
          width={14}
          focused={target === "cancel"}
          disabled={pending}
          onPress={onClose}
        />
      </Stack>
      {error ? (
        <Text height={1} tone="danger">
          {error}
        </Text>
      ) : null}
    </Dialog>
  );
}
