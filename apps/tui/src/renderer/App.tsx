import { useState } from "react";

import { AppShell } from "./AppShell.tsx";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { useKeyLayer } from "../ui/keymap.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Stack, Text } from "../ui/primitives.tsx";

export interface AppProps {
  readonly onInterrupt: () => void;
  readonly client: TuiClient;
}

export function App({ onInterrupt, client }: AppProps) {
  const [confirming, setConfirming] = useState(false);
  const [selection, setSelection] = useState<"cancel" | "quit">("cancel");
  const closeConfirmation = () => {
    setConfirming(false);
    setSelection("cancel");
  };
  const confirm = () => {
    if (selection === "quit") onInterrupt();
    else closeConfirmation();
  };
  const switchSelection = () =>
    setSelection((current) => (current === "cancel" ? "quit" : "cancel"));
  useKeyLayer("app", {
    bindings: {
      "app.quit": () => {
        if (confirming) onInterrupt();
        else setConfirming(true);
      },
    },
  });
  useKeyLayer("quit", {
    active: confirming,
    modal: true,
    bindings: {
      "quit.confirm": onInterrupt,
      "quit.cancel": closeConfirmation,
      "quit.switch": switchSelection,
      "quit.activate": confirm,
    },
  });

  return (
    <Stack width="100%" height="100%">
      <AppShell client={client} initialRoute="projects" active={!confirming} />
      {confirming ? (
        <Dialog id="exit-confirmation" title="Close T3 TUI?" width={60} height={7} gap={1}>
          <Text height={1} wrapMode="none" truncate>
            Your agents will keep running on the shared environment.
          </Text>
          <Text height={1} tone="muted" wrapMode="none" truncate>
            Are you sure you want to close this TUI?
          </Text>
          <Stack height={1} flexDirection="row" gap={1}>
            <Button
              id="exit-confirm-cancel"
              label="[ Cancel ]"
              flexGrow={1}
              flexShrink={1}
              minWidth={0}
              focused={selection === "cancel"}
              onPress={closeConfirmation}
            />
            <Button
              id="exit-confirm-quit"
              label="[ Close T3 TUI ]"
              flexGrow={1}
              flexShrink={1}
              minWidth={0}
              focused={selection === "quit"}
              onPress={onInterrupt}
            />
          </Stack>
        </Dialog>
      ) : null}
    </Stack>
  );
}
