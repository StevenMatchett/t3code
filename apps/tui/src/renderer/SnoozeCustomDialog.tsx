import { useState } from "react";
import { parseCustomSnooze } from "../app/threadShelves.ts";
import { useKeyLayer } from "../ui/keymap.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { FormInput } from "../ui/FormField.tsx";
import { Text } from "../ui/primitives.tsx";

/** Asks for a wake time as a duration or a local time, and shows what it means before committing. */
export function SnoozeCustomDialog({
  count,
  onSnooze,
  onClose,
}: {
  readonly count: number;
  readonly onSnooze: (until: string) => void;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [rejected, setRejected] = useState(false);
  const until = parseCustomSnooze(text, new Date());
  useKeyLayer("rename", {
    modal: true,
    typing: true,
    context: "Snooze",
    bindings: {
      "rename.close": { label: "Cancel", run: onClose },
      "rename.confirm": {
        label: "Snooze",
        title: "Snooze until this time",
        run: () => {
          if (until) onSnooze(until);
          else setRejected(true);
        },
      },
    },
  });
  return (
    <Dialog
      id="snooze-custom-dialog"
      title={count > 1 ? `Snooze ${count} threads` : "Snooze thread"}
      width={56}
      height={8}
      gap={1}
      paddingTop={1}
    >
      <FormInput
        id="snooze-custom-input"
        width="100%"
        value={text}
        placeholder="90m, 2h, 3d, 18:30, or 2026-11-05 09:00"
        focused
        onInput={(value) => {
          setText(value);
          setRejected(false);
        }}
      />
      <Text
        height={1}
        wrapMode="none"
        truncate
        tone={until ? "muted" : rejected ? "danger" : "muted"}
      >
        {until
          ? `Wakes ${new Date(until).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`
          : rejected
            ? "Enter a future time, such as 2h or 18:30."
            : "A duration, or a time on your clock."}
      </Text>
    </Dialog>
  );
}
