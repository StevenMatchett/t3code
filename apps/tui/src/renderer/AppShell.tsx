import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import * as Option from "effect/Option";
import { useMemo, useContext, useState } from "react";
import { calculateShellLayout } from "../ui/layout.ts";
import { AppShellView, useAppShellState } from "../app/AppShell.tsx";
import { shellCommandFromKey, type ShellRoute, type ShellState } from "../app/state.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Conversation } from "./Conversation.tsx";
import { NewThreadForm } from "./NewThreadForm.tsx";
import { ActivityClockProvider } from "../ui/ThreadActivityIndicator.tsx";

export interface AppShellProps {
  readonly client: TuiClient;
  readonly initialRoute?: ShellRoute;
  readonly onStateChange?: (state: ShellState) => void;
}

export function AppShell({ client, initialRoute = "projects", onStateChange }: AppShellProps) {
  const shell = useAtomValue(client.shell);
  const connection = useAtomValue(client.connection);
  const registry = useContext(RegistryContext);
  const { width, height } = useTerminalDimensions();
  const layout = calculateShellLayout(width, height);
  const [hints, setHints] = useState("");
  const snapshot = Option.getOrNull(shell.snapshot);
  const rows = useMemo(
    () => ({
      projects: [...(snapshot?.projects ?? [])].sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      ),
      threads: [...(snapshot?.threads ?? [])]
        .filter((thread) => thread.archivedAt === null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
    }),
    [snapshot],
  );
  const [state, dispatch] = useAppShellState(rows, snapshot !== null, initialRoute, onStateChange);
  useKeyboard((key) => {
    if (
      key.ctrl ||
      key.meta ||
      key.option ||
      state.modal === "new-thread" ||
      (state.route === "conversation" && state.modal === null)
    )
      return;
    if (!state.modal && key.name === "r") {
      key.preventDefault();
      key.stopPropagation();
      void client.retry(registry);
      return;
    }
    const command = shellCommandFromKey(key);
    if (
      command === undefined ||
      (!state.modal && state.route === "conversation" && command.type === "move")
    )
      return;
    key.preventDefault();
    key.stopPropagation();
    dispatch(command);
  });
  const status =
    connection.phase === "connected"
      ? Option.isSome(shell.error)
        ? "Sync failed"
        : shell.status === "live"
          ? "Connected"
          : "Syncing"
      : connection.phase === "blocked"
        ? "Access blocked"
        : connection.phase === "backoff"
          ? "Reconnecting"
          : connection.phase === "offline"
            ? "Offline"
            : "Connecting";
  return (
    <ActivityClockProvider>
      <AppShellView
        environmentId={client.environmentId}
        live={
          connection.phase === "connected" && shell.status === "live" && Option.isNone(shell.error)
        }
        state={state}
        label={client.label}
        status={status}
        projects={rows.projects}
        threads={rows.threads}
        loaded={snapshot !== null}
        error={Option.isSome(shell.error) || connection.phase === "blocked"}
        width={width}
        height={height}
        hints={hints}
        onNewThread={() => dispatch({ type: "new-thread" })}
        modalContent={
          state.modal === "new-thread" ? (
            <NewThreadForm
              client={client}
              projectId={state.projectId}
              height={layout.contentHeight}
              onClose={() => dispatch({ type: "close-modal" })}
              onCreated={(projectId, threadId) =>
                dispatch({ type: "open-thread", projectId, threadId })
              }
            />
          ) : undefined
        }
      >
        {state.route === "conversation" && state.threadId !== null ? (
          <Conversation
            key={state.threadId}
            client={client}
            threadId={state.threadId}
            width={layout.contentWidth}
            height={layout.contentHeight}
            onHintsChange={setHints}
            active={state.modal === null}
            onBack={() => dispatch({ type: "back" })}
            onHelp={() => dispatch({ type: "toggle-help" })}
            onNewThread={() => dispatch({ type: "new-thread" })}
          />
        ) : null}
      </AppShellView>
    </ActivityClockProvider>
  );
}
