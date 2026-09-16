import {
  extractCommandOutputText,
  extractWorkLogToolLifecycleStatus,
  workLogEntryIsToolLike,
  type WorkLogPresentationEntry,
  type WorkLogToolLifecycleStatus,
} from "@t3tools/client-runtime/work-log/presentation";
import {
  isToolLifecycleItemType,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import { normalizeTerminalText, type TerminalTextOptions } from "./terminalText.ts";

export type TimelineMessageKind = "user" | "assistant" | "system";
export type TimelineActivityKind = "reasoning" | "tool" | "error" | "activity";

interface TimelineRowBase<K extends string> {
  readonly id: string;
  readonly kind: K;
  readonly createdAt: string;
  readonly turnId: string | null;
  readonly text: string;
}

export interface TimelineMessageRow extends TimelineRowBase<TimelineMessageKind> {
  readonly source: "message";
  readonly sourceId: OrchestrationMessage["id"];
  readonly streaming: boolean;
}

export interface TimelineActivityRow extends TimelineRowBase<TimelineActivityKind> {
  readonly source: "activity";
  readonly sourceId: OrchestrationThreadActivity["id"];
  readonly activityKind: string;
  readonly activityTone: OrchestrationThreadActivity["tone"];
  readonly sequence?: number;
  readonly detail?: string;
  readonly toolCallId?: string;
  readonly status?: WorkLogToolLifecycleStatus;
}

export type TimelineRow = TimelineMessageRow | TimelineActivityRow;

export interface RecordedThreadTimeline {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export interface TimelineProjectionOptions extends TerminalTextOptions {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function safeInlineText(value: string, options: TerminalTextOptions): string {
  return normalizeTerminalText(value, options).replace(/\n+/gu, " ").trim();
}

function encodeRowIdPart(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    let encoded = "";
    for (let index = 0; index < value.length; index += 1) {
      encoded += `%u${value.charCodeAt(index).toString(16).padStart(4, "0")}`;
    }
    return encoded;
  }
}

function encodedRowId(namespace: string, sourceId: string): string {
  return `${namespace}:${encodeRowIdPart(sourceId)}`;
}

function toolRowId(turnId: string | null, toolCallId: string): string {
  return `activity:tool:${encodeRowIdPart(turnId ?? "-")}:${encodeRowIdPart(toolCallId)}`;
}

function compareMessageVersions(left: OrchestrationMessage, right: OrchestrationMessage): number {
  const updatedAt = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedAt !== 0) return updatedAt;
  if (left.streaming !== right.streaming) return left.streaming ? -1 : 1;
  const createdAt = left.createdAt.localeCompare(right.createdAt);
  if (createdAt !== 0) return createdAt;
  return left.text.localeCompare(right.text);
}

function deduplicateMessages(
  messages: ReadonlyArray<OrchestrationMessage>,
): ReadonlyArray<OrchestrationMessage> {
  const byId = new Map<OrchestrationMessage["id"], OrchestrationMessage>();
  for (const message of messages) {
    const previous = byId.get(message.id);
    if (previous === undefined || compareMessageVersions(previous, message) <= 0) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()];
}

function deduplicateActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const byId = new Map<OrchestrationThreadActivity["id"], OrchestrationThreadActivity>();
  for (const activity of activities) byId.set(activity.id, activity);
  return [...byId.values()];
}

function extractItemType(payload: Record<string, unknown> | null) {
  const itemType = payload?.itemType;
  return typeof itemType === "string" && isToolLifecycleItemType(itemType) ? itemType : undefined;
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  return nonEmptyString(payload?.toolCallId) ?? nonEmptyString(asRecord(payload?.data)?.toolCallId);
}

function activityKind(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown> | null,
): TimelineActivityKind {
  if (
    activity.tone === "error" ||
    activity.kind === "runtime.error" ||
    activity.kind.endsWith(".failed")
  ) {
    return "error";
  }

  if (
    activity.kind === "task.progress" ||
    activity.kind === "reasoning" ||
    activity.kind.startsWith("reasoning.") ||
    payload?.itemType === "reasoning"
  ) {
    return "reasoning";
  }

  const itemType = extractItemType(payload);
  const status = extractWorkLogToolLifecycleStatus(payload);
  const entry: WorkLogPresentationEntry = {
    label: activity.summary,
    tone: activity.tone === "approval" ? "info" : activity.tone,
    sourceActivityKind: activity.kind,
    turnId: activity.turnId,
    ...(itemType === undefined ? {} : { itemType }),
    ...(status === undefined ? {} : { toolLifecycleStatus: status }),
  };
  return activity.kind.startsWith("tool.") || workLogEntryIsToolLike(entry) ? "tool" : "activity";
}

