import { useMemo, useState } from "react";
import type { TuiThreadShell } from "../connection/models.ts";
import { actionKeyLabel } from "../app/actions.ts";
import type { ShellCommand } from "../app/state.ts";
import type { ActiveAction } from "../ui/keymap.ts";
import type { CommandPaletteItem } from "./CommandPalette.tsx";
import type { ShellThreadRows } from "./AppShell.tsx";

export type PaletteEntry = CommandPaletteItem & {
  readonly target:
    | { readonly type: "action"; readonly run: () => void }
    | { readonly type: "project"; readonly projectId: TuiThreadShell["projectId"] }
    | {
        readonly type: "thread";
        readonly projectId: TuiThreadShell["projectId"];
        readonly threadId: TuiThreadShell["id"];
      };
};

function searchExcerpt(snippet: string, query: string) {
  const text = snippet.replace(/\s+/gu, " ").trim();
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, 100);
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + query.length + 52);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** The palette's list: active commands, then projects, then threads with any message match. */
export function usePaletteEntries({
  actions,
  rows,
  unicode,
  searchQuery,
  searchMatches,
  dispatch,
  closePalette,
}: {
  readonly actions: readonly ActiveAction[];
  readonly rows: ShellThreadRows;
  readonly unicode: boolean;
  readonly searchQuery: string;
  readonly searchMatches: readonly {
    readonly threadId: TuiThreadShell["id"];
    readonly source: string;
    readonly snippet: string;
  }[];
  readonly dispatch: (command: ShellCommand) => void;
  readonly closePalette: () => void;
}) {
  const [recentChoices, setRecentChoices] = useState<readonly string[]>([]);
  const paletteEntries = useMemo<readonly PaletteEntry[]>(() => {
    const contentMatchByThreadId = new Map(
      searchMatches.map((match) => [match.threadId, match] as const),
    );
    return [
      ...actions
        .filter((action) => action.definition.palette !== false)
        .map((action): PaletteEntry => {
          const key = actionKeyLabel(action.definition, unicode);
          return {
            id: `action:${action.id}`,
            label: action.title,
            detail: "",
            keywords: `command ${action.definition.keywords ?? ""} ${action.id}`,
            kind: "command",
            ...(key ? { shortcut: key } : {}),
            rank:
              recentChoices.indexOf(`action:${action.id}`) >= 0
                ? 1_000 + recentChoices.indexOf(`action:${action.id}`)
                : Math.min(99, action.definition.hint ?? 0) *
                  (action.definition.hint === 100 ? 0 : 1),
            target: { type: "action", run: () => void action.run() },
          };
        }),
      ...rows.projects.map((project): PaletteEntry => ({
        id: `project:${project.id}`,
        label: project.title,
        detail: `Project · ${project.workspaceRoot}`,
        keywords: "workspace repository",
        kind: "entity",
        rank: recentChoices.includes(`project:${project.id}`)
          ? 1_000 + recentChoices.indexOf(`project:${project.id}`)
          : 0,
        target: { type: "project", projectId: project.id },
      })),
      ...rows.threads
        .filter((thread) => !thread.archivedAt)
        .map((thread): PaletteEntry => {
          const project = rows.projects.find((item) => item.id === thread.projectId);
          const contentMatch = contentMatchByThreadId.get(thread.id);
          const contentLabel = contentMatch
            ? `${contentMatch.source === "user" ? "You" : "Assistant"}: ${searchExcerpt(contentMatch.snippet, searchQuery)}`
            : null;
          return {
            id: `thread:${thread.id}`,
            label: thread.title,
            detail: contentLabel
              ? `${contentLabel} · ${project?.title ?? "Unknown project"}`
              : `Thread · ${project?.title ?? "Unknown project"}`,
            keywords: `${thread.modelSelection.model} conversation ${contentMatch?.snippet ?? ""}`,
            kind: "entity",
            rank: recentChoices.includes(`thread:${thread.id}`)
              ? 1_000 + recentChoices.indexOf(`thread:${thread.id}`)
              : 0,
            target: { type: "thread", projectId: thread.projectId, threadId: thread.id },
          };
        }),
    ];
  }, [unicode, actions, searchQuery, recentChoices, rows.projects, rows.threads, searchMatches]);
  const choosePaletteEntry = (id: string) => {
    const entry = paletteEntries.find((item) => item.id === id);
    if (!entry) return;
    closePalette();
    // Later entries rank higher, so the last choice is first the next time the palette opens.
    setRecentChoices((current) => [...current.filter((item) => item !== id), id].slice(-20));
    switch (entry.target.type) {
      case "action":
        entry.target.run();
        break;
      case "project":
        dispatch({ type: "open-project", projectId: entry.target.projectId });
        break;
      case "thread":
        dispatch({
          type: "open-thread",
          projectId: entry.target.projectId,
          threadId: entry.target.threadId,
        });
        break;
    }
  };
  return { paletteEntries, choosePaletteEntry };
}
