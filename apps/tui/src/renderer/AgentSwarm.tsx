import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { formatSubagentModelLabel } from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { conversationLines } from "../ui/conversationLines.ts";
import { Panel } from "../ui/Panel.tsx";
import { ConversationText } from "../ui/ShellCommandText.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { projectRecordedThreadTimeline } from "../features/chat/timeline.ts";
import { useThemeColor } from "../ui/context.tsx";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function activityBelongsToAgent(
  activity: OrchestrationThreadActivity,
  agentId: string,
): boolean {
  const payload = record(activity.payload);
  return payload?.agentId === agentId || payload?.taskId === agentId;
}

export function agentOutputLines(
  agent: RuntimeSubagent,
  activities: readonly OrchestrationThreadActivity[],
  width: number,
) {
  const attributed = activities.filter((activity) => activityBelongsToAgent(activity, agent.id));
  return conversationLines(
    projectRecordedThreadTimeline({ messages: [], activities: attributed }),
    width,
    true,
  );
}

const statusTone = (status: RuntimeSubagent["status"]) =>
  status === "failed"
    ? ("danger" as const)
    : status === "completed"
      ? ("success" as const)
      : status === "running" || status === "pending" || status === "waiting"
        ? ("accent" as const)
        : ("muted" as const);

export function AgentSwarmPanel({
  agents,
  height,
  cursor,
  active,
  expanded,
  onSelect,
  onToggle,
  onOpen,
}: {
  readonly agents: readonly RuntimeSubagent[];
  readonly height: number;
  readonly cursor: number;
  readonly active: boolean;
  readonly expanded: boolean;
  readonly onSelect: (index: number) => void;
  readonly onToggle: () => void;
  readonly onOpen: (agentId: string) => void;
}) {
  const selectedBackground = useThemeColor("selection");
  const visibleCount = Math.max(1, height - 3);
  const rowCursor = Math.max(0, cursor);
  const start = Math.max(0, Math.min(rowCursor - visibleCount + 1, agents.length - visibleCount));
  return (
    <Panel
      id="agent-swarm"
      title={`Agent swarm${active ? " · Enter selects" : " · Tab/G focus"}`}
      height={height}
      flexShrink={0}
      width="100%"
      borderTone={active ? "borderFocused" : "border"}
      flexDirection="column"
    >
      <Stack
        id="agent-swarm-toggle"
        height={1}
        flexShrink={0}
        {...(active && cursor === -1 && selectedBackground
          ? { backgroundColor: selectedBackground }
          : {})}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onSelect(-1);
          onToggle();
        }}
      >
        <Text
          height={1}
          tone={active && cursor === -1 ? "accent" : "text"}
          strong={active && cursor === -1}
          wrapMode="none"
        >
          {`${expanded ? "[x]" : "[ ]"} Show agents (${agents.length})`}
        </Text>
      </Stack>
      {expanded
        ? agents.slice(start, start + visibleCount).map((agent, offset) => {
            const index = start + offset;
            const selected = active && index === cursor;
            const model = formatSubagentModelLabel(agent.model, agent.effort);
            return (
              <Stack
                key={agent.id}
                id={`agent-row-${agent.id}`}
                height={1}
                flexShrink={0}
                flexDirection="row"
                {...(selected && selectedBackground ? { backgroundColor: selectedBackground } : {})}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(index);
                  onOpen(agent.id);
                }}
              >
                <Text
                  height={1}
                  flexGrow={1}
                  minWidth={0}
                  tone={selected ? "accent" : "text"}
                  strong={selected}
                  wrapMode="none"
                  truncate
                >
                  {`${selected ? ">" : " "} ${inlineTerminalText(agent.title)}`}
                </Text>
                <Text height={1} flexShrink={0} tone="muted" wrapMode="none">
                  {model ? ` ${inlineTerminalText(model)} · ` : " "}
                </Text>
                <Text height={1} flexShrink={0} tone={statusTone(agent.status)} wrapMode="none">
                  {agent.status}
                </Text>
              </Stack>
            );
          })
        : null}
    </Panel>
  );
}

export function AgentOutputOverlay({
  agent,
  activities,
  width,
  height,
  start,
  onScroll,
  onClose,
}: {
  readonly agent: RuntimeSubagent;
  readonly activities: readonly OrchestrationThreadActivity[];
  readonly width: number;
  readonly height: number;
  readonly start: number;
  readonly onScroll: (next: number) => void;
  readonly onClose: () => void;
}) {
  const lines = agentOutputLines(agent, activities, Math.max(1, width - 4));
  const count = Math.max(1, height - 4);
  const maxStart = Math.max(0, lines.length - count);
  const resolvedStart = Math.max(0, Math.min(maxStart, start));
  const fallback = agent.error ?? agent.result ?? agent.progress ?? "No agent output yet.";
  return (
    <Panel
      id="agent-output-overlay"
      position="absolute"
      top={0}
      left={0}
      zIndex={80}
      width="100%"
      height="100%"
      title={`Agent: ${inlineTerminalText(agent.title)} · Esc closes`}
      borderTone="borderFocused"
      flexDirection="column"
    >
      <Stack height={1} flexShrink={0} flexDirection="row">
        <Text flexGrow={1} tone={statusTone(agent.status)} strong wrapMode="none" truncate>
          {agent.status}
        </Text>
        <Text
          id="agent-output-close"
          flexShrink={0}
          tone="muted"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
        >
          [ Close ]
        </Text>
      </Stack>
      <Stack
        id="agent-output-history"
        flexGrow={1}
        flexDirection="column"
        overflow="hidden"
        onMouseScroll={(event) => {
          const direction = event.scroll?.direction;
          if (direction !== "up" && direction !== "down") return;
          const distance = Math.max(3, Math.round(Math.abs(event.scroll?.delta ?? 1)));
          onScroll(resolvedStart + (direction === "up" ? -distance : distance));
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {lines.length === 0 ? (
          <Text tone="muted">{inlineTerminalText(fallback)}</Text>
        ) : (
          lines
            .slice(resolvedStart, resolvedStart + count)
            .map((line) => <ConversationText key={`${line.id}:${line.line}`} line={line} />)
        )}
      </Stack>
    </Panel>
  );
}
