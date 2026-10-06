import type { TuiThreadShell } from "../connection/models.ts";
import { RegistryContext } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";

import { useContext, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
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
  useKeyboard((key) => {
    if (pending) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (key.name === "escape") onClose();
    else if (key.name === "tab") {
      const targets = ["title", "save", "cancel"] as const;
      setTarget(targets[(targets.indexOf(target) + (key.shift ? 2 : 1)) % targets.length]!);
    } else if (key.name === "return" || key.name === "enter") {
      if (!key.repeated) {
        if (target === "cancel") onClose();
        else void save();
      }
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={100}
      alignItems="center"
      justifyContent="center"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Panel
        id="thread-rename-dialog"
        title="Rename thread"
        width={46}
        maxWidth="100%"
        height={error ? 9 : 7}
        flexDirection="column"
        gap={1}
        paddingTop={1}
        borderTone="borderFocused"
      >
        <input
          id="thread-rename-title"
          width="100%"
          value={title}
          focused={!pending && target === "title"}
          onInput={setTitle}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.button === 0 && !pending) setTarget("title");
          }}
        />
        <Stack height={1} flexDirection="row" gap={2}>
          {(["save", "cancel"] as const).map((action) => (
            <Stack
              key={action}
              id={`thread-rename-${action}`}
              width={14}
              height={1}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.button !== 0 || pending) return;
                if (action === "cancel") onClose();
                else void save();
              }}
            >
              <SelectionRow
                label={action === "save" ? (pending ? "Saving..." : "[ Save ]") : "[ Cancel ]"}
                selected={target === action}
              />
            </Stack>
          ))}
        </Stack>
        {error ? (
          <Text height={1} tone="danger">
            {error}
          </Text>
        ) : null}
      </Panel>
    </Stack>
  );
}
