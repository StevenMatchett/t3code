/** @jsxImportSource react */
import type { ReactNode } from "react";
import {
  resolveThreadPullRequestBadge,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import type { TuiThreadShell } from "../connection/models.ts";
import { Button } from "../ui/Button.tsx";
import { FormInput } from "../ui/FormField.tsx";
import { resolveGlyph } from "../ui/glyphs.tsx";
import { ListView } from "../ui/ListView.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateMessage.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import type { ThemeToken } from "../ui/theme.ts";
import { useThemeColor, useUi } from "../ui/context.tsx";
import { TurnTiming } from "../ui/TurnTiming.tsx";
import {
  shelfRowHeight,
  shelfRowRecedes,
  type ShelfRow,
  type ShelfStatus,
  type ShelfThreadRow,
} from "./threadShelves.ts";

const STATUS_STYLES: {
  readonly [Status in ShelfStatus]: { readonly label: string; readonly tone: ThemeToken };
} = {
  approval: { label: "Approval", tone: "warning" },
  input: { label: "Input", tone: "accent" },
  working: { label: "Working", tone: "accent" },
  waiting: { label: "Waiting", tone: "muted" },
  limited: { label: "Limited", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  woke: { label: "Woke", tone: "warning" },
  done: { label: "Done", tone: "success" },
  none: { label: "", tone: "muted" },
};

const SHELF_TITLES = { working: "Working", snoozed: "Snoozed", settled: "Settled" } as const;

/** Keeps both ends of a branch, because the distinguishing part is often the tail. */
export function middleTruncate(text: string, width: number) {
  if (text.length <= width) return text;
  if (width < 5) return text.slice(0, Math.max(0, width));
  const tail = Math.floor((width - 1) / 2);
  return `${text.slice(0, width - 1 - tail)}…${text.slice(text.length - tail)}`;
}

function PullRequestBadge({ thread }: { readonly thread: TuiThreadShell }) {
  const { capabilities } = useUi();
  const badge = resolveThreadPullRequestBadge(thread.pullRequests);
  if (!badge) return null;
  const number = visibleThreadPullRequests(thread.pullRequests)[0]?.number;
  const tone: ThemeToken =
    badge.state === "merged"
      ? "accent"
      : badge.state === "closed"
        ? "danger"
        : badge.state === "draft"
          ? "muted"
          : "success";
  return (
    <Text height={1} flexShrink={0} tone={tone} wrapMode="none">
      {badge.kind === "stack"
        ? ` ${resolveGlyph("stack", capabilities.unicode)}${badge.layers}`
        : ` #${number ?? ""}${badge.others > 0 ? ` +${badge.others}` : ""}`}
    </Text>
  );
}

function RowStatus({ row }: { readonly row: ShelfThreadRow }) {
  const { thread, status } = row;
  if (status === "none")
    return (
      <Text height={1} flexShrink={0} tone="muted" wrapMode="none">
        {row.time ? ` ${row.time}` : ""}
      </Text>
    );
  const style = STATUS_STYLES[status];
  const label = status === "working" && thread.goal?.status === "active" ? "Goal" : style.label;
  return (
    <Stack flexDirection="row" flexShrink={0} height={1}>
      <Text height={1} flexShrink={0} tone={style.tone} wrapMode="none">
        {` ${label}`}
      </Text>
      {status === "working" ? (
        <TurnTiming
          turn={thread.latestTurn}
          runningSince={thread.session?.updatedAt ?? null}
          compact
        />
      ) : null}
    </Stack>
  );
}

function Pin({ thread }: { readonly thread: TuiThreadShell }) {
  const { capabilities } = useUi();
  return thread.pinnedAt != null ? (
    <Text height={1} flexShrink={0} tone="accent" wrapMode="none">
      {`${resolveGlyph("pin", capabilities.unicode)} `}
    </Text>
  ) : null;
}

function titleTone(row: ShelfThreadRow, selected: boolean): ThemeToken {
  if (selected) return "accent";
  return row.status === "failed" || !shelfRowRecedes(row) ? "text" : "muted";
}

interface RowProps {
  readonly row: ShelfThreadRow;
  readonly selected: boolean;
  /** Part of the multi-selection, which is separate from where the cursor sits. */
  readonly marked: boolean;
}

function RowTitle({ row, selected, marked }: RowProps) {
  const { capabilities } = useUi();
  return (
    <Stack height={1} flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>
      <Text
        height={1}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minWidth={0}
        wrapMode="none"
        truncate
        tone={titleTone(row, selected)}
        strong={selected || row.unread}
        dim={Boolean(row.thread.titleRegeneration)}
      >
        {/* The marker is what shows the selection on a terminal without color. */}
        {`${selected ? ">" : " "} ${marked ? `${resolveGlyph("connected", capabilities.unicode)} ` : ""}${inlineTerminalText(row.thread.title)}`}
      </Text>
    </Stack>
  );
}

/** Provider instances that have owned this thread, oldest first, as the GUI's icon stack reads. */
function providerStack(thread: TuiThreadShell) {
  const current = thread.modelSelection.instanceId;
  const previous = (thread.providerInstanceHistory ?? []).filter((id) => id !== current);
  return [...previous.slice(-2), current].join(" › ");
}

function Card({
  row,
  project,
  width,
  selected,
  marked,
}: RowProps & {
  readonly project: string;
  readonly width: number;
}) {
  const { capabilities } = useUi();
  const { thread } = row;
  const provider = providerStack(thread);
  return (
    <>
      <Stack height={1} flexDirection="row" width="100%" paddingLeft={2}>
        <Pin thread={thread} />
        <Text
          height={1}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          minWidth={0}
          tone="muted"
          wrapMode="none"
          truncate
        >
          {inlineTerminalText(project)}
        </Text>
        <RowStatus row={row} />
      </Stack>
      <RowTitle row={row} selected={selected} marked={marked} />
      <Stack height={1} flexDirection="row" width="100%" paddingLeft={2}>
        <Text
          height={1}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          minWidth={0}
          tone="muted"
          dim
          wrapMode="none"
          truncate
        >
          {`${thread.worktreePath ? `${resolveGlyph("worktree", capabilities.unicode)} ` : ""}${
            thread.branch
              ? middleTruncate(
                  inlineTerminalText(thread.branch),
                  Math.max(
                    8,
                    // Indent, the gap before the provider, and whatever else shares the line.
                    width -
                      provider.length -
                      3 -
                      (thread.worktreePath ? 2 : 0) -
                      (visibleThreadPullRequests(thread.pullRequests).length > 0 ? 8 : 0),
                  ),
                )
              : ""
          }`}
        </Text>
        <PullRequestBadge thread={thread} />
        <Text height={1} flexShrink={0} tone="muted" dim wrapMode="none">
          {` ${inlineTerminalText(provider)}`}
        </Text>
      </Stack>
    </>
  );
}

function Slim({ row, selected, marked }: RowProps) {
  return (
    <Stack height={1} flexDirection="row" width="100%">
      <RowTitle row={row} selected={selected} marked={marked} />
      <Pin thread={row.thread} />
      <PullRequestBadge thread={row.thread} />
      {row.status === "woke" ? (
        <RowStatus row={row} />
      ) : (
        <Text height={1} flexShrink={0} tone="muted" wrapMode="none">
          {row.time ? ` ${row.time}` : ""}
        </Text>
      )}
    </Stack>
  );
}

function SearchResult({
  row,
  project,
  selected,
  marked,
}: RowProps & {
  readonly project: string;
}) {
  return (
    <>
      <Slim row={row} selected={selected} marked={marked} />
      <Text height={1} tone="muted" dim wrapMode="none" truncate>
        {inlineTerminalText(row.excerpt ?? project)}
      </Text>
    </>
  );
}

export interface ShelfSidebarProps {
  readonly rows: readonly ShelfRow[];
  readonly cursor: number;
  readonly marked: ReadonlySet<TuiThreadShell["id"]>;
  readonly height: number;
  readonly width: number;
  readonly hasProjects: boolean;
  readonly loaded: boolean;
  readonly error: boolean;
  readonly filter: string | undefined;
  readonly filtering: boolean;
  /** The project the list is narrowed to, or null for all of them. */
  readonly scopeTitle: string | null;
  readonly focused: boolean;
  readonly projectTitle: (thread: TuiThreadShell) => string;
  readonly onFilterChange?: ((filter: string) => void) | undefined;
  readonly onSearch?: (() => void) | undefined;
  readonly onChooseScope?: (() => void) | undefined;
  readonly onNewThread?: (() => void) | undefined;
  readonly onActivate?:
    | ((row: ShelfRow, modifiers: { readonly shift: boolean; readonly ctrl: boolean }) => void)
    | undefined;
  readonly onThreadContextMenu?:
    | ((thread: TuiThreadShell, position: { x: number; y: number }) => void)
    | undefined;
}

/** The GUI sidebar in a terminal: search and scope on top, then one list across projects. */
export function ShelfSidebar(props: ShelfSidebarProps) {
  const { capabilities } = useUi();
  const selectionColor = useThemeColor("selection");
  const { rows, cursor, scopeTitle, filter, filtering } = props;
  const searching = filtering || filter !== undefined;
  // The way out stays on a project with no threads, and the reason for the empty list stays too.
  const onlyAllProjects = rows.length === 1 && rows[0]?.kind === "all-projects";
  const empty: ReactNode = props.error ? (
    <ErrorState title="Connection unavailable. R retries." />
  ) : !props.loaded ? (
    <LoadingState title="Loading your workspace..." />
  ) : searching && filter ? (
    <EmptyState title="Nothing matches the search." description="Esc clears it." />
  ) : !props.hasProjects ? (
    <EmptyState title="No projects yet." description="Press P to add one." />
  ) : scopeTitle ? (
    <EmptyState title={`No threads in ${scopeTitle} yet.`} description="Press N to start one." />
  ) : (
    <EmptyState title="No threads yet." description="Press N to start one." />
  );
  return (
    <Stack flexDirection="column" height="100%">
      <Stack height={1} flexShrink={0} flexDirection="row" gap={1}>
        {searching ? (
          <>
            <Text height={1} flexShrink={0} tone="accent">
              {"/"}
            </Text>
            <FormInput
              id="sidebar-filter"
              value={filter ?? ""}
              placeholder="Search threads..."
              focused={filtering}
              onInput={(value) => props.onFilterChange?.(value)}
            />
          </>
        ) : (
          <>
            <Button
              id="sidebar-search"
              label="[/]"
              tone="accent"
              {...(props.onSearch ? { onPress: props.onSearch } : {})}
            />
            {props.hasProjects ? (
              <Button
                id="sidebar-scope"
                label={`[${scopeTitle ? inlineTerminalText(scopeTitle) : "All projects"} ${resolveGlyph("expanded", capabilities.unicode)}]`}
                flexGrow={1}
                flexShrink={1}
                minWidth={0}
                tone={scopeTitle ? "accent" : "muted"}
                {...(props.onChooseScope ? { onPress: props.onChooseScope } : {})}
              />
            ) : (
              <Stack flexGrow={1} />
            )}
            {props.hasProjects ? (
              <Button
                id="sidebar-new-thread"
                label="[+]"
                tone="accent"
                {...(props.onNewThread ? { onPress: props.onNewThread } : {})}
              />
            ) : null}
          </>
        )}
      </Stack>
      <ListView<ShelfRow>
        items={rows}
        selected={cursor}
        height={onlyAllProjects ? 1 : Math.max(1, props.height - 1)}
        rowHeight={shelfRowHeight}
        pushDown={(row) => row.kind === "shelf"}
        itemKey={(row) => row.id}
        itemId={(row) => `navigation-${row.id}`}
        empty={empty}
        {...(props.onActivate
          ? { onActivate: (row, _index, modifiers) => props.onActivate?.(row, modifiers) }
          : {})}
        onContextMenu={(row, position) => {
          if (row.kind === "thread") props.onThreadContextMenu?.(row.thread, position);
        }}
        renderItem={(row, index) => {
          const selected = index === cursor;
          const background = selected && selectionColor ? { backgroundColor: selectionColor } : {};
          if (row.kind === "shelf") {
            const glyph = resolveGlyph(
              row.expanded ? "expanded" : "collapsed",
              capabilities.unicode,
            );
            return (
              <Stack height={1} width="100%" {...background}>
                <Text
                  height={1}
                  wrapMode="none"
                  truncate
                  tone={selected && props.focused ? "accent" : "muted"}
                  strong={selected && props.focused}
                >
                  {`${selected ? ">" : " "} ${glyph} ${SHELF_TITLES[row.shelf]}${row.expanded ? "" : ` (${row.count})`}`}
                </Text>
              </Stack>
            );
          }
          if (row.kind === "all-projects")
            return (
              <Stack height={1} width="100%" {...background}>
                <Text
                  height={1}
                  wrapMode="none"
                  truncate
                  tone={selected && props.focused ? "accent" : "muted"}
                  strong={selected && props.focused}
                >
                  {`${selected ? ">" : " "} ${capabilities.unicode ? "←" : "<"} All projects`}
                </Text>
              </Stack>
            );
          if (row.kind === "more")
            return (
              <Stack height={1} width="100%" {...background}>
                <Text height={1} wrapMode="none" truncate tone={selected ? "accent" : "muted"}>
                  {`${selected ? ">" : " "}   Show ${row.count} more`}
                </Text>
              </Stack>
            );
          const project = props.projectTitle(row.thread);
          const marked = props.marked.has(row.id);
          return (
            <>
              <Stack flexDirection="column" width="100%" flexShrink={0} {...background}>
                {row.variant === "card" ? (
                  <Card
                    row={row}
                    project={project}
                    width={props.width}
                    selected={selected}
                    marked={marked}
                  />
                ) : row.variant === "search" ? (
                  <SearchResult row={row} project={project} selected={selected} marked={marked} />
                ) : (
                  <Slim row={row} selected={selected} marked={marked} />
                )}
              </Stack>
              {/* Cards are several lines each, so without this they read as one block of text. */}
              {row.variant === "card" ? (
                <Text height={1} flexShrink={0} tone="border" wrapMode="none">
                  {(capabilities.unicode ? "─" : "-").repeat(Math.max(0, props.width))}
                </Text>
              ) : null}
            </>
          );
        }}
      />
      {onlyAllProjects ? empty : null}
    </Stack>
  );
}
