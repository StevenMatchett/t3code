import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { decodePasteBytes, type BoxRenderable } from "@opentui/core";
import { usePaste, useTerminalDimensions } from "@opentui/react";
import type { ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useMemo, useState, useContext, useEffect, useRef } from "react";

import { AgentOutputOverlay, AgentSwarmPanel, agentOutputLines } from "./AgentSwarm.tsx";
import { Composer } from "./composer/Composer.tsx";
import { NoticeRow } from "./conversation/NoticeRow.tsx";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { RequestDock } from "./conversation/RequestDock.tsx";
import { StatusRow } from "./conversation/StatusRow.tsx";
import { useTranscript, type TranscriptAnchor } from "./conversation/useTranscript.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import type { TuiAgent } from "../connection/models.ts";
import { approvalOptions } from "../features/chat/interactions.ts";
import { threadActivityPhase } from "../features/chat/threadActivity.ts";
import { pastedImagePaths } from "../features/chat/imageAttachments.ts";
import { suggestedReplies as parseSuggestedReplies } from "../features/chat/suggestedReplies.ts";
import { ConversationText } from "../ui/ShellCommandText.tsx";
import { conversationRows, requestPanelHeight } from "../ui/layout.ts";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateMessage.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { Panel } from "../ui/Panel.tsx";
import { inlineTerminalText, wrapTerminalLines, wrapTerminalWords } from "../ui/textLayout.ts";
import { useOutputVim } from "./useOutputVim.ts";
import { useOutputLinkMenu } from "../ui/OutputLinkMenu.tsx";
import { ThreadTerminal } from "./ThreadTerminal.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { useUi } from "../ui/context.tsx";

