import type { AtomRegistry } from "effect/reactivity";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import type { ShellOverlayView } from "../app/AppShell.tsx";
import type { ShellCommand, ShellOverlay, ShellState } from "../app/state.ts";
import type { TuiClient } from "../connection/clientRuntime.ts";
import type { FavoriteModel } from "../features/chat/providerChoices.ts";
import type { calculateShellLayout } from "../ui/layout.ts";
import { CheckpointRestore } from "./CheckpointRestore.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { FavoriteModelsPanel } from "./FavoriteModelsPanel.tsx";
import { HelpPanel } from "./HelpPanel.tsx";
import { NewProjectForm } from "./NewProjectForm.tsx";
import { NewThreadForm } from "./NewThreadForm.tsx";
import { GitBranchPicker } from "./GitBranchPicker.tsx";
import { GitPanel } from "./GitPanel.tsx";
import { ProposedPlanPanel } from "./ProposedPlanPanel.tsx";
import { PullRequestPanel } from "./PullRequestPanel.tsx";
import { RenameThreadDialog } from "./RenameThreadDialog.tsx";
import { SnoozeCustomDialog } from "./SnoozeCustomDialog.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import { ThreadActionsForm } from "./ThreadManagement.tsx";
import { ThreadDiff } from "./ThreadDiff.tsx";
import {
  NavigationContextMenu,
  ProjectContextMenu,
  ThreadContextMenu,
} from "./ThreadContextMenu.tsx";
import type { ShellThreadRows } from "./AppShell.tsx";
import type { useThreadTriage } from "./useThreadTriage.ts";
import type { PaletteEntry } from "./usePaletteEntries.ts";

export interface ShellOverlayContext {
  readonly client: TuiClient;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly state: ShellState;
  readonly dispatch: (command: ShellCommand) => void;
  readonly rows: ShellThreadRows;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly layout: ReturnType<typeof calculateShellLayout>;
  readonly shelvesLayout: boolean;
  readonly triage: ReturnType<typeof useThreadTriage>;
  readonly palette: {
    readonly entries: readonly PaletteEntry[];
    readonly searching: boolean;
    readonly searchFailed: boolean;
    readonly searchedQuery: string;
    readonly searchDebounceMs: number;
    readonly onSearchQueryChange: (query: string) => void;
    readonly onChoose: (id: string) => void;
    readonly onClose: () => void;
  };
  readonly favoriteModels: readonly FavoriteModel[];
  readonly updateFavorites: (
    update: (favorites: readonly FavoriteModel[]) => readonly FavoriteModel[],
  ) => void;
  readonly pushOverlay: (overlay: ShellOverlay) => void;
  readonly popOverlay: () => void;
  readonly focusComposer: () => void;
}

