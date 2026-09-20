import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { decodePasteBytes } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useMemo, useState, useContext, useEffect } from "react";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { RequestsPanel } from "./RequestsPanel.tsx";
import { ComposerControls } from "./ProviderPicker.tsx";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { projectRecordedThreadTimeline } from "../features/chat/timeline.ts";
import { threadActivityPhase } from "../features/chat/threadActivity.ts";
import { pastedImagePaths } from "../features/chat/imageAttachments.ts";
import { suggestedReplies as parseSuggestedReplies } from "../features/chat/suggestedReplies.ts";
import { ThreadActivityIndicator } from "../ui/ThreadActivityIndicator.tsx";
import { conversationLines } from "../ui/conversationLines.ts";
import { ConversationText } from "../ui/ShellCommandText.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { ThreadTerminal } from "./ThreadTerminal.tsx";

export function Conversation({
  client,
  threadId,
  width,
  height,
  active,
  onBack,
  onHelp,
  onNewThread,
  onHintsChange,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly onBack: () => void;
  readonly onHelp: () => void;
  readonly onNewThread?: () => void;
  readonly onHintsChange?: (hints: string) => void;
}) {
  const state = useAtomValue(client.thread(threadId));
  const shell = useAtomValue(client.shell);
  const connection = useAtomValue(client.connection);
  const interaction = useAtomValue(client.actions.state(threadId));
  const registry = useContext(RegistryContext);
  const thread = Option.getOrNull(state.data);
  const [mode, setMode] = useState<"history" | "composer" | "requests">("history");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const requests = useMemo(() => derivePendingRequests(thread?.activities ?? []), [thread]);
  const requestCount = requests.approvals.length + requests.userInputs.length;
  const latestMessage = thread?.messages.at(-1);
  const suggestedReplies =
    requestCount === 0 &&
    latestMessage?.role === "assistant" &&
    !latestMessage.streaming &&
    thread?.latestTurn?.state !== "running"
      ? parseSuggestedReplies(latestMessage.text)
      : [];
  usePaste((event) => {
    if (!active) return;
    const text = decodePasteBytes(event.bytes);
    const paths = pastedImagePaths(text);
    if (!paths && !client.actions.addPaste(registry, threadId, text)) return;
    event.preventDefault();
    event.stopPropagation();
    setMode("composer");
    if (paths) void client.actions.attachImages(registry, threadId, paths);
  });
  useEffect(() => {
    if (thread) client.actions.observe(registry, thread.id);
  }, [client, registry, thread]);
  const hints =
    mode === "composer"
      ? suggestedReplies.length
        ? "Arrows Choose reply  Enter Select  Tab Model  Esc History"
        : "Enter Send  / Skills  Tab Model/options  Ctrl+T Shell  Esc History"
      : mode === "requests"
        ? "Up/Down Select  Enter Review  Esc Back  PgUp/PgDn Details"
        : width < 58
          ? "Enter Write  A Requests  Ctrl+T Shell  Esc Back"
          : "Enter Write  A Requests  Ctrl+T Shell  Esc Back  ? Help";
  useEffect(() => {
    onHintsChange?.(hints);
  }, [hints, onHintsChange]);
  const editorHeight =
    mode === "composer"
      ? Math.max(2, Math.min(4, Math.floor(height / 4)))
      : interaction.draft
        ? 2
        : 1;
  const attachmentHeight = interaction.attachments.length > 0 ? 1 : 0;
  const suggestedReplyHeight = suggestedReplies.length > 0 ? 1 : 0;
  const gap = height >= 12 ? 1 : 0;
  const count = Math.max(
    1,
    height -
      1 -
      (editorHeight + attachmentHeight + suggestedReplyHeight + 3) -
      gap -
      (interaction.error ? 1 : 0) -
      (thread?.worktreePath ? 1 : 0),
  );
  const [anchor, setAnchor] = useState<{ readonly id: string; readonly line: number } | null>(null);
  const timeline = useMemo(
    () => (thread === null ? [] : projectRecordedThreadTimeline(thread)),
    [thread],
  );
  const lines = useMemo(
    () => conversationLines(timeline, width, showDetails),
    [timeline, width, showDetails],
  );
  const maxStart = Math.max(0, lines.length - count);
  const anchorIndex =
    anchor === null
      ? -1
      : lines.findIndex((line) => line.id === anchor.id && line.line >= anchor.line);
  const start =
    anchor === null
      ? maxStart
      : Math.max(
          0,
          Math.min(
            maxStart,
            anchorIndex < 0 ? lines.findIndex((line) => line.id === anchor.id) : anchorIndex,
          ),
        );
  const page = Option.getOrNull(state.page);
  const scrollTo = (next: number) => {
    const target = Math.max(0, Math.min(maxStart, next));
    const line = lines[target];
    setAnchor(target === maxStart || line === undefined ? null : { id: line.id, line: line.line });
  };
  useKeyboard((key) => {
    if (!active) return;
    if (key.ctrl && key.name === "t" && !terminalOpen && client.terminals) {
      key.preventDefault();
      key.stopPropagation();
      setTerminalOpen(true);
      return;
    }
    if (terminalOpen) return;
    if (key.ctrl && key.name === "x") {
      key.preventDefault();
      key.stopPropagation();
      void client.actions.interrupt(registry, threadId);
      return;
    }
    if (key.ctrl || key.meta || key.option || mode !== "history") return;
    switch (key.name) {
      case "/":
        client.actions.setDraft(
          registry,
          threadId,
          `${interaction.draft}${interaction.draft && !/\s$/u.test(interaction.draft) ? " " : ""}/`,
        );
        setMode("composer");
        break;
      case "return":
      case "enter":
      case "i":
        setMode("composer");
        break;
      case "n":
        onNewThread?.();
        break;
      case "a":
        setMode("requests");
        break;
      case "t":
        setShowDetails((value) => !value);
        break;
      case "escape":
      case "left":
      case "backspace":
      case "tab":
        onBack();
        break;
      case "?":
        onHelp();
        break;
      case "r":
        void client.retry(registry);
        break;
      case "up":
        scrollTo(start - 1);
        break;
      case "down":
        scrollTo(start + 1);
        break;
      case "pageup":
        scrollTo(start - count);
        break;
      case "pagedown":
        scrollTo(start + count);
        break;
      case "home":
        scrollTo(0);
        if (page?.hasMore && !page.loadingOlder) client.loadOlder(threadId);
        break;
      case "end":
        setAnchor(null);
        break;
      default:
        return;
    }
    key.preventDefault();
    key.stopPropagation();
  });
  const empty =
    state.status === "deleted"
      ? "This thread was deleted."
      : Option.isSome(state.error)
        ? "Conversation unavailable. R retries the connection."
        : thread === null
          ? "Loading conversation..."
          : "No messages in this thread.";
  const metadata = Option.getOrNull(shell.snapshot)?.threads.find((item) => item.id === threadId);
  const live =
    connection.phase === "connected" &&
    shell.status === "live" &&
    state.status === "live" &&
    Option.isNone(shell.error) &&
    Option.isNone(state.error);
  const phase = thread
    ? threadActivityPhase(
        client.environmentId,
        {
          ...thread,
          hasPendingApprovals:
            metadata?.hasPendingApprovals === true || requests.approvals.length > 0,
          hasPendingUserInput:
            metadata?.hasPendingUserInput === true || requests.userInputs.length > 0,
        },
        live,
      )
    : "stale";
  const project = Option.getOrNull(shell.snapshot)?.projects.find(
    (item) => item.id === thread?.projectId,
  );
  const terminalCwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  if (terminalOpen && client.terminals && terminalCwd)
    return (
      <ThreadTerminal
        client={client}
        environmentId={client.environmentId}
        threadId={threadId}
        cwd={terminalCwd}
        worktreePath={thread?.worktreePath ?? null}
        active={active}
        {...(onHintsChange ? { onHintsChange } : {})}
        onBack={() => setTerminalOpen(false)}
      />
    );
  if (mode === "requests")
    return (
      <Panel
        title="Agent requests"
        width="100%"
        height="100%"
        borderTone="warning"
        flexDirection="column"
      >
        <RequestsPanel
          client={client}
          threadId={threadId}
          active={active}
          width={Math.max(1, width - 4)}
          height={Math.max(1, height - 2)}
          onBack={() => setMode("history")}
        />
      </Panel>
    );
  return (
    <Stack flexDirection="column" width="100%" height="100%" overflow="hidden">
      {thread?.worktreePath ? (
        <Text
          height={1}
          flexShrink={0}
          tone="accent"
          wrapMode="none"
          truncate
        >{`Worktree: ${inlineTerminalText(thread.worktreePath)}`}</Text>
      ) : null}
      <Stack height={1} flexShrink={0} flexDirection="row">
        <ThreadActivityIndicator phase={phase} visible={active} />
        <Text tone={requestCount ? "warning" : "muted"} flexGrow={1} wrapMode="none" truncate>
          {requestCount || phase === "waiting_for_approval" || phase === "waiting_for_input"
            ? "  A: respond to requests"
            : interaction.pending
              ? "  Sending command..."
              : "  T: tool details"}
        </Text>
        <Text tone="muted" flexShrink={0}>
          {anchor !== null ? "History / End: live" : page?.hasMore ? "Home: earlier" : ""}
        </Text>
      </Stack>
      <Stack flexGrow={1} flexDirection="column" overflow="hidden">
        {lines.length === 0 ? (
          <Text tone="muted">{empty}</Text>
        ) : (
          lines
            .slice(start, start + count)
            .map((line) => <ConversationText key={`${line.id}:${line.line}`} line={line} />)
        )}
      </Stack>
      {interaction.error ? (
        <Text height={1} flexShrink={0} tone="danger" wrapMode="none" truncate>
          {interaction.error}
        </Text>
      ) : null}
      {gap ? <Stack height={gap} flexShrink={0} /> : null}
      <ComposerControls
        client={client}
        threadId={threadId}
        active={active}
        focused={mode === "composer"}
        editorHeight={editorHeight}
        suggestedReplies={suggestedReplies}
        availableHeight={height - 1}
        onActivate={() => setMode("composer")}
        onBlur={() => setMode("history")}
        onSubmit={() => {
          setAnchor(null);
          void client.actions.send(registry, threadId);
        }}
      />
    </Stack>
  );
}
