import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import * as DateTime from "effect/DateTime";

export function agentFixture(id: string, title = "Researcher", model: string | null = null) {
  const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  return projectedSubagentsToRuntime([
    {
      id,
      title,
      prompt: title,
      model,
      status: "running",
      result: null,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
    },
  ])[0]!;
}