/** The view for one entry on the overlay stack, or null when what it points at is gone. */
export function renderShellOverlay(
  overlay: ShellOverlay,
  isTop: boolean,
  {
    client,
    registry,
    state,
    dispatch,
    rows,
    active,
    width,
    height,
    layout,
    shelvesLayout,
    triage,
    palette,
    favoriteModels,
    updateFavorites,
    pushOverlay,
    popOverlay,
    focusComposer,
  }: ShellOverlayContext,
): ShellOverlayView | null {
  const {
    markedThreads,
    snoozeThreads,
    bulkMenuActions,
    chooseBulkMenuAction,
    deleteMarked,
    shelfMenuActions,
    chooseShelfMenuAction,
    chooseThreadAction,
  } = triage;
  const overlayActive = active && isTop;
  const contentRows = (preferred: number) =>
    Math.max(1, Math.min(preferred, layout.bodyHeight) - 2);
  switch (overlay.type) {
    case "help":
      return {
        title: "Keyboard help",
        size: { width: 88, height: 40 },
        content: <HelpPanel active={overlayActive} height={contentRows(40)} onClose={popOverlay} />,
      };
    case "palette":
      return {
        title: "Search and commands",
        size: { width: 100, height: 28 },
        content: (
          <CommandPalette
            items={palette.entries}
            height={contentRows(28)}
            active={overlayActive}
            searching={palette.searching}
            searchFailed={palette.searchFailed}
            searchedQuery={palette.searchedQuery}
            searchDebounceMs={palette.searchDebounceMs}
            onSearchQueryChange={palette.onSearchQueryChange}
            onChoose={palette.onChoose}
            onClose={palette.onClose}
          />
        ),
      };
    case "favorite-models":
      return {
        title: "Favorite models",
        content: (
          <FavoriteModelsPanel
            client={client}
            favorites={favoriteModels}
            width={Math.max(1, width - 6)}
            height={layout.contentHeight}
            active={overlayActive}
            onChange={updateFavorites}
            onClose={popOverlay}
          />
        ),
      };
    case "theme":
      return {
        title: "Theme",
        size: { width: 62, height: 7 },
        content: <ThemePicker active={overlayActive} onClose={popOverlay} />,
      };
    case "diff":
      return state.threadId
        ? {
            title: "Thread changes",
            content: (
              <ThreadDiff
                client={client}
                threadId={state.threadId}
                active={overlayActive}
                width={Math.max(1, width - 6)}
                height={layout.contentHeight}
                onClose={popOverlay}
              />
            ),
          }
        : null;
    case "restore":
      return state.threadId
        ? {
            title: "Checkpoint restore",
            size: { width: 100, height: 28 },
            content: (
              <CheckpointRestore
                key={state.threadId}
                client={client}
                threadId={state.threadId}
                active={overlayActive}
                height={contentRows(28)}
                onClose={(restored) => {
                  popOverlay();
                  if (restored) focusComposer();
                }}
              />
            ),
          }
        : null;
    case "pull-request":
      return {
        title: "Pull request",
        size: { width: 80, height: 10 },
        content: (
          <PullRequestPanel
            client={client}
            cwd={overlay.cwd}
            branch={overlay.branch}
            active={overlayActive}
            onClose={popOverlay}
          />
        ),
      };
    case "git": {
      const thread = rows.threads.find((item) => item.id === overlay.threadId);
      return {
        title: "Git",
        size: { width: 84, height: 18 },
        content: (
          <GitPanel
            client={client}
            cwd={overlay.cwd}
            threadId={overlay.threadId}
            projectId={overlay.projectId}
            active={overlayActive}
            width={Math.max(1, Math.min(84, width - 6) - 2)}
            height={contentRows(18)}
            onClose={popOverlay}
            onViewPullRequest={() => {
              popOverlay();
              pushOverlay({
                type: "pull-request",
                cwd: overlay.cwd,
                branch: thread?.branch ?? null,
              });
            }}
            onBranches={() =>
              pushOverlay({
                type: "git-branches",
                cwd: overlay.cwd,
                threadId: overlay.threadId,
              })
            }
          />
        ),
      };
    }
    case "git-branches":
      return {
        title: "Switch branch",
        size: { width: 84, height: 24 },
        content: (
          <GitBranchPicker
            client={client}
            cwd={overlay.cwd}
            threadId={overlay.threadId}
            active={overlayActive}
            height={contentRows(24)}
            onClose={popOverlay}
          />
        ),
      };
    case "plan": {
      const thread = rows.threads.find((item) => item.id === overlay.threadId);
      return {
        title: "Proposed plan",
        size: { width: 110, height: 40 },
        content: (
          <ProposedPlanPanel
            client={client}
            threadId={overlay.threadId}
            cwd={
              thread?.worktreePath ??
              rows.projects.find((project) => project.id === thread?.projectId)?.workspaceRoot ??
              null
            }
            active={overlayActive}
            width={Math.max(1, Math.min(110, width - 6) - 2)}
            height={contentRows(40)}
            onClose={popOverlay}
            onRefine={() => {
              popOverlay();
              void client.actions.setInteractionMode(registry, overlay.threadId, "plan");
              focusComposer();
            }}
            onOpenThread={(threadId) => {
              const next = rows.threads.find((item) => item.id === threadId);
              dispatch({
                type: "open-thread",
                projectId: next?.projectId ?? thread?.projectId ?? state.projectId!,
                threadId,
              });
            }}
          />
        ),
      };
    }
    case "new-project":
      return {
        title: "New project",
        size: { width: 96, height: 24 },
        content: (
          <NewProjectForm
            client={client}
            height={contentRows(24)}
            onClose={popOverlay}
            onCreated={(projectId) => dispatch({ type: "open-project", projectId })}
          />
        ),
      };
    case "new-thread":
      return {
        title: "New thread",
        size: { width: 96, height: 20 },
        content: (
          <NewThreadForm
            client={client}
            projectId={state.projectId}
            favoriteModels={favoriteModels}
            height={contentRows(20)}
            onClose={popOverlay}
            onCreated={(projectId, threadId) =>
              dispatch({ type: "open-thread", projectId, threadId })
            }
          />
        ),
      };
    case "manage": {
      const thread = rows.threads.find((item) => item.id === overlay.threadId);
      return thread
        ? {
            title: thread.archivedAt ? "Manage archived thread" : "Manage thread",
            size: { width: 72, height: 12 },
            content: (
              <ThreadActionsForm
                client={client}
                initialAction={overlay.initialAction ?? "rename"}
                thread={thread}
                active={overlayActive}
                onClose={popOverlay}
                onRemoved={() => {
                  popOverlay();
                  if (state.route === "conversation" && state.threadId === thread.id)
                    dispatch({ type: "back" });
                }}
              />
            ),
          }
        : null;
    }
    case "rename": {
      const thread = rows.threads.find((item) => item.id === overlay.threadId);
      return thread
        ? {
            floating: true,
            content: (
              <RenameThreadDialog
                key={thread.id}
                client={client}
                thread={thread}
                onClose={popOverlay}
              />
            ),
          }
        : null;
    }
    case "project-scope":
      return {
        title: "Filter by project",
        size: { width: 72, height: 18 },
        content: (
          <CommandPalette
            items={[
              {
                id: "all",
                label: "All projects",
                detail: state.projectScope ? "" : "Current",
                rank: 2_000,
              },
              ...rows.projects.map((project) => ({
                id: project.id,
                label: project.title,
                detail: `${project.id === state.projectScope ? "Current · " : ""}${project.workspaceRoot}`,
                rank: project.id === state.projectScope ? 1_000 : 0,
              })),
            ]}
            height={contentRows(18)}
            active={overlayActive}
            searching={false}
            searchFailed={false}
            searchedQuery=""
            searchDebounceMs={0}
            onSearchQueryChange={() => undefined}
            onChoose={(id) => {
              popOverlay();
              dispatch({
                type: "set-project-scope",
                projectId: rows.projects.find((project) => project.id === id)?.id ?? null,
              });
            }}
            onClose={popOverlay}
          />
        ),
      };
    case "snooze-menu": {
      const threads = rows.threads.filter((item) => overlay.threadIds.includes(item.id));
      const presets = resolveSnoozePresets(new Date());
      return threads.length > 0
        ? {
            floating: true,
            content: (
              <NavigationContextMenu
                id="snooze"
                x={overlay.x}
                y={overlay.y}
                width={width}
                height={height}
                actions={[
                  ...presets.map((preset) => ({
                    action: preset.id as string,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                  { action: "custom", label: "Custom..." },
                ]}
                onChoose={(id) => {
                  popOverlay();
                  if (id === "custom") {
                    pushOverlay({ type: "snooze-custom", threadIds: overlay.threadIds });
                    return;
                  }
                  const preset = presets.find((candidate) => candidate.id === id);
                  if (preset) snoozeThreads(threads, preset.snoozedUntil);
                }}
                onClose={popOverlay}
              />
            ),
          }
        : null;
    }
    case "snooze-custom": {
      const threads = rows.threads.filter((item) => overlay.threadIds.includes(item.id));
      return threads.length > 0
        ? {
            floating: true,
            content: (
              <SnoozeCustomDialog
                count={threads.length}
                onSnooze={(until) => {
                  popOverlay();
                  snoozeThreads(threads, until);
                }}
                onClose={popOverlay}
              />
            ),
          }
        : null;
    }
    case "bulk-menu":
      return markedThreads.length > 0
        ? {
            floating: true,
            content: (
              <NavigationContextMenu
                id="bulk-thread"
                x={overlay.x}
                y={overlay.y}
                width={width}
                height={height}
                actions={bulkMenuActions()}
                onChoose={(action) => chooseBulkMenuAction(action, overlay.x, overlay.y)}
                onClose={popOverlay}
              />
            ),
          }
        : null;
    case "bulk-delete":
      return {
        floating: true,
        content: (
          <NavigationContextMenu
            id="bulk-delete"
            x={overlay.x}
            y={overlay.y}
            width={width}
            height={height}
            // Cancel comes first, so Enter on a menu that just opened can never delete.
            actions={[
              { action: "cancel", label: "Cancel" },
              {
                action: "delete",
                label: `Delete ${markedThreads.length} ${markedThreads.length === 1 ? "thread" : "threads"}`,
              },
            ]}
            onChoose={(action) => {
              popOverlay();
              if (action === "delete") void deleteMarked();
            }}
            onClose={popOverlay}
          />
        ),
      };
    case "thread-menu": {
      const thread = rows.threads.find((item) => item.id === overlay.threadId);
      if (thread && shelvesLayout)
        return {
          floating: true,
          content: (
            <NavigationContextMenu
              key={thread.id}
              id="thread-context"
              x={overlay.x}
              y={overlay.y}
              width={width}
              height={height}
              actions={shelfMenuActions(thread)}
              onChoose={(action) => chooseShelfMenuAction(thread, action, overlay.x, overlay.y)}
              onClose={popOverlay}
            />
          ),
        };
      return thread
        ? {
            floating: true,
            content: (
              <ThreadContextMenu
                key={thread.id}
                x={overlay.x}
                y={overlay.y}
                width={width}
                height={height}
                archived={thread.archivedAt !== null}
                onChoose={(action) => void chooseThreadAction(thread.id, action)}
                onClose={popOverlay}
              />
            ),
          }
        : null;
    }
    case "project-menu":
      return {
        floating: true,
        content: (
          <ProjectContextMenu
            key={overlay.projectId}
            x={overlay.x}
            y={overlay.y}
            width={width}
            height={height}
            onChoose={() => {
              popOverlay();
              dispatch({ type: "new-thread", projectId: overlay.projectId });
            }}
            onClose={popOverlay}
          />
        ),
      };
  }
}