export function Conversation({
  client,
  threadId,
  width,
  height,
  active,
  onBack,
  onOpenThread,
  onDiff,
  onPlan,
  composerFocusRequest = 0,
  onTerminalFocusChange,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly onBack: () => void;
  /** Opens another thread in this environment; false when it is not known yet. */
  readonly onOpenThread?: (threadId: ThreadId) => boolean;
  readonly composerFocusRequest?: number;
  readonly onDiff?: () => void;
  readonly onPlan?: () => void;
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
  const parentThreadId =
    thread?.lineage?.relationshipToParent === "subagent" ? thread.lineage.parentThreadId : null;
  // The provider runs its own subagents, so their threads take no messages; steer the parent.
  const readOnly =
    thread?.lineage?.relationshipToParent === "subagent" && thread.creationSource === "provider";
  const [savedView] = useState(() => client.session?.conversation(threadId));
  const [mode, setMode] = useState<
    "history" | "composer" | "requests" | "questions" | "secret" | "agents"
  >(savedView?.mode ?? "history");
  const previousComposerFocusRequest = useRef(composerFocusRequest);
  useEffect(() => {
    if (previousComposerFocusRequest.current === composerFocusRequest) return;
    previousComposerFocusRequest.current = composerFocusRequest;
    setMode("composer");
  }, [composerFocusRequest]);
  const [anchor, setAnchor] = useState<TranscriptAnchor | null>(savedView?.anchor ?? null);
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
  const [search, setSearch] = useState<{ query: string; index: number } | null>(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  useEffect(() => {
    client.session?.saveConversation(threadId, {
      // A restored thread focuses a waiting request itself, so this mode never needs saving.
      mode: mode === "secret" ? "history" : mode,
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
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- A restored or requested composer focus cannot land on a read-only thread.
    if (readOnly && mode === "composer") setMode("history");
  }, [readOnly, mode]);
  const linkedPullRequest = visibleThreadPullRequests(thread?.pullRequests ?? [])[0];
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
  const secretRequest = approval || question ? undefined : thread?.secretRequests?.[0];
  const requestId = approval?.requestId ?? question?.requestId ?? secretRequest?.id ?? null;
  const requestMode = approval ? "requests" : question ? "questions" : "secret";
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
      if (mode === "questions" || mode === "requests" || mode === "secret") setMode("composer");
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
    if (readOnly) return;
    setSearch(null);
    setAnchor(null);
    setMode("composer");
  };
  const togglePastes = () => {
    if (!showPastes) activateComposer();
    setShowPastes((value) => !value);
  };
  const activateAgents = (returnMode: "history" | "composer") => {
    setAgentReturnMode(returnMode);
    setAgentCursor(-1);
    setMode("agents");
  };
  // Agents with their own thread open it in full; the rest show their output in an overlay.
  const openAgent = (agent: TuiAgent) => {
    if (agent.childThreadId && onOpenThread?.(agent.childThreadId)) return;
    setSelectedAgentId(agent.id);
    setAgentOutputStart(0);
  };
  const openParent = () => {
    if (parentThreadId) onOpenThread?.(parentThreadId);
  };
  usePaste((event) => {
    if (
      !active ||
      readOnly ||
      linkMenu.isOpen ||
      selectedAgent ||
      mode === "questions" ||
      mode === "requests" ||
      mode === "secret" ||
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
  const composerHeight = readOnly
    ? 3
    : editorHeight + attachmentHeight + suggestedReplyHeight + pastePreviewHeight + 4;
  const agentPanelHeight =
    agents.length > 0 ? (agentsExpanded ? Math.min(6, agents.length + 3) : 3) : 0;
  const requestContent = approval
    ? approvalOptions(approval).length +
      Math.min(
        4,
        wrapTerminalLines(approval.detail ?? approval.requestKind, Math.max(1, width - 4)).length,
      ) +
      1
    : question
      ? question.questions.reduce((largest, item) => Math.max(largest, item.options.length), 0) + 8
      : secretRequest
        ? Math.min(4, wrapTerminalWords(secretRequest.reason, Math.max(1, width - 4)).length) + 3
        : 0;
  const requestHeight =
    approval || question || secretRequest
      ? requestPanelHeight(height, composerHeight, agentPanelHeight, requestContent)
      : 0;
  const rowLayout = conversationRows({
    height,
    composer: composerHeight,
    agents: agentPanelHeight,
    request: requestHeight,
    hasNotice: Boolean(search || interaction.error || queued),
  });
  const count = rowLayout.transcript;
  const noticeHeight = rowLayout.notice;
  const page = state.history;
  const transcript = useTranscript({
    client,
    threadId,
    thread,
    page,
    width,
    count,
    expanded: showDetails,
    expandedToolGroups,
    renderMarkdown,
    unicode: capabilities.unicode,
    search,
    anchor,
    setAnchor,
  });
  const { lines, matches, matchIndex, start, linesBelow, scrollTo, pinTo } = transcript;
  const vim = useOutputVim({
    lines,
    start,
    count,
    scrollTo: pinTo,
    onPaste: (text) => {
      if (readOnly) return;
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
  const agentVisible = Math.max(1, height - 4);
  const agentMaximum = Math.max(0, selectedAgentLines.length - agentVisible);
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
  const regionOpen = !terminalOpen && !selectedAgent;
  useKeyLayer("conversation", {
    bindings: {
      "thread.openPlan": {
        enabled: Boolean(thread?.proposedPlan),
        run: () => onPlan?.(),
      },
      "terminal.toggle": {
        enabled: Boolean(client.terminals) && !terminalOpen,
        run: () => setTerminalOpen(true),
      },
      "thread.stop": {
        enabled:
          regionOpen && !readOnly && (thread?.latestTurn?.state === "running" || Boolean(queued)),
        run: cancelTurn,
      },
      "thread.steerQueuedMessage": {
        enabled: regionOpen && Boolean(queued),
        run: () => void client.actions.flushQueue(registry, threadId, true),
      },
      "thread.editQueuedMessage": {
        enabled: regionOpen && Boolean(queued),
        run: () => {
          if (client.actions.editQueued(registry, threadId)) activateComposer();
        },
      },
      "view.toggleMarkdown": {
        enabled:
          !terminalOpen &&
          !search &&
          !selectedAgent &&
          (mode === "history" || mode === "composer" || mode === "agents"),
        label: renderMarkdown ? "Raw Markdown" : "Render Markdown",
        run: toggleMarkdown,
      },
      "composer.togglePastes": {
        enabled:
          regionOpen &&
          !search &&
          (mode === "history" || mode === "composer") &&
          interaction.pastes.length > 0,
        label: showPastes ? "Hide pastes" : "Show pastes",
        run: togglePastes,
      },
    },
  });
  useKeyLayer("find", {
    active: Boolean(search) && regionOpen && mode === "history",
    typing: true,
    bindings: {
      "find.close": () => {
        scrollTo(start);
        setSearch(null);
      },
      "find.next": () => {
        if (search)
          setSearch({
            ...search,
            index: matches.length ? (matchIndex + 1) % matches.length : 0,
          });
      },
      "find.previous": () => {
        if (search)
          setSearch({
            ...search,
            index: matches.length ? (matchIndex - 1 + matches.length) % matches.length : 0,
          });
      },
    },
  });
  useKeyLayer("agentOutput", {
    active: selectedAgent !== null,
    modal: true,
    context: "Agent output",
    raw: (key) => {
      if (agentVim.handleKey(key)) return true;
      if (!key.ctrl && !key.meta && !key.option) agentVim.reset();
      return false;
    },
    bindings: {
      "agentOutput.close": () => {
        setSelectedAgentId(null);
        setAgentOutputStart(0);
      },
      "agentOutput.scrollUp": () => setAgentOutputStart((current) => Math.max(0, current - 1)),
      "agentOutput.scrollDown": () =>
        setAgentOutputStart((current) => Math.min(agentMaximum, current + 1)),
      "agentOutput.pageUp": () =>
        setAgentOutputStart((current) => Math.max(0, current - agentVisible)),
      "agentOutput.pageDown": () =>
        setAgentOutputStart((current) => Math.min(agentMaximum, current + agentVisible)),
      "agentOutput.top": () => setAgentOutputStart(0),
      "agentOutput.bottom": () => setAgentOutputStart(agentMaximum),
      "agentOutput.toggleMarkdown": {
        label: renderMarkdown ? "Raw Markdown" : "Render Markdown",
        run: toggleMarkdown,
      },
      "agentOutput.vim": () => false,
    },
  });
  const moveAgents = (offset: number) => {
    const selectableCount = agentsExpanded ? agents.length + 1 : 1;
    const position = (resolvedAgentCursor + 1 + offset + selectableCount) % selectableCount;
    setAgentCursor(position - 1);
  };
  useKeyLayer("agents", {
    active: regionOpen && mode === "agents" && agents.length > 0,
    bindings: {
      "agents.up": () => moveAgents(-1),
      "agents.down": () => moveAgents(1),
      "agents.open": () => {
        if (resolvedAgentCursor === -1) setAgentsExpanded((current) => !current);
        else {
          const agent = agents[resolvedAgentCursor];
          if (agent) openAgent(agent);
        }
      },
      "agents.back": () => setMode(agentReturnMode),
    },
  });
  useKeyLayer("history", {
    active: regionOpen && mode === "history" && !search,
    raw: (key) => {
      if (queued && key.ctrl && key.name === "u") return false;
      if (vim.handleKey(key)) return true;
      if (!key.ctrl && !key.meta && !key.option) vim.reset();
      return false;
    },
    bindings: {
      "composer.focus": { enabled: !readOnly, run: activateComposer },
      "history.back": onBack,
      "history.nextRegion": {
        label: agents.length > 0 ? "Agents" : "Sidebar",
        run: () => {
          if (agents.length > 0) activateAgents("history");
          else onBack();
        },
      },
      "history.previousRegion": onBack,
      "thread.find": () => setSearch({ query: "", index: 0 }),
      "history.scrollUp": () => scrollTo(start - 1),
      "history.scrollDown": () => scrollTo(start + 1),
      "history.pageUp": () => scrollTo(start - count),
      "history.pageDown": () => scrollTo(start + count),
      "history.top": () => {
        scrollTo(0);
        if (page?.hasMoreHistory && !page.loading) client.loadOlder(registry, threadId);
      },
      "history.live": { enabled: anchor !== null, run: () => setAnchor(null) },
      "thread.toggleDetails": () => {
        setShowDetails((value) => !value);
        setExpandedToolGroups(new Map());
      },
      "thread.openRequests": {
        enabled: Boolean(approval || question || secretRequest),
        run: () => setMode(requestMode),
      },
      "thread.openParent": { enabled: parentThreadId !== null, run: openParent },
      "history.vimMove": () => false,
      "history.vimWord": () => false,
      "history.vimLineEdge": () => false,
      "history.vimEnds": () => false,
      "history.vimPage": () => false,
      "history.select": () => false,
      "history.yank": () => false,
      "history.paste": { enabled: !readOnly, run: () => false },
      "history.openLink": () => false,
    },
  });
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
  // An answered request stays on the server until it confirms, but it no longer needs the reader.
  const answered =
    (phase === "waiting_for_approval" || phase === "waiting_for_input") && !approval && !question;
  const shownPhase = answered ? "running" : phase;
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
        {!capabilities.color &&
        (composerMenuOpen || linkMenu.isOpen || selectedAgent) ? null : lines.length === 0 ? (
          state.status === "deleted" ? (
            <EmptyState
              title="This thread was deleted."
              description="Esc returns to your threads."
            />
          ) : Option.isSome(state.error) ? (
            <ErrorState title="Conversation unavailable. R retries the connection." />
          ) : thread === null ? (
            <LoadingState title="Loading conversation..." />
          ) : (
            <EmptyState
              title="No messages in this thread."
              {...(readOnly ? {} : { description: "Press Enter to write the first one." })}
            />
          )
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
            const agent = agents.find((candidate) => candidate.id === agentId);
            if (agent) openAgent(agent);
          }}
        />
      ) : null}
      <Stack
        visible={capabilities.color || !selectedAgent}
        flexDirection="column"
        flexShrink={0}
        width="100%"
        overflow="visible"
      >
        <NoticeRow
          height={noticeHeight}
          search={search}
          matchCount={matches.length}
          matchIndex={matchIndex}
          inputFocused={active && mode === "history" && !terminalOpen && !selectedAgent}
          onSearchInput={(query) => setSearch({ query, index: 0 })}
          error={interaction.error}
          queued={queued}
          queueLength={interaction.queue.length}
        />
        <RequestDock
          approval={approval}
          question={question}
          secret={secretRequest}
          focused={mode === requestMode}
          active={active && !selectedAgent}
          client={client}
          threadId={threadId}
          width={width}
          height={requestHeight}
          onFocus={() => setMode(requestMode)}
          onBack={() => setMode("history")}
        />
        <StatusRow
          worktree={Boolean(thread?.worktreePath)}
          phase={shownPhase}
          animate={active}
          // A notice or the way back to live output matters more than when the turn ended.
          timingTurn={
            (anchor !== null || interaction.notice) &&
            runningSince === null &&
            thread?.latestTurn?.state !== "running"
              ? null
              : timingTurn
          }
          runningSince={runningSince}
          showParent={parentThreadId !== null}
          renderMarkdown={renderMarkdown}
          message={
            answered
              ? "Response sent."
              : approval || question || secretRequest
                ? mode === requestMode
                  ? ""
                  : "A: respond to requests"
                : interaction.pending
                  ? "Sending command..."
                  : queued?.status === "queued"
                    ? "Sends after next tool call / turn end"
                    : (interaction.notice ??
                      (thread?.proposedPlan?.status === "active" &&
                      thread.latestTurn?.state !== "running"
                        ? "Plan ready: Ctrl+L to review"
                        : ""))
          }
          messageTone={approval || question || secretRequest ? "warning" : "muted"}
          detail={[
            linkedPullRequest
              ? `PR #${linkedPullRequest.number}${linkedPullRequest.snapshot?.state ? ` ${linkedPullRequest.snapshot.state}` : ""}`
              : "",
            linkMenu.notice,
            mode === "history" ? vim.status : "",
            anchor !== null
              ? `${linesBelow > 0 ? `${linesBelow} below · ` : ""}History / End: live`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          onDiff={() => {
            if (active) onDiff?.();
          }}
          onParent={() => {
            if (active) openParent();
          }}
          onToggleMarkdown={() => {
            if (!active || linkMenu.isOpen) return;
            setSearch(null);
            toggleMarkdown();
          }}
        />
        {readOnly ? (
          <Panel id="provider-subagent-bar" height={composerHeight} flexShrink={0} width="100%">
            <Text height={1} tone="muted" wrapMode="none" truncate>
              {`${inlineTerminalText(thread?.modelSelection.model ?? "Provider")} subagent · Runs on its own; steer it from the parent thread`}
            </Text>
          </Panel>
        ) : (
          <Composer
            client={client}
            threadId={threadId}
            active={active && !linkMenu.isOpen}
            focused={mode === "composer"}
            editorHeight={editorHeight}
            showPastes={showPastes}
            pastePreviewHeight={pastePreviewHeight}
            onTogglePastes={togglePastes}
            suggestedReplies={suggestedReplies}
            availableHeight={height - 1}
            width={width}
            onActivate={() => {
              vim.reset();
              activateComposer();
            }}
            onDraftChange={() => setAnchor(null)}
            onBlur={() => {
              vim.reset();
              setMode("history");
            }}
            sendLabel={thread?.latestTurn?.state === "running" || queued ? "Queue" : "Send"}
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
        )}
      </Stack>
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
