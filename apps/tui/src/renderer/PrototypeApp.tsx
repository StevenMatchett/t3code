import { useKeyboard } from "@opentui/react";

import { AppShell } from "./AppShell.tsx";
import type { TuiClient } from "../connection/clientRuntime.ts";

export interface PrototypeAppProps {
  readonly onInterrupt: () => void;
  readonly client: TuiClient;
}

export function PrototypeApp({ onInterrupt, client }: PrototypeAppProps) {
  useKeyboard((key) => {
    if (!key.ctrl || key.name.toLowerCase() !== "c") return;
    key.preventDefault();
    key.stopPropagation();
    onInterrupt();
  });

  return <AppShell client={client} initialRoute="projects" />;
}