function activityDetail(
  kind: TimelineActivityKind,
  text: string,
  payload: Record<string, unknown> | null,
  options: TerminalTextOptions,
): string | undefined {
  const direct =
    nonEmptyString(payload?.detail) ??
    nonEmptyString(payload?.message) ??
    nonEmptyString(payload?.summary);
  const output = extractCommandOutputText(payload?.data);
  const raw = kind === "tool" || kind === "error" ? (output ?? direct) : (direct ?? output);
  if (raw === null) return undefined;

  const detail = normalizeTerminalText(raw, options);
  return detail.length > 0 && detail !== text ? detail : undefined;
}

function messageRow(
  message: OrchestrationMessage,
  options: TerminalTextOptions,
): TimelineMessageRow {
  return {
    id: encodedRowId("message", message.id),
    source: "message",
    sourceId: message.id,
    kind: message.role,
    createdAt: message.createdAt,
    turnId: message.turnId,
    text: normalizeTerminalText(message.text, options),
    streaming: message.streaming,
  };
}

function activityRow(
  activity: OrchestrationThreadActivity,
  options: TerminalTextOptions,
): TimelineActivityRow {
  const payload = asRecord(activity.payload);
  const kind = activityKind(activity, payload);
  const rawToolCallId = extractToolCallId(payload);
  const text = normalizeTerminalText(activity.summary, options);
  const detail = activityDetail(kind, text, payload, options);
  const status = extractWorkLogToolLifecycleStatus(payload);
  const safeActivityKind = safeInlineText(activity.kind, options) || "unknown";
  const safeToolCallId = rawToolCallId
    ? safeInlineText(rawToolCallId, { ...options, maxLineLength: 256 })
    : null;

  return {
    id:
      rawToolCallId && activity.kind.startsWith("tool.")
        ? toolRowId(activity.turnId, rawToolCallId)
        : encodedRowId("activity", activity.id),
    source: "activity",
    sourceId: activity.id,
    kind,
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    text: text || `[${safeActivityKind}]`,
    activityKind: safeActivityKind,
    activityTone: activity.tone,
    ...(activity.sequence === undefined ? {} : { sequence: activity.sequence }),
    ...(detail === undefined ? {} : { detail }),
    ...(safeToolCallId ? { toolCallId: safeToolCallId } : {}),
    ...(status === undefined ? {} : { status }),
  };
}

function activityOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    const sequence = left.sequence - right.sequence;
    if (sequence !== 0) return sequence;
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAt = left.createdAt.localeCompare(right.createdAt);
  if (createdAt !== 0) return createdAt;
  return left.id.localeCompare(right.id);
}

function collapseToolLifecycle(rows: ReadonlyArray<TimelineActivityRow>): TimelineActivityRow[] {
  const collapsed: TimelineActivityRow[] = [];
  const rowIndexById = new Map<string, number>();

  for (const row of rows) {
    const previousIndex = rowIndexById.get(row.id);
    const previous = previousIndex === undefined ? undefined : collapsed[previousIndex];
    if (previousIndex === undefined || previous === undefined || row.toolCallId === undefined) {
      rowIndexById.set(row.id, collapsed.length);
      collapsed.push(row);
      continue;
    }

    collapsed[previousIndex] = {
      ...previous,
      sourceId: row.sourceId,
      kind: row.kind,
      text: row.text,
      activityKind: row.activityKind,
      activityTone: row.activityTone,
      ...(row.detail === undefined ? {} : { detail: row.detail }),
      ...(row.status === undefined ? {} : { status: row.status }),
    };
  }

  return collapsed;
}

const timelineKindRank: Readonly<Record<TimelineRow["kind"], number>> = {
  system: 0,
  user: 1,
  reasoning: 2,
  tool: 3,
  activity: 4,
  error: 5,
  assistant: 6,
};

function compareRows(left: TimelineRow, right: TimelineRow): number {
  const createdAt = left.createdAt.localeCompare(right.createdAt);
  if (createdAt !== 0) return createdAt;

  if (left.source === "activity" && right.source === "activity") {
    if (left.sequence !== undefined && right.sequence !== undefined) {
      const sequence = left.sequence - right.sequence;
      if (sequence !== 0) return sequence;
    } else if (left.sequence !== undefined) {
      return 1;
    } else if (right.sequence !== undefined) {
      return -1;
    }
  }

  const kind = timelineKindRank[left.kind] - timelineKindRank[right.kind];
  return kind !== 0 ? kind : left.id.localeCompare(right.id);
}

/** Projects a recorded normalized thread into stable, renderer-neutral terminal rows. */
export function projectRecordedThreadTimeline(
  thread: RecordedThreadTimeline | Pick<OrchestrationThread, "messages" | "activities">,
  options: TimelineProjectionOptions = {},
): ReadonlyArray<TimelineRow> {
  const messages = deduplicateMessages(thread.messages).map((message) =>
    messageRow(message, options),
  );
  const orderedActivities = deduplicateActivities(thread.activities).toSorted(activityOrder);
  const activities = collapseToolLifecycle(
    orderedActivities.map((activity) => activityRow(activity, options)),
  );
  return [...messages, ...activities].toSorted(compareRows);
}
