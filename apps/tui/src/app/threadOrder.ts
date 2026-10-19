import type { TuiThreadShell } from "../connection/models.ts";

// Metadata and session updates must not bump old conversations in the sidebar.
export function sortSidebarThreads(threads: readonly TuiThreadShell[]) {
  return threads
    .map((thread) => ({
      thread,
      timestamp: Date.parse(thread.latestUserMessageAt ?? thread.createdAt),
    }))
    .sort((a, b) => b.timestamp - a.timestamp || a.thread.id.localeCompare(b.thread.id))
    .map(({ thread }) => thread);
}
