import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { DEFAULT_TERMINAL_ID, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import {
  EMPTY_TERMINAL_BUFFER_STATE,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { EmbeddedTerminalSurface } from "./embedded-terminal/index.ts";
import type { HotkeyState } from "../ui/HotkeyBar.tsx";

const discardedByClient = new WeakMap<TuiClient, Map<string, Set<string>>>();

function discardedIds(client: TuiClient, threadId: ThreadId) {
  let threads = discardedByClient.get(client);
  if (!threads) {
    threads = new Map();
    discardedByClient.set(client, threads);
  }
  let ids = threads.get(threadId);
  if (!ids) {
    ids = new Set();
    threads.set(threadId, ids);
  }
  return ids;
}

function nextTerminalId(client: TuiClient, threadId: ThreadId, used: ReadonlySet<string>) {
  const discarded = discardedIds(client, threadId);
  let sequence = 1;
  while (used.has(`term-${sequence}`) || discarded.has(`term-${sequence}`)) sequence += 1;
  return `term-${sequence}`;
}

export function ThreadTerminal({
  client,
  environmentId,
  threadId,
  cwd,
  worktreePath,
  active,
  onBack,
  onHintsChange,
  onFocusChange,
}: {
  readonly client: TuiClient;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly active: boolean;
  readonly onBack: () => void;
  readonly onHintsChange?: (state: HotkeyState) => void;
  readonly onFocusChange?: (focused: boolean) => void;
}) {
  const terminals = client.terminals!;
  const registry = useContext(RegistryContext);
  const renderer = useRenderer();
  const metadataResult = useAtomValue(terminals.metadata({ environmentId, input: null }));
  const summaries = Option.getOrElse(AsyncResult.value(metadataResult), () => []);
  const serverIds = summaries
    .filter((terminal) => terminal.threadId === threadId)
    .map((terminal) => terminal.terminalId);
  const [firstTerminalId] = useState(() =>
    discardedIds(client, threadId).has(DEFAULT_TERMINAL_ID)
      ? nextTerminalId(client, threadId, new Set(serverIds))
      : DEFAULT_TERMINAL_ID,
  );
  const [localIds, setLocalIds] = useState<readonly string[]>([firstTerminalId]);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const terminalIds = useMemo(
    () =>
      [...new Set([...serverIds, ...localIds])]
        .filter((id) => !hiddenIds.has(id) && !discardedIds(client, threadId).has(id))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    [client, hiddenIds, localIds, serverIds, threadId],
  );
  const [terminalId, setTerminalId] = useState(firstTerminalId);
  const [focused, setFocused] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const handledExit = useRef<string | null>(null);
  const attachResult = useAtomValue(
    terminals.attach({
      environmentId,
      input: {
        threadId,
        terminalId,
        cwd,
        worktreePath,
        restartIfNotRunning: true,
      },
    }),
  );
  const terminal = Option.getOrElse(
    AsyncResult.value(attachResult),
    (): TerminalBufferState => EMPTY_TERMINAL_BUFFER_STATE,
  );
  const attachFailed = AsyncResult.isFailure(attachResult);
  useEffect(() => {
    onHintsChange?.({
      context: focused ? "Terminal" : "Shell controls",
      hints: focused
        ? [{ key: "Ctrl+\\", label: "Shell controls" }]
        : [
            { key: "Enter", label: "Focus shell" },
            { key: "←→", label: "Switch shell" },
            { key: "N", label: "New shell" },
            { key: "X", label: "Close shell" },
            { key: "Ctrl+K", label: "Search" },
            { key: "Esc", label: "Chat" },
          ],
    });
  }, [focused, onHintsChange]);
  useEffect(() => {
    onFocusChange?.(focused);
    return () => onFocusChange?.(false);
  }, [focused, onFocusChange]);
  const nextTerminal = () => {
    const used = new Set(terminalIds);
    const id = nextTerminalId(client, threadId, used);
    setLocalIds((current) => [...current, id]);
    setHiddenIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setTerminalId(id);
    setFocused(true);
    setError(null);
    setConfirmClose(false);
  };
  const dismissTerminal = () => {
    discardedIds(client, threadId).add(terminalId);
    const remaining = terminalIds.filter((id) => id !== terminalId);
    setLocalIds((current) => current.filter((id) => id !== terminalId));
    setHiddenIds((current) => new Set(current).add(terminalId));
    if (remaining.length === 0) onBack();
    else setTerminalId(remaining[0]!);
  };
  const closeTerminal = async () => {
    const summary = summaries.find(
      (item) => item.threadId === threadId && item.terminalId === terminalId,
    );
    if (summary?.hasRunningSubprocess && !confirmClose) {
      setConfirmClose(true);
      setError("A process is running. Press X again to close this shell.");
      return;
    }
    const result = await terminals.close.run(registry, {
      environmentId,
      input: { threadId, terminalId },
    });
    if (!AsyncResult.isSuccess(result)) {
      setError("Could not close this shell.");
      return;
    }
    dismissTerminal();
  };
  const handleTerminalEnded = useEffectEvent((status: "exited" | "closed") => {
    if (status === "exited")
      void terminals.close.run(registry, {
        environmentId,
        input: { threadId, terminalId, deleteHistory: true },
      });
    dismissTerminal();
  });
  useEffect(() => {
    if (terminal.version === 0 || (terminal.status !== "exited" && terminal.status !== "closed"))
      return;
    const exitKey = `${terminalId}:${terminal.lifecycleVersion}`;
    if (handledExit.current === exitKey) return;
    handledExit.current = exitKey;
    handleTerminalEnded(terminal.status);
  }, [terminal.lifecycleVersion, terminal.status, terminal.version, terminalId]);
  useKeyboard((key) => {
    if (!active || focused || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") onBack();
    else if (key.name === "return" || key.name === "enter") setFocused(true);
    else if (key.name === "n") nextTerminal();
    else if (key.name === "x") void closeTerminal();
    else if (key.name === "left" || key.name === "right") {
      const current = Math.max(0, terminalIds.indexOf(terminalId));
      const offset = key.name === "left" ? -1 : 1;
      setTerminalId(terminalIds[(current + offset + terminalIds.length) % terminalIds.length]!);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack flexDirection="column" width="100%" height="100%" overflow="hidden">
      <Stack height={1} flexShrink={0} flexDirection="row" width="100%">
        {terminalIds.map((id) => (
          <Text
            key={id}
            height={1}
            flexShrink={0}
            tone={id === terminalId ? "accent" : "muted"}
            strong={id === terminalId}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              setTerminalId(id);
              setFocused(true);
            }}
          >{`${id === terminalId ? "[" : " "}${id}${id === terminalId ? "]" : " "} `}</Text>
        ))}
        <Text height={1} flexGrow={1} tone="muted" wrapMode="none" truncate>
          {` ${inlineTerminalText(cwd)}`}
        </Text>
        <Text
          height={1}
          flexShrink={0}
          tone={error || terminal.error || attachFailed ? "danger" : "muted"}
        >
          {error ?? terminal.error ?? (attachFailed ? "connection failed" : terminal.status)}
        </Text>
      </Stack>
      <Stack flexGrow={1} width="100%" overflow="hidden">
        <EmbeddedTerminalSurface
          key={terminalId}
          id={`thread-terminal-${terminalId}`}
          output={terminal.output}
          focused={focused}
          onReleaseFocus={() => setFocused(false)}
          onWrite={async (data) => {
            const result = await terminals.write.run(registry, {
              environmentId,
              input: { threadId, terminalId, data },
            });
            if (!AsyncResult.isSuccess(result)) setError("Could not write to this shell.");
          }}
          onResize={async ({ cols, rows }) => {
            const result = await terminals.resize.run(registry, {
              environmentId,
              input: { threadId, terminalId, cols, rows },
            });
            if (!AsyncResult.isSuccess(result)) setError("Could not resize this shell.");
          }}
          onCopy={(text) => renderer.copyToClipboardOSC52(text)}
          onError={() => setError("The shell connection failed.")}
        />
      </Stack>
    </Stack>
  );
}
