import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import type { TuiContextUsage } from "../../connection/models.ts";

/** How full the active provider thread's context is, when the provider reports it. */
export function deriveContextUsage(
  projection: OrchestrationV2ThreadProjection,
): TuiContextUsage | null {
  const usage = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  )?.contextUsage;
  if (!usage) return null;
  const maxTokens = usage.maxTokens ?? null;
  return {
    usedTokens: usage.usedTokens,
    maxTokens,
    percent: maxTokens ? Math.min(100, Math.round((usage.usedTokens / maxTokens) * 100)) : null,
  };
}

function formatTokens(value: number) {
  if (value < 1_000) return `${value}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/u, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/u, "")}m`;
}

/** The short label beside the composer title. */
export function contextUsageLabel(usage: TuiContextUsage) {
  return usage.percent === null
    ? `Context ${formatTokens(usage.usedTokens)}`
    : `Context ${usage.percent}%`;
}
