import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { decodePasteBytes, type BoxRenderable } from "@opentui/core";
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useMemo, useState, useContext, useEffect, useRef } from "react";

import { AgentOutputOverlay, AgentSwarmPanel, agentOutputLines } from "./AgentSwarm.tsx";
import { Approval, Questions } from "./RequestsPanel.tsx";
import { ComposerControls } from "./ProviderPicker.tsx";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { projectRecordedThreadTimeline } from "../features/chat/timeline.ts";
import { threadActivityPhase } from "../features/chat/threadActivity.ts";
import { pastedImagePaths } from "../features/chat/imageAttachments.ts";
import { suggestedReplies as parseSuggestedReplies } from "../features/chat/suggestedReplies.ts";
import { ThreadActivityIndicator } from "../ui/ThreadActivityIndicator.tsx";
import { TurnTiming } from "../ui/TurnTiming.tsx";
import { conversationLines } from "../ui/conversationLines.ts";
import { ConversationText } from "../ui/ShellCommandText.tsx";
import { textMatches } from "../ui/textSearch.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { inlineTerminalText, wrapTerminalWords } from "../ui/textLayout.ts";
import { useOutputVim } from "./useOutputVim.ts";
import { useOutputLinkMenu } from "../ui/OutputLinkMenu.tsx";
import { ThreadTerminal } from "./ThreadTerminal.tsx";
import type { HotkeyHint, HotkeyState } from "../ui/HotkeyBar.tsx";
import { useUi } from "../ui/context.tsx";

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
  onRestore,
  composerFocusRequest = 0,
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
  readonly composerFocusRequest?: number;
  readonly onRestore?: () => void;
  readonly onDiff?: () => void;
  readonly onHintsChange?: (state: HotkeyState) => void;
  readonly onTerminalFocusChange?: (focused: boolean) => void;
}) {
  const { height: terminalHeight } = useTerminalDimensions();
  const { capabilities } = useUi();
  const state = useAtomValue(client.thread(threadId));
  const shell = useAtomValue(client.shell);
  const connection = useAtomValue(client.connection);
  const interaction = useAtomValue(client.actions.state(threadId));
  const queued = interaction.queue[0];
  const registry = useContext(RegistryContext);
  const thread = Option.getOrNull(state.data);
  const [savedView] = useState(() => client.session?.conversation(threadId));
  const [mode, setMode] = useState<"history" | "composer" | "requests" | "questions" | "agents">(
    savedView?.mode ?? "history",
  );
  const previousComposerFocusRequest = useRef(composerFocusRequest);
  useEffect(() => {
    if (previousComposerFocusRequest.current === composerFocusRequest) return;
    previousComposerFocusRequest.current = composerFocusRequest;
    setMode("composer");
  }, [composerFocusRequest]);
  const [anchor, setAnchor] = useState<{ readonly id: string; readonly line: number } | null>(
    savedView?.anchor ?? null,
  );
  const [terminalOpen, setTerminalOpen] = useState(savedView?.terminalOpen ?? false);
  const [showDetails, setShowDetails] = useState(savedView?.showDetails ?? false);
  const [renderMarkdown, setRenderMarkdown] = useState(savedView?.renderMarkdown ?? true);
  const [showPastes, setShowPastes] = useState(false);
  const container = useRef<BoxRenderable | null>(null);
  const linkMenu = useOutputLinkMenu({ active, width, height, container });
  const [expandedToolGroups, setExpandedToolGroups] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(savedView?.expandedToolGroups),
  );
  const [agentCursor, setAgentCursor] = useState(-1);
  const [agentsExpanded, setAgentsExpanded] = useState(savedView?.agentsExpanded ?? true);
  const [agentReturnMode, setAgentReturnMode] = useState<"history" | "composer">("history");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    savedView?.selectedAgentId ?? null,
  );
  const [agentOutputStart, setAgentOutputStart] = useState(0);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [search, setSearch] = useState<{ query: string; index: number } | null>(null);
  useEffect(() => {
    client.session?.saveConversation(threadId, {
      mode,
      anchor,
      terminalOpen,
      showDetails,
      renderMarkdown,
      agentsExpanded,
      selectedAgentId,
      expandedToolGroups: [...expandedToolGroups],
    });
  }, [
    client,
    threadId,
    mode,
    anchor,
    terminalOpen,
    showDetails,
    renderMarkdown,
    agentsExpanded,
    selectedAgentId,
    expandedToolGroups,
  ]);
  const requests = useMemo(() => thread?.requests ?? { approvals: [], userInputs: [] }, [thread]);
  const question = requests.userInputs.find(
    (request) =>
      !interaction.replies.some(
        (reply) => reply.kind === "user-input" && reply.requestId === request.requestId,
      ),
  );
  const approval = requests.approvals.find(
    (request) =>
      !interaction.replies.some(
        (reply) => reply.kind === "approval" && reply.requestId === request.requestId,
      ),
  );
  const focusedRequest = useRef<string | null>(null);
  const requestId = approval?.requestId ?? question?.requestId ?? null;
  const requestMode = approval ? "requests" : "questions";
  const agents = useMemo(() => thread?.agents ?? [], [thread?.agents]);
  const resolvedAgentCursor = Math.max(-1, Math.min(agentCursor, agents.length - 1));
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  useEffect(() => {
    if (!active || terminalOpen || selectedAgent) return;
    if (requestId && focusedRequest.current !== requestId) {
      focusedRequest.current = requestId;
      setMode(requestMode);
    } else if (!requestId) {
      focusedRequest.current = null;
      // oxlint-disable-next-line react/set-state-in-effect -- Return focus when a request is resolved or its response is accepted.
      if (mode === "questions" || mode === "requests") setMode("composer");
    }
  }, [active, terminalOpen, selectedAgent, requestId, requestMode, mode]);
  const selectedAgentLines = useMemo(
    () =>
      selectedAgent
        ? agentOutputLines(
            selectedAgent,
            thread?.activities ?? [],
            Math.max(1, width - 4),
            renderMarkdown,
            capabilities.unicode,
          )
        : [],
    [selectedAgent, thread?.activities, width, renderMarkdown, capabilities.unicode],
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
    if (
      !active ||
      linkMenu.isOpen ||
      selectedAgent ||
      mode === "questions" ||
      mode === "requests" ||
      terminalOpen ||
      search
    )
      return;
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
    if (linkMenu.isOpen)
      return [
        { key: "↑↓", label: "Choose action" },
        { key: "Enter", label: "Select" },
        { key: "Esc", label: "Close menu" },
      ];
    if (search)
      return [
        { key: "Enter/↓", label: "Next match" },
        { key: "Shift+Enter/↑", label: "Previous" },
        { key: "Esc", label: "Close search" },
      ];
    const terminalHint = client.terminals ? [{ key: "Ctrl+T", label: "Terminal" }] : [];
    const pasteHint = interaction.pastes.length
      ? [{ key: "Ctrl+P", label: showPastes ? "Hide pastes" : "Show pastes" }]
      : [];
    const markdownHint = {
      key: "Ctrl+R",
      label: renderMarkdown ? "Raw Markdown" : "Render Markdown",
    };
    if (selectedAgent)
      return [
        markdownHint,
        { key: "hjkl", label: "Move" },
        { key: "v/V", label: "Select" },
        { key: "y/yy", label: "Yank" },
        { key: "p", label: "Paste" },
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
          markdownHint,
          { key: "↑↓", label: "Select" },
          ...terminalHint,
          { key: "Enter/Tab", label: "Choose" },
          { key: "⇧Tab/Esc", label: "Close" },
          { key: "Ctrl+K", label: "Search" },
        ];
      else
        return suggestedReplies.length
          ? [
              markdownHint,
              ...pasteHint,
              { key: "↑↓", label: "Choose reply" },
              ...terminalHint,
              { key: "Enter", label: "Select" },
              { key: "Tab", label: "Options" },
              { key: "Ctrl+K", label: "Search" },
              { key: "Esc", label: "History" },
            ]
          : [
              markdownHint,
              ...pasteHint,
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
        { key: "Enter", label: "Submit" },
        ...terminalHint,
        { key: "PgUp/Dn", label: "Details" },
        { key: "Ctrl+K", label: "Search" },
        { key: "Esc", label: "Back" },
      ];
    if (mode === "agents")
      return [
        markdownHint,
        { key: "↑↓", label: "Select" },
        { key: "Enter", label: "Toggle/open" },
        ...terminalHint,
        { key: "Ctrl+K", label: "Search" },
        { key: "Tab/Esc", label: "Back" },
      ];
    return [
      markdownHint,
      ...pasteHint,
      { key: "Enter", label: "Write" },
      ...terminalHint,
      { key: "hjkl", label: "Move" },
      { key: "v/V", label: "Select" },
      { key: "y/yy", label: "Yank" },
      { key: "p", label: "Paste" },
      { key: "/", label: "Find text" },
      { key: "A", label: "Requests" },
      ...(agents.length ? [{ key: "Tab", label: "Agents" }] : []),
      { key: "T", label: "Details" },
      { key: "D", label: "Diff" },
      { key: "E", label: "Edit from checkpoint" },
      { key: "O", label: "Open link" },
      { key: "N", label: "New thread" },
      { key: "Ctrl+K", label: "Search" },
      { key: "Esc", label: "Threads" },
      ...(width >= 58 ? [{ key: "?", label: "Help" }] : []),
    ];
  }, [
    linkMenu.isOpen,
    interaction.pastes.length,
    showPastes,
    renderMarkdown,
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
  const hotkeyContext = linkMenu.isOpen
    ? "Link menu"
    : selectedAgent
      ? "Agent output"
      : mode === "questions"
        ? "Question"
        : mode === "composer"
          ? composerMenuOpen
            ? "Menu"
            : "Message"
          : mode === "requests"
            ? "Approval"
            : mode === "agents"
              ? "Agents"
              : "Conversation";
  useEffect(() => {
    onHintsChange?.({ context: hotkeyContext, hints });
  }, [hints, hotkeyContext, onHintsChange]);
  const attachmentHeight = interaction.attachments.length > 0 ? 1 : 0;
  const pastePreviewHeight = interaction.pastes.length
    ? showPastes
      ? Math.max(2, Math.min(9, Math.floor(height / 3)))
      : 1
    : 0;
  const suggestedReplyHeight = suggestedReplies.length > 0 ? 1 : 0;
  // Include the border, divider and controls in the cap; retain one input row on tiny terminals.
  const maxEditorHeight = Math.max(
    1,
    Math.floor(terminalHeight * 0.3) - attachmentHeight - suggestedReplyHeight - 4,
  );
  const editorLines = useMemo(
    () => wrapTerminalWords(interaction.draft, Math.max(1, width - 5)).length,
    [interaction.draft, width],
  );
  const editorHeight = Math.min(Math.max(3, editorLines), maxEditorHeight);
  const agentPanelHeight =
    agents.length > 0 ? (agentsExpanded ? Math.min(6, agents.length + 3) : 3) : 0;
  const gap = height >= 12 ? 1 : 0;
  const requestHeight =
    approval || question
      ? Math.max(
          6,
          Math.min(
            15,
            Math.floor(height / 2),
            height -
              (editorHeight + attachmentHeight + suggestedReplyHeight + pastePreviewHeight + 4) -
              agentPanelHeight -
              gap -
              (interaction.error ? 1 : 0) -
              (queued ? 2 : 0) -
              3,
          ),
        )
      : 0;
  const count = Math.max(
    1,
    height -
      1 -
      (editorHeight + attachmentHeight + suggestedReplyHeight + pastePreviewHeight + 4) -
      gap -
      agentPanelHeight -
      requestHeight -
      (search ? 1 : 0) -
      (interaction.error ? 1 : 0) -
      (queued ? 2 : 0),
  );
  const timeline = useMemo(
    () => (thread === null ? [] : projectRecordedThreadTimeline(thread)),
    [thread],
  );
  const lines = useMemo(
    () =>
      conversationLines(
        timeline,
        width,
        showDetails,
        expandedToolGroups,
        renderMarkdown,
        capabilities.unicode,
      ),
    [timeline, width, showDetails, expandedToolGroups, renderMarkdown, capabilities.unicode],
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
  const page = state.history;
  useEffect(() => {
    if (
      anchor &&
      !lines.some((line) => line.id === anchor.id) &&
      page?.hasMoreHistory &&
      !page.loading
    )
      client.loadOlder(registry, threadId);
  }, [client, threadId, anchor, lines, page]);
  const scrollTo = (next: number) => {
    const target = Math.max(0, Math.min(maxStart, next));
    const line = lines[target];
    setAnchor(target === maxStart || line === undefined ? null : { id: line.id, line: line.line });
  };
  const vim = useOutputVim({
    lines,
    start,
    count,
    scrollTo: (next) => {
      const line = lines[Math.max(0, Math.min(maxStart, next))];
      setAnchor(line ? { id: line.id, line: line.line } : null);
    },
    onPaste: (text) => {
      if (!client.actions.addPaste(registry, threadId, text)) {
        client.actions.setDraft(
          registry,
          threadId,
          registry.get(client.actions.state(threadId)).draft + text,
        );
      }
      activateComposer();
    },
  });
  const agentVim = useOutputVim({
    lines: selectedAgentLines,
    start: Math.max(
      0,
      Math.min(agentOutputStart, selectedAgentLines.length - Math.max(1, height - 4)),
    ),
    count: Math.max(1, height - 4),
    scrollTo: setAgentOutputStart,
    onPaste: (text) => {
      if (!client.actions.addPaste(registry, threadId, text)) {
        client.actions.setDraft(
          registry,
          threadId,
          registry.get(client.actions.state(threadId)).draft + text,
        );
      }
      setSelectedAgentId(null);
      activateComposer();
    },
  });
  const cancelTurn = () => {
    void client.actions.interrupt(registry, threadId);
  };
  const toggleMarkdown = () => {
    vim.reset();
    agentVim.reset();
    setAnchor((current) => (current ? { id: current.id, line: 0 } : null));
    setAgentOutputStart(0);
    setRenderMarkdown((current) => !current);
  };
  useKeyboard((key) => {
    if (!active) return;
    if (linkMenu.handleKey(key)) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (
      key.ctrl &&
      key.name === "r" &&
      !key.meta &&
      !key.option &&
      !terminalOpen &&
      !search &&
      (selectedAgent || mode === "history" || mode === "composer" || mode === "agents")
    ) {
      key.preventDefault();
      key.stopPropagation();
      if (!key.repeated) toggleMarkdown();
      return;
    }
    if (
      key.ctrl &&
      key.name === "p" &&
      !key.meta &&
      !key.option &&
      !terminalOpen &&
      !selectedAgent &&
      !search &&
      (mode === "history" || mode === "composer") &&
      interaction.pastes.length
    ) {
      key.preventDefault();
      key.stopPropagation();
      if (!key.repeated) setShowPastes((value) => !value);
      return;
    }
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
      if (agentVim.handleKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        return;
      }
      if (key.ctrl || key.meta || key.option) return;
      agentVim.reset();
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
    if (mode === "history" && vim.handleKey(key)) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (key.ctrl || key.meta || key.option || mode !== "history") return;
    vim.reset();
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
        if (approval || question) setMode(requestMode);
        break;
      case "t":
        setShowDetails((value) => !value);
        setExpandedToolGroups(new Map());
        break;
      case "e":
        onRestore?.();
        break;
      case "d":
        onDiff?.();
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
        if (page?.hasMoreHistory && !page.loading) client.loadOlder(registry, threadId);
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
  const timingTurn =
    phase === "completed" || (phase !== "stale" && thread?.latestTurn?.state === "running")
      ? (thread?.latestTurn ?? null)
      : null;
  const runningSince =
    phase !== "stale" &&
    (thread?.session?.status === "starting" || thread?.session?.status === "running")
      ? thread.session.updatedAt
      : null;
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
  return (
    <Stack
      ref={container}
      position="relative"
      flexDirection="column"
      width="100%"
      height="100%"
      overflow="hidden"
    >
      <Stack
        id="conversation-history"
        flexGrow={1}
        flexDirection="column"
        overflow="hidden"
        onMouseScroll={(event) => {
          const direction = event.scroll?.direction;
          if (direction !== "up" && direction !== "down") return;
          const distance = Math.max(3, Math.round(Math.abs(event.scroll?.delta ?? 1)));
          vim.reset();
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
          lines.slice(start, start + count).map((line, offset) => (
            <ConversationText
              key={`${line.id}:${line.line}`}
              line={line}
              onOpenLinkMenu={linkMenu.open}
              selection={
                active && mode === "history" && !search && !selectedAgent
                  ? vim.range(start + offset)
                  : undefined
              }
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
      {approval ? (
        <Panel
          id="inline-approval"
          title={mode === "requests" ? "Agent approval" : "Agent approval · click to respond"}
          height={requestHeight}
          flexShrink={0}
          width="100%"
          flexDirection="column"
          borderTone={mode === "requests" ? "borderFocused" : "warning"}
          onMouseDown={(event) => {
            if (!active || event.button !== 0 || mode === "requests") return;
            event.preventDefault();
            event.stopPropagation();
            setMode("requests");
          }}
        >
          <Approval
            key={approval.requestId}
            request={approval}
            client={client}
            threadId={threadId}
            active={active && mode === "requests" && !selectedAgent}
            width={Math.max(1, width - 2)}
            height={requestHeight - 2}
            onBack={() => setMode("history")}
          />
        </Panel>
      ) : question ? (
        <Panel
          id="inline-question"
          title={mode === "questions" ? "Agent question" : "Agent question · click to answer"}
          height={requestHeight}
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
            height={requestHeight - 2}
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
        <Text id="thread-workspace-label" tone="accent" height={1} flexShrink={0} wrapMode="none">
          {thread?.worktreePath ? "Worktree" : "Local"}
          {"  "}
        </Text>
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
        <TurnTiming turn={timingTurn} runningSince={runningSince} />
        <Text
          id="output-markdown-toggle"
          tone="accent"
          height={1}
          minWidth={0}
          wrapMode="none"
          truncate
          onMouseDown={(event) => {
            if (!active || linkMenu.isOpen || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            setSearch(null);
            toggleMarkdown();
          }}
        >
          {renderMarkdown ? " [Ctrl+R Markdown]" : " [Ctrl+R Raw]"}
        </Text>
        <Text
          tone={requestCount ? "warning" : "muted"}
          flexGrow={1}
          minWidth={0}
          wrapMode="none"
          truncate
        >
          {"  "}
          {requestCount || phase === "waiting_for_approval" || phase === "waiting_for_input"
            ? "A: respond to requests"
            : interaction.pending
              ? "Sending command..."
              : queued?.status === "queued"
                ? "Sends after next tool call / turn end"
                : (interaction.notice ?? "T: tool details")}
        </Text>
        <Text tone="muted" flexShrink={0} maxWidth="70%" wrapMode="none" truncate>
          {"  "}
          {linkMenu.notice
            ? `${linkMenu.notice} · `
            : mode === "history" && vim.status
              ? `${vim.status} · `
              : ""}
          {anchor !== null ? "History / End: live" : ""}
        </Text>
      </Stack>
      <ComposerControls
        client={client}
        threadId={threadId}
        active={active && !linkMenu.isOpen}
        focused={mode === "composer"}
        editorHeight={editorHeight}
        showPastes={showPastes}
        pastePreviewHeight={pastePreviewHeight}
        onTogglePastes={() => setShowPastes((value) => !value)}
        suggestedReplies={suggestedReplies}
        availableHeight={height - 1}
        onActivate={() => {
          vim.reset();
          activateComposer();
        }}
        onDraftChange={() => setAnchor(null)}
        onBlur={() => {
          vim.reset();
          setMode("history");
        }}
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
          selectionAt={(row) => (active ? agentVim.range(row) : undefined)}
          status={agentVim.status}
          renderMarkdown={renderMarkdown}
          onToggleMarkdown={toggleMarkdown}
          onScroll={(next) => {
            agentVim.reset();
            setAgentOutputStart(next);
          }}
          onClose={() => {
            agentVim.reset();
            setSelectedAgentId(null);
            setAgentOutputStart(0);
          }}
          onOpenLinkMenu={linkMenu.open}
        />
      ) : null}
      {linkMenu.element}
    </Stack>
  );
}
