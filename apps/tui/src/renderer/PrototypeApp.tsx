import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";

import { AppShell } from "./AppShell.tsx";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Panel } from "../ui/Panel.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { useThemeColor } from "../ui/context.tsx";

export interface PrototypeAppProps {
  readonly onInterrupt: () => void;
  readonly client: TuiClient;
}

export function PrototypeApp({ onInterrupt, client }: PrototypeAppProps) {
  const [confirming, setConfirming] = useState(false);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [selection, setSelection] = useState<"cancel" | "quit">("cancel");
  const { width, height } = useTerminalDimensions();
  const selectedBackground = useThemeColor("selection");
  const modalWidth = Math.max(1, Math.min(60, width - 4));
  const modalHeight = 7;
  const closeConfirmation = () => {
    setConfirming(false);
    setSelection("cancel");
  };
  const confirm = () => {
    if (selection === "quit") onInterrupt();
    else closeConfirmation();
  };
  useKeyboard((key) => {
    if (key.ctrl && key.name.toLowerCase() === "c") {
      if (terminalFocused) return;
      key.preventDefault();
      key.stopPropagation();
      if (confirming) onInterrupt();
      else setConfirming(true);
      return;
    }
    if (!confirming || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape" || key.name.toLowerCase() === "n") closeConfirmation();
    else if (key.name.toLowerCase() === "y" || key.name.toLowerCase() === "q") onInterrupt();
    else if (key.name === "tab" || key.name === "left" || key.name === "right")
      setSelection((current) => (current === "cancel" ? "quit" : "cancel"));
    else if ((key.name === "return" || key.name === "enter") && !key.repeated) confirm();
    else return;
    key.preventDefault();
    key.stopPropagation();
  });

  const button = (id: "cancel" | "quit", label: string) => (
    <Stack
      id={`exit-confirm-${id}`}
      height={1}
      flexGrow={1}
      minWidth={0}
      {...(selection === id && selectedBackground ? { backgroundColor: selectedBackground } : {})}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (id === "quit") onInterrupt();
        else closeConfirmation();
      }}
    >
      <Text strong={selection === id} tone={selection === id ? "accent" : "muted"}>
        {label}
      </Text>
    </Stack>
  );

  return (
    <Stack width="100%" height="100%">
      <AppShell
        client={client}
        initialRoute="projects"
        active={!confirming}
        onTerminalFocusChange={setTerminalFocused}
      />
      {confirming ? (
        <Panel
          id="exit-confirmation"
          position="absolute"
          top={Math.max(0, Math.floor((height - modalHeight) / 2))}
          left={Math.max(0, Math.floor((width - modalWidth) / 2))}
          zIndex={100}
          width={modalWidth}
          height={modalHeight}
          title="Close T3 TUI?"
          borderTone="borderFocused"
          flexDirection="column"
          gap={1}
        >
          <Text height={1}>Your agents will keep running on the shared environment.</Text>
          <Text height={1} tone="muted">
            Are you sure you want to close this TUI?
          </Text>
          <Stack height={1} flexDirection="row" gap={1}>
            {button("cancel", "[ Cancel ]")}
            {button("quit", "[ Close T3 TUI ]")}
          </Stack>
        </Panel>
      ) : null}
    </Stack>
  );
}
