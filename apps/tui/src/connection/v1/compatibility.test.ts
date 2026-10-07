import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { DEFAULT_SERVER_SETTINGS, ServerSettings } from "@t3tools/contracts";
import { normalizeV1Config } from "./commonRpc.ts";
import { OrchestrationThread } from "./contracts.ts";
import { presentV1Thread } from "./presentation.ts";

const timestamp = "2026-01-01T00:00:00.000Z";
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
