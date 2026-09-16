import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { AppShellView, useAppShellState } from "../app/AppShell.tsx";
import { shellCommandFromKey, type ShellRoute, type ShellState } from "../app/state.ts";

export interface AppShellProps {
  readonly initialRoute?: ShellRoute;
  readonly onStateChange?: (state: ShellState) => void;
}

export function AppShell({ initialRoute = "connection", onStateChange }: AppShellProps) {
  const [state, dispatch] = useAppShellState(initialRoute, onStateChange);
  const { width } = useTerminalDimensions();

  useKeyboard((key) => {
    const command = shellCommandFromKey(key);
    if (command === undefined) return;

    key.preventDefault();
    key.stopPropagation();
    dispatch(command);
  });

  return <AppShellView narrow={width < 48} state={state} />;
}
