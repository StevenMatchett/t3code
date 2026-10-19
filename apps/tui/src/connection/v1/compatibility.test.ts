import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { DEFAULT_SERVER_SETTINGS, ServerSettings } from "@t3tools/contracts";
import { normalizeV1Config } from "./commonRpc.ts";
import { OrchestrationThread, OrchestrationEvent } from "./contracts.ts";
import { applyThreadDetailEvent } from "./threadReducer.ts";
import { presentV1Thread } from "./presentation.ts";

const timestamp = "2026-01-01T00:00:00.000Z";
const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
const encodeSettings = Schema.encodeSync(ServerSettings);
const thread = (activities: unknown[]) =>
  decodeThread({
    id: "thread",
    projectId: "project",
    title: "V1 thread",
    modelSelection: { instanceId: "codex", model: "fixture" },
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    messages: [],
    checkpoints: [],
    session: null,
    activities,
  });
const activity = (id: string, kind: string, payload: unknown) => ({
  id,
  kind,
  tone: "info",
  summary: kind,
  payload,
  turnId: null,
  createdAt: timestamp,
});

describe("V1 compatibility boundary", () => {
  it("preserves child lineage through thread.created decoding and presentation", () => {
    const original = thread([]);
    const lineage = {
      parentThreadId: "parent",
      rootThreadId: "parent",
      relationshipToParent: "subagent",
    };
    const event = decodeEvent({
      sequence: 1,
      eventId: "created",
      type: "thread.created",
      occurredAt: timestamp,
      aggregateKind: "thread",
      aggregateId: original.id,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: { ...original, threadId: original.id, lineage },
    });
    const result = applyThreadDetailEvent(original, event);
    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") throw new Error("Expected updated thread");
    expect(presentV1Thread(result.thread).lineage).toEqual(lineage);
    expect(decodeThread({ ...original, lineage }).lineage).toEqual(lineage);
    expect(presentV1Thread(original).lineage).toBeUndefined();
  });

  it("accepts retired token streaming in config snapshots and settings events", () => {
    const settings = {
      ...encodeSettings(DEFAULT_SERVER_SETTINGS),
      responseStreamingMode: "token",
      projectSettingsOverrides: { project: { responseStreamingMode: "token" } },
    };
    for (const input of [
      { settings },
      { type: "snapshot", config: { settings } },
      { type: "settingsUpdated", payload: { settings } },
    ]) {
      expect(JSON.stringify(normalizeV1Config(input))).not.toContain('"token"');
    }
    expect(
      decodeSettings({
        ...settings,
        responseStreamingMode: "paragraph",
        projectSettingsOverrides: {},
      }).responseStreamingMode,
    ).toBe("paragraph");
    expect(normalizeV1Config({ settings: { responseStreamingMode: "future" } })).toEqual({
      settings: { responseStreamingMode: "future" },
    });
  });
  it("removes answered requests and exposes asynchronous rewind failures", () => {
    const opened = activity("opened", "approval.requested", {
      requestId: "request",
      requestKind: "command",
    });
    const pending = presentV1Thread(thread([opened]));
    expect(pending.requests.approvals[0]?.requestId).toBe("request");
    const settled = presentV1Thread(
      thread([
        opened,
        activity("closed", "approval.resolved", { requestId: "request" }),
        activity("failed", "checkpoint.revert.failed", { detail: "Provider refused rewind" }),
      ]),
    );
    expect(settled.requests.approvals).toEqual([]);
    expect(settled.rollbackFailure?.message).toBe("Provider refused rewind");
  });
});
