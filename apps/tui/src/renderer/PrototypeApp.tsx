import { useKeyboard } from "@opentui/react";

import { AppShell } from "./AppShell.tsx";

export interface PrototypeAppProps {
  readonly onInterrupt: () => void;
}

export function PrototypeApp({ onInterrupt }: PrototypeAppProps) {
  useKeyboard((key) => {
    if (!key.ctrl || key.name.toLowerCase() !== "c") return;
    key.preventDefault();
    key.stopPropagation();
    onInterrupt();
  });

  return <AppShell initialRoute="projects" />;
}
