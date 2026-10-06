import type { TuiMessage, TuiCheckpoint, TuiActivity } from "../../connection/models.ts";
import {
  extractCommandOutputText,
  type WorkLogToolLifecycleStatus,
} from "@t3tools/client-runtime/work-log/presentation";

import { normalizeTerminalText, type TerminalTextOptions } from "./terminalText.ts";
import { toolActivityDetails } from "./activityDetails.ts";

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
  readonly sourceId: TuiMessage["id"];
  readonly streaming: boolean;
}

export interface TimelineActivityRow extends TimelineRowBase<TimelineActivityKind> {
  readonly source: "activity";
  readonly sourceId: TuiActivity["id"];
  readonly activityKind: string;
  readonly activityTone: TuiActivity["tone"];
  readonly sequence?: number;
  readonly detail?: string;
  readonly toolCallId?: string;
  readonly status?: WorkLogToolLifecycleStatus;
  readonly command?: string;
  readonly toolName?: string;
  readonly files?: readonly string[];
}

export interface TimelineChangesRow extends TimelineRowBase<"changes"> {
  readonly source: "checkpoint";
  readonly status: TuiCheckpoint["status"];
  readonly files: TuiCheckpoint["files"];
}

export type TimelineRow = TimelineMessageRow | TimelineActivityRow | TimelineChangesRow;

export interface RecordedThreadTimeline {
  readonly messages: ReadonlyArray<TuiMessage>;
  readonly activities: ReadonlyArray<TuiActivity>;
  readonly checkpoints?: ReadonlyArray<TuiCheckpoint>;
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

function compareMessageVersions(left: TuiMessage, right: TuiMessage): number {
  const updatedAt = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedAt !== 0) return updatedAt;
  if (left.streaming !== right.streaming) return left.streaming ? -1 : 1;
  const createdAt = left.createdAt.localeCompare(right.createdAt);
  if (createdAt !== 0) return createdAt;
  return left.text.localeCompare(right.text);
}

function deduplicateMessages(messages: ReadonlyArray<TuiMessage>): ReadonlyArray<TuiMessage> {
  const byId = new Map<TuiMessage["id"], TuiMessage>();
  for (const message of messages) {
    const previous = byId.get(message.id);
    if (previous === undefined || compareMessageVersions(previous, message) <= 0) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()];
}

function deduplicateActivities(activities: ReadonlyArray<TuiActivity>): ReadonlyArray<TuiActivity> {
  const byId = new Map<TuiActivity["id"], TuiActivity>();
  for (const activity of activities) byId.set(activity.id, activity);
  return [...byId.values()];
}

function extractWorkLogToolLifecycleStatus(
  payload: Record<string, unknown> | null,
): WorkLogToolLifecycleStatus | undefined {
  switch (payload?.status) {
    case "pending":
    case "running":
    case "waiting":
      return "inProgress";
    case "cancelled":
    case "interrupted":
      return "stopped";
    case "inProgress":
    case "completed":
    case "failed":
    case "declined":
    case "stopped":
      return payload.status;
    default:
      return undefined;
  }
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  return nonEmptyString(payload?.toolCallId) ?? nonEmptyString(asRecord(payload?.data)?.toolCallId);
}

function activityKind(
  activity: TuiActivity,
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

  return activity.kind.startsWith("tool.") ||
    activity.tone === "tool" ||
    [
      "command_execution",
      "commandExecution",
      "file_change",
      "fileChange",
      "web_search",
      "file_search",
      "tool_call",
    ].includes(String(payload?.itemType))
    ? "tool"
    : "activity";
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

function messageRow(message: TuiMessage, options: TerminalTextOptions): TimelineMessageRow {
  const images = (message.attachments ?? []).filter((attachment) => attachment.type === "image");
  const normalized = normalizeTerminalText(message.text, options);
  const characters = Array.from(normalized);
  const preview =
    message.role === "user" && characters.length > 400
      ? `${characters.slice(0, 400).join("")}…`
      : normalized;
  const text = [preview, images.map((_, index) => `[Image #${index + 1}]`).join(" ")]
    .filter(Boolean)
    .join("\n");
  return {
    id: encodedRowId("message", message.id),
    source: "message",
    sourceId: message.id,
    kind: message.role,
    createdAt: message.createdAt,
    turnId: message.turnId,
    text,
    streaming: message.streaming,
  };
}

function activityRow(activity: TuiActivity, options: TerminalTextOptions): TimelineActivityRow {
  const payload = asRecord(activity.payload);
  const kind = activityKind(activity, payload);
  const rawToolCallId = extractToolCallId(payload);
  const text = normalizeTerminalText(activity.summary, options);
  const detail = activityDetail(kind, text, payload, options);
  const tool = toolActivityDetails(payload);
  const status =
    extractWorkLogToolLifecycleStatus(payload) ??
    (activity.kind === "tool.completed"
      ? "completed"
      : activity.kind === "tool.started"
        ? "inProgress"
        : undefined);
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
    ...(tool.command ? { command: tool.command } : {}),
    ...(tool.name ? { toolName: tool.name } : {}),
    ...(tool.files.length ? { files: tool.files } : {}),
    ...(status === undefined ? {} : { status }),
  };
}

function activityOrder(left: TuiActivity, right: TuiActivity): number {
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
      ...(row.command === undefined ? {} : { command: row.command }),
      ...(row.toolName === undefined ? {} : { toolName: row.toolName }),
      ...(previous.files?.length || row.files?.length
        ? { files: [...new Set([...(previous.files ?? []), ...(row.files ?? [])])] }
        : {}),
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
  changes: 7,
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
  thread: RecordedThreadTimeline,
  options: TimelineProjectionOptions = {},
): ReadonlyArray<TimelineRow> {
  const messages = deduplicateMessages(thread.messages).map((message) =>
    messageRow(message, options),
  );
  const orderedActivities = deduplicateActivities(thread.activities).toSorted(activityOrder);
  const activities = collapseToolLifecycle(
    orderedActivities.map((activity) => activityRow(activity, options)),
  );
  const byTurn = new Map<string, TuiCheckpoint>();
  for (const checkpoint of thread.checkpoints ?? []) {
    const previous = byTurn.get(checkpoint.turnId);
    if (!previous || checkpoint.completedAt.localeCompare(previous.completedAt) >= 0)
      byTurn.set(checkpoint.turnId, checkpoint);
  }
  const changes: TimelineChangesRow[] = [...byTurn.values()]
    .filter((checkpoint) => checkpoint.files.length > 0 || checkpoint.status !== "ready")
    .map((checkpoint) => ({
      id: encodedRowId("changes", checkpoint.turnId),
      source: "checkpoint",
      kind: "changes",
      turnId: checkpoint.turnId,
      createdAt: checkpoint.completedAt,
      status: checkpoint.status,
      files: [
        ...new Map(
          checkpoint.files.map((file) => [
            file.path,
            { ...file, path: safeInlineText(file.path, options) },
          ]),
        ).values(),
      ],
      text: `Turn ${checkpoint.checkpointTurnCount} file changes`,
    }));
  return [...messages, ...activities, ...changes].toSorted(compareRows);
}
