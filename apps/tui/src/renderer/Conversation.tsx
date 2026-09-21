import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { decodePasteBytes } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useMemo, useState, useContext, useEffect, useRef } from "react";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { foldSubagentActivities } from "@t3tools/client-runtime/state/subagentRuntime";
import { AgentOutputOverlay, AgentSwarmPanel, agentOutputLines } from "./AgentSwarm.tsx";
import { Questions, RequestsPanel } from "./RequestsPanel.tsx";
import { ComposerControls } from "./ProviderPicker.tsx";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { projectRecordedThreadTimeline } from "../features/chat/timeline.ts";
import { threadActivityPhase } from "../features/chat/threadActivity.ts";
import { pastedImagePaths } from "../features/chat/imageAttachments.ts";
import { suggestedReplies as parseSuggestedReplies } from "../features/chat/suggestedReplies.ts";
import { ThreadActivityIndicator } from "../ui/ThreadActivityIndicator.tsx";
import { conversationLines } from "../ui/conversationLines.ts";
import { ConversationText } from "../ui/ShellCommandText.tsx";
import { textMatches } from "../ui/textSearch.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { ThreadTerminal } from "./ThreadTerminal.tsx";
import type { HotkeyHint, HotkeyState } from "../ui/HotkeyBar.tsx";

export function Conversation({
  client,
  threadId,
  width,
  height,
  active,
  onBack,
  onHelp,
  onNewThread,
  onDiff,
  onOpenPullRequest,
  onHintsChange,
  onTerminalFocusChange,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly onBack: () => void;
  readonly onHelp: () => void;
  readonly onNewThread?: () => void;
  readonly onDiff?: () => void;
  readonly onOpenPullRequest?: () => void;
  readonly onHintsChange?: (state: HotkeyState) => void;
  readonly onTerminalFocusChange?: (focused: boolean) => void;
}) {
  const state = useAtomValue(client.thread(threadId));
  const shell = useAtomValue(client.shell);
  const connection = useAtomValue(client.connection);
  const interaction = useAtomValue(client.actions.state(threadId));
  const queued = interaction.queue[0];
  const registry = useContext(RegistryContext);
  const thread = Option.getOrNull(state.data);
  const [mode, setMode] = useState<"history" | "composer" | "requests" | "questions" | "agents">(
    "history",
  );
  const [anchor, setAnchor] = useState<{ readonly id: string; readonly line: number } | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [expandedToolGroups, setExpandedToolGroups] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const [agentCursor, setAgentCursor] = useState(-1);
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [agentReturnMode, setAgentReturnMode] = useState<"history" | "composer">("history");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentOutputStart, setAgentOutputStart] = useState(0);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [search, setSearch] = useState<{ query: string; index: number } | null>(null);
  const requests = useMemo(() => derivePendingRequests(thread?.activities ?? []), [thread]);
  const question = requests.userInputs.find(
    (request) =>
      !interaction.replies.some(
        (reply) => reply.kind === "user-input" && reply.requestId === request.requestId,
      ),
  );
  const focusedQuestion = useRef<string | null>(null);
  const questionId = question?.requestId ?? null;
  const agents = useMemo(
    () => foldSubagentActivities(thread?.activities ?? []),
    [thread?.activities],
  );
  const resolvedAgentCursor = Math.max(-1, Math.min(agentCursor, agents.length - 1));
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  useEffect(() => {
    if (!active || terminalOpen || selectedAgent || mode === "requests") return;
    if (questionId && focusedQuestion.current !== questionId) {
      focusedQuestion.current = questionId;
      setMode("questions");
    } else if (!questionId) {
      focusedQuestion.current = null;
      // oxlint-disable-next-line react/set-state-in-effect -- Return keyboard focus when the server question is resolved or its response is accepted.
      if (mode === "questions") setMode("composer");
    }
  }, [active, terminalOpen, selectedAgent, questionId, mode]);
  const selectedAgentLines = useMemo(
    () =>
      selectedAgent
        ? agentOutputLines(selectedAgent, thread?.activities ?? [], Math.max(1, width - 4))
        : [],
    [selectedAgent, thread?.activities, width],
  );
  const requestCount = requests.approvals.length + requests.userInputs.length;
  const latestMessage = thread?.messages.at(-1);
  const suggestedReplies =
    requestCount === 0 &&
    latestMessage?.role === "assistant" &&
    !latestMessage.streaming &&
    thread?.latestTurn?.state !== "running"
      ? parseSuggestedReplies(latestMessage.text)
      : [];
  const activateComposer = () => {
    setSearch(null);
    setAnchor(null);
    setMode("composer");
  };
  const activateAgents = (returnMode: "history" | "composer") => {
    setAgentReturnMode(returnMode);
    setAgentCursor(-1);
    setMode("agents");
  };
  usePaste((event) => {
    if (!active || selectedAgent || mode === "questions" || terminalOpen || search) return;
    const text = decodePasteBytes(event.bytes);
    const paths = pastedImagePaths(text);
    if (!paths && !client.actions.addPaste(registry, threadId, text)) return;
    event.preventDefault();
    event.stopPropagation();
    activateComposer();
    if (paths) void client.actions.attachImages(registry, threadId, paths);
  });
  useEffect(() => {
    if (thread) client.actions.observe(registry, thread.id);
  }, [client, registry, thread]);
  const hints = useMemo<readonly HotkeyHint[]>(() => {
    if (search)
      return [
        { key: "Enter/↓", label: "Next match" },
        { key: "Shift+Enter/↑", label: "Previous" },
        { key: "Esc", label: "Close search" },
      ];
    const terminalHint = client.terminals ? [{ key: "Ctrl+T", label: "Terminal" }] : [];
    if (selectedAgent)
      return [
        { key: "↑↓", label: "Scroll" },
        { key: "PgUp/Dn", label: "Page" },
        { key: "Home/End", label: "Jump" },
        { key: "Ctrl+K", label: "Search" },
        { key: "Esc", label: "Close agent" },
      ];
    if (mode === "questions")
      return [
        { key: "↑↓/Tab", label: "Choose" },
        { key: "Enter", label: "Select/submit" },
        { key: "E", label: "Type answer" },
        { key: "PgUp/Dn", label: "Details" },
        { key: "Esc", label: "Chat" },
      ];
    if (mode === "composer")
      if (composerMenuOpen)
        return [
          { key: "↑↓", label: "Select" },
          ...terminalHint,
          { key: "Enter/Tab", label: "Choose" },
          { key: "⇧Tab/Esc", label: "Close" },
          { key: "Ctrl+K", label: "Search" },
        ];
      else
        return suggestedReplies.length
          ? [
              { key: "↑↓", label: "Choose reply" },
              ...terminalHint,
              { key: "Enter", label: "Select" },
              { key: "Tab", label: "Options" },
              { key: "Ctrl+K", label: "Search" },
              { key: "Esc", label: "History" },
            ]
          : [
              {
                key: "Enter",
                label: thread?.latestTurn?.state === "running" || queued ? "Queue" : "Send",
              },
              ...terminalHint,
              { key: "Shift+Enter", label: "New line" },
              { key: "/", label: "Skills" },
              { key: "Tab", label: agents.length ? "Options/agents" : "Options" },
              ...(thread?.latestTurn?.state === "running" || queued
                ? [{ key: "Ctrl+X", label: "Cancel" }]
                : []),
              { key: "Ctrl+K", label: "Search" },
              { key: "Esc", label: "History" },
            ];
    if (mode === "requests")
      return [
        { key: "↑↓", label: "Select" },
        { key: "Enter", label: "Review" },
        ...terminalHint,
        { key: "PgUp/Dn", label: "Details" },
        { key: "Ctrl+K", label: "Search" },
        { key: "Esc", label: "Back" },
      ];
    if (mode === "agents")
      return [
        { key: "↑↓", label: "Select" },
        { key: "Enter", label: "Toggle/open" },
        ...terminalHint,
        { key: "Ctrl+K", label: "Search" },
        { key: "Tab/Esc", label: "Back" },
      ];
    return [
      { key: "Enter", label: "Write" },
      ...terminalHint,
      { key: "↑↓", label: "Scroll" },
      { key: "/", label: "Find text" },
      { key: "A", label: "Requests" },
      ...(agents.length ? [{ key: "Tab", label: "Agents" }] : []),
      { key: "T", label: "Details" },
      { key: "D", label: "Diff" },
      { key: "O", label: "Open PR" },
      { key: "N", label: "New thread" },
      { key: "Ctrl+K", label: "Search" },
      { key: "Esc", label: "Threads" },
      ...(width >= 58 ? [{ key: "?", label: "Help" }] : []),
    ];
  }, [
    agents.length,
    client.terminals,
    composerMenuOpen,
    mode,
    queued,
    selectedAgent,
    search,
    suggestedReplies.length,
    thread?.latestTurn?.state,
    width,
  ]);
  const hotkeyContext = selectedAgent
    ? "Agent output"
    : mode === "questions"
      ? "Question"
      : mode === "composer"
        ? composerMenuOpen
          ? "Menu"
          : "Message"
        : mode === "requests"
          ? "Requests"
          : mode === "agents"
            ? "Agents"
            : "Conversation";
  useEffect(() => {
    onHintsChange?.({ context: hotkeyContext, hints });
  }, [hints, hotkeyContext, onHintsChange]);
  const editorHeight =
    mode === "composer"
      ? Math.max(2, Math.min(4, Math.floor(height / 4)))
      : interaction.draft
        ? 2
        : 1;
  const attachmentHeight = interaction.attachments.length > 0 ? 1 : 0;
  const suggestedReplyHeight = suggestedReplies.length > 0 ? 1 : 0;
  const agentPanelHeight =
    agents.length > 0 ? (agentsExpanded ? Math.min(6, agents.length + 3) : 3) : 0;
  const gap = height >= 12 ? 1 : 0;
  const questionHeight = question
    ? Math.max(
        6,
        Math.min(
          15,
          Math.floor(height / 2),
          height -
            (editorHeight + attachmentHeight + suggestedReplyHeight + 3) -
            agentPanelHeight -
            gap -
            (interaction.error ? 1 : 0) -
            (queued ? 2 : 0) -
            (thread?.worktreePath ? 1 : 0) -
            3,
        ),
      )
    : 0;
  const count = Math.max(
    1,
    height -
      1 -
      (editorHeight + attachmentHeight + suggestedReplyHeight + 3) -
      gap -
      agentPanelHeight -
      questionHeight -
      (search ? 1 : 0) -
      (interaction.error ? 1 : 0) -
      (queued ? 2 : 0) -
      (thread?.worktreePath ? 1 : 0),
  );
  const timeline = useMemo(
    () => (thread === null ? [] : projectRecordedThreadTimeline(thread)),
    [thread],
  );
  const lines = useMemo(
    () => conversationLines(timeline, width, showDetails, expandedToolGroups),
    [timeline, width, showDetails, expandedToolGroups],
  );
  const maxStart = Math.max(0, lines.length - count);
  const searchQuery = search?.query ?? "";
  const matches = useMemo(
    () =>
      searchQuery
        ? lines.flatMap((line, lineIndex) =>
            textMatches(line.text, searchQuery).map((match) => ({ ...match, lineIndex })),
          )
        : [],
    [lines, searchQuery],
  );
  const matchIndex = matches.length ? (search?.index ?? 0) % matches.length : 0;
  const anchorIndex =
    anchor === null
      ? -1
      : lines.findIndex((line) => line.id === anchor.id && line.line >= anchor.line);
  const start =
    search && matches.length
      ? Math.min(maxStart, matches[matchIndex]!.lineIndex)
      : anchor === null
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
  const cancelTurn = () => {
    void client.actions.interrupt(registry, threadId);
  };
  useKeyboard((key) => {
    if (!active) return;
    if (search && !terminalOpen && !selectedAgent && mode === "history") {
      if (key.name === "escape") {
        scrollTo(start);
        setSearch(null);
      } else if (
        key.name === "return" ||
        key.name === "enter" ||
        key.name === "up" ||
        key.name === "down"
      ) {
        const direction = key.shift || key.name === "up" ? -1 : 1;
        setSearch({
          ...search,
          index: matches.length ? (matchIndex + direction + matches.length) % matches.length : 0,
        });
      } else return;
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (selectedAgent) {
      if (key.ctrl || key.meta || key.option) return;
      const visible = Math.max(1, height - 4);
      const maximum = Math.max(0, selectedAgentLines.length - visible);
      if (key.name === "escape") {
        setSelectedAgentId(null);
        setAgentOutputStart(0);
      } else if (key.name === "up") setAgentOutputStart((current) => Math.max(0, current - 1));
      else if (key.name === "down")
        setAgentOutputStart((current) => Math.min(maximum, current + 1));
      else if (key.name === "pageup")
        setAgentOutputStart((current) => Math.max(0, current - visible));
      else if (key.name === "pagedown")
        setAgentOutputStart((current) => Math.min(maximum, current + visible));
      else if (key.name === "home") setAgentOutputStart(0);
      else if (key.name === "end") setAgentOutputStart(maximum);
      else return;
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (key.ctrl && key.name === "t" && !terminalOpen && client.terminals) {
      key.preventDefault();
      key.stopPropagation();
      setTerminalOpen(true);
      return;
    }
    if (terminalOpen) return;
    if (queued && key.ctrl && (key.name === "y" || key.name === "u")) {
      key.preventDefault();
      key.stopPropagation();
      if (key.name === "y") void client.actions.flushQueue(registry, threadId, true);
      else if (client.actions.editQueued(registry, threadId)) activateComposer();
      return;
    }
    if (key.ctrl && key.name === "x") {
      key.preventDefault();
      key.stopPropagation();
      cancelTurn();
      return;
    }
    if (mode === "agents") {
      if (key.ctrl || key.meta || key.option || agents.length === 0) return;
      const selectableCount = agentsExpanded ? agents.length + 1 : 1;
      if (key.name === "up") {
        const position = (resolvedAgentCursor + selectableCount) % selectableCount;
        setAgentCursor(position - 1);
      } else if (key.name === "down") {
        const position = (resolvedAgentCursor + 2) % selectableCount;
        setAgentCursor(position - 1);
      } else if (key.name === "return" || key.name === "enter" || key.name === "space") {
        if (resolvedAgentCursor === -1) setAgentsExpanded((current) => !current);
        else {
          const agent = agents[resolvedAgentCursor];
          if (agent) {
            setSelectedAgentId(agent.id);
            setAgentOutputStart(0);
          }
        }
      } else if (key.name === "escape" || key.name === "tab") setMode(agentReturnMode);
      else return;
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (key.ctrl || key.meta || key.option || mode !== "history") return;
    switch (key.name) {
      case "/":
        setSearch({ query: "", index: 0 });
        break;
      case "return":
      case "enter":
      case "i":
        activateComposer();
        break;
      case "n":
        onNewThread?.();
        break;
      case "a":
        setMode(question && requests.approvals.length === 0 ? "questions" : "requests");
        break;
      case "g":
        if (agents.length === 0) return;
        activateAgents("history");
        break;
      case "t":
        setShowDetails((value) => !value);
        setExpandedToolGroups(new Map());
        break;
      case "d":
        onDiff?.();
        break;
      case "o":
        onOpenPullRequest?.();
        break;
      case "escape":
      case "left":
      case "backspace":
        onBack();
        break;
      case "tab":
        if (agents.length > 0 && !key.shift) activateAgents("history");
        else onBack();
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
        {...(onTerminalFocusChange ? { onFocusChange: onTerminalFocusChange } : {})}
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
    <Stack position="relative" flexDirection="column" width="100%" height="100%" overflow="hidden">
      {thread?.worktreePath ? (
        <Text
          height={1}
          flexShrink={0}
          tone="accent"
          wrapMode="none"
          truncate
        >{`Worktree: ${inlineTerminalText(thread.worktreePath)}`}</Text>
      ) : null}
      <Stack
        id="conversation-history"
        flexGrow={1}
        flexDirection="column"
        overflow="hidden"
        onMouseScroll={(event) => {
          const direction = event.scroll?.direction;
          if (direction !== "up" && direction !== "down") return;
          const distance = Math.max(3, Math.round(Math.abs(event.scroll?.delta ?? 1)));
          scrollTo(start + (direction === "up" ? -distance : distance));
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          if (event.button === 0) setMode("history");
        }}
      >
        {lines.length === 0 ? (
          <Text tone="muted">{empty}</Text>
        ) : (
          lines.slice(start, start + count).map((line) => (
            <ConversationText
              key={`${line.id}:${line.line}`}
              line={line}
              search={search?.query ?? ""}
              onToggleToolGroup={(id) => {
                setAnchor({ id, line: 0 });
                setExpandedToolGroups((groups) => {
                  const next = new Map(groups);
                  next.set(id, !(groups.get(id) ?? showDetails));
                  return next;
                });
              }}
            />
          ))
        )}
      </Stack>
      {search ? (
        <Stack height={1} flexShrink={0} flexDirection="row">
          <Text tone="accent">Find: </Text>
          <input
            id="thread-search-input"
            flexGrow={1}
            focused={active && mode === "history" && !terminalOpen && !selectedAgent}
            value={search.query}
            placeholder="Search loaded output..."
            onInput={(query) => setSearch({ query, index: 0 })}
          />
          <Text tone={search.query && !matches.length ? "warning" : "muted"}>
            {matches.length
              ? `${matchIndex + 1}/${matches.length}`
              : search.query
                ? "No matches"
                : "Type to search"}
          </Text>
        </Stack>
      ) : null}
      {interaction.error ? (
        <Text height={1} flexShrink={0} tone="danger" wrapMode="none" truncate>
          {interaction.error}
        </Text>
      ) : null}
      {gap ? <Stack height={gap} flexShrink={0} /> : null}
      {question ? (
        <Panel
          id="inline-question"
          title={mode === "questions" ? "Agent question" : "Agent question · click to answer"}
          height={questionHeight}
          flexShrink={0}
          width="100%"
          flexDirection="column"
          borderTone={mode === "questions" ? "borderFocused" : "warning"}
          onMouseDown={(event) => {
            if (!active || event.button !== 0 || mode === "questions") return;
            event.preventDefault();
            event.stopPropagation();
            setMode("questions");
          }}
        >
          <Questions
            key={question.requestId}
            request={question}
            client={client}
            threadId={threadId}
            active={active && mode === "questions" && !selectedAgent}
            width={Math.max(1, width - 2)}
            height={questionHeight - 2}
            inline
            onBack={() => setMode("history")}
          />
        </Panel>
      ) : null}
      {queued ? (
        <Stack id="queued-message" height={2} flexShrink={0}>
          <Text tone="warning" height={1} wrapMode="none" truncate>
            {queued.status === "sending"
              ? "Sending queued message"
              : queued.status === "held"
                ? "Queue paused"
                : "Queued"}
            {` (${interaction.queue.length}): ${inlineTerminalText(queued.command.message.text) || "[image]"}`}
          </Text>
          <Text tone="muted" height={1} wrapMode="none" truncate>
            {queued.status === "sending"
              ? "Sending to the agent..."
              : "Ctrl+Y Send now · Ctrl+U Edit · Ctrl+X Stop/pause"}
          </Text>
        </Stack>
      ) : null}
      <Stack id="conversation-activity" height={1} flexShrink={0} flexDirection="row">
        <Text
          id="thread-diff-action"
          tone="accent"
          flexShrink={0}
          onMouseDown={(event) => {
            if (!active || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onDiff?.();
          }}
        >
          [D Changes]{" "}
        </Text>
        <ThreadActivityIndicator phase={phase} visible={active} />
        <Text tone={requestCount ? "warning" : "muted"} flexGrow={1} wrapMode="none" truncate>
          {"  "}
          {requestCount || phase === "waiting_for_approval" || phase === "waiting_for_input"
            ? "A: respond to requests"
            : interaction.pending
              ? "Sending command..."
              : queued?.status === "queued"
                ? "Sends after next tool call / turn end"
                : (interaction.notice ?? "T: tool details")}
        </Text>
        <Text tone="muted" flexShrink={0}>
          {anchor !== null ? "History / End: live" : page?.hasMore ? "Home: earlier" : ""}
        </Text>
      </Stack>
      <ComposerControls
        client={client}
        threadId={threadId}
        active={active}
        focused={mode === "composer"}
        editorHeight={editorHeight}
        suggestedReplies={suggestedReplies}
        availableHeight={height - 1}
        onActivate={activateComposer}
        onDraftChange={() => setAnchor(null)}
        onBlur={() => setMode("history")}
        onMenuChange={setComposerMenuOpen}
        {...(agents.length > 0 ? { onFocusNext: () => activateAgents("composer") } : {})}
        onSubmit={() => {
          setAnchor(null);
          void client.actions.send(registry, threadId);
        }}
        {...(thread?.latestTurn?.state === "running" || queued
          ? { onCancel: cancelTurn, cancelPending: interaction.pending === "stop" }
          : {})}
      />
      {agents.length > 0 ? (
        <AgentSwarmPanel
          agents={agents}
          height={agentPanelHeight}
          cursor={resolvedAgentCursor}
          active={mode === "agents"}
          expanded={agentsExpanded}
          onSelect={setAgentCursor}
          onToggle={() => setAgentsExpanded((current) => !current)}
          onOpen={(agentId) => {
            setSelectedAgentId(agentId);
            setAgentOutputStart(0);
          }}
        />
      ) : null}
      {selectedAgent ? (
        <AgentOutputOverlay
          agent={selectedAgent}
          activities={thread?.activities ?? []}
          width={width}
          height={height}
          start={agentOutputStart}
          onScroll={setAgentOutputStart}
          onClose={() => {
            setSelectedAgentId(null);
            setAgentOutputStart(0);
          }}
        />
      ) : null}
    </Stack>
  );
}
