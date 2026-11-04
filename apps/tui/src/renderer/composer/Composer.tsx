import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { ThreadId } from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";
import * as Option from "effect/Option";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TuiClient } from "../../connection/clientRuntime.ts";
import { skillCompletionAt } from "../../features/chat/skillCompletion.ts";
import {
  buildComposerPromptHistoryEntries,
  stepComposerPromptHistory,
  type ComposerPromptHistoryPosition,
} from "../../features/chat/promptHistory.ts";
import { trailingPastedImagePaths } from "../../features/chat/imageAttachments.ts";
import { useKeyLayer } from "../../ui/keymap.ts";
import { Panel } from "../../ui/Panel.tsx";
import { Button } from "../../ui/Button.tsx";
import { Stack, Text } from "../../ui/primitives.tsx";
import { inlineTerminalText } from "../../ui/textLayout.ts";
import { useThemeColor } from "../../ui/context.tsx";
import { PromptEditor, type PromptEditorControl, type PromptSnapshot } from "../PromptEditor.tsx";
import { ComposerMenu } from "./ComposerMenu.tsx";
import { useComposerChoices } from "./useComposerChoices.ts";

export function Composer({
  client,
  threadId,
  active,
  focused,
  editorHeight,
  showPastes = false,
  pastePreviewHeight = 0,
  onTogglePastes,
  suggestedReplies,
  availableHeight,
  width,
  onActivate,
  onDraftChange,
  onBlur,
  onSubmit,
  onFocusNext,
  onCancel,
  cancelPending = false,
  sendLabel,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly focused: boolean;
  readonly editorHeight: number;
  readonly showPastes?: boolean;
  readonly pastePreviewHeight?: number;
  readonly onTogglePastes?: () => void;
  readonly suggestedReplies: readonly string[];
  readonly availableHeight: number;
  readonly width: number;
  readonly onActivate: () => void;
  readonly onDraftChange?: () => void;
  readonly onBlur: () => void;
  readonly onSubmit: () => void;
  readonly onFocusNext?: () => void;
  readonly onCancel?: () => void;
  readonly cancelPending?: boolean;
  readonly sendLabel: string;
}) {
  const registry = useContext(RegistryContext);
  const catalog = useAtomValue(client.providers);
  const threadState = useAtomValue(client.thread(threadId));
  const shell = useAtomValue(client.shell);
  const interaction = useAtomValue(client.actions.state(threadId));
  const pastedText = useMemo(
    () => (showPastes ? interaction.pastes.map((paste) => paste.text).join("\n\n") : ""),
    [showPastes, interaction.pastes],
  );
  const thread = Option.getOrNull(threadState.data);
  const provider = catalog.providers.find(
    (item) => item.instanceId === thread?.modelSelection.instanceId,
  );
  const cwd =
    thread?.worktreePath ??
    Option.getOrNull(shell.snapshot)?.projects.find((item) => item.id === thread?.projectId)
      ?.workspaceRoot ??
    null;
  const model = provider?.models.find((item) => item.slug === thread?.modelSelection.model);
  const descriptors = getProviderOptionDescriptors({
    caps: model?.capabilities ?? {},
    selections: thread?.modelSelection.options,
  });
  const dividerColor = useThemeColor("border");
  const selectedBackground = useThemeColor("selection");
  const [savedComposer] = useState(() => client.session?.composer(threadId));
  const editor = useRef<PromptEditorControl | null>(null);
  const pastePreview = useRef<ScrollBoxRenderable | null>(null);
  const historyPosition = useRef<ComposerPromptHistoryPosition | null>(null);
  const recalling = useRef(false);
  const mounted = useRef(true);
  const refreshGeneration = useRef(0);
  const menuGeneration = useRef(0);
  const previousTrigger = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<PromptSnapshot>({
    text: interaction.draft,
    cursor: interaction.draft.length,
  });
  const [focus, setFocus] = useState(0);
  const [dropdown, setDropdown] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const completion =
    snapshot.text === interaction.draft ? skillCompletionAt(snapshot.text, snapshot.cursor) : null;
  const completionKey = completion
    ? JSON.stringify([completion.start, completion.end, completion.query])
    : null;
  const slashOpen = focused && focus === 0 && completion !== null && completionKey !== dismissed;
  const menu = active && focused ? (dropdown ?? (slashOpen ? "skills" : null)) : null;
  const refresh = (models: boolean) => {
    const generation = ++refreshGeneration.current;
    setRefreshing(true);
    setRefreshError(null);
    void client
      .refreshProvider(registry, threadId, models)
      .then((ok) => {
        if (mounted.current && generation === refreshGeneration.current) {
          setRefreshing(false);
          setRefreshError(ok ? null : "Refresh unavailable; using the reported catalog.");
        }
      })
      .catch(() => {
        if (mounted.current && generation === refreshGeneration.current) {
          setRefreshing(false);
          setRefreshError("Catalog refresh failed.");
        }
      });
  };
  const updateSnapshot = (next: PromptSnapshot) => {
    client.session?.saveComposer(threadId, { cursor: next.cursor });
    const trigger = skillCompletionAt(next.text, next.cursor);
    if (trigger && previousTrigger.current !== trigger.start) refresh(false);
    previousTrigger.current = trigger?.start ?? null;
    setSnapshot((old) => (old.text === next.text && old.cursor === next.cursor ? old : next));
    if (next.text !== snapshot.text || next.cursor !== snapshot.cursor) setCursor(0);
  };
  const updateDraft = (value: string) => {
    const isRecall = recalling.current || historyPosition.current?.recalled === value;
    if (!isRecall) historyPosition.current = null;
    if (value !== registry.get(client.actions.state(threadId)).draft) onDraftChange?.();
    client.actions.setDraft(registry, threadId, value);
    if (isRecall) return;
    const dropped = trailingPastedImagePaths(value);
    if (!dropped || interaction.attachmentPending) return;
    void client.actions.attachImages(registry, threadId, dropped.paths).then((attached) => {
      if (!attached) return;
      const current = registry.get(client.actions.state(threadId));
      const droppedText = value.slice(dropped.start);
      if (!current.draft.slice(dropped.start).startsWith(droppedText)) return;
      client.actions.setDraft(
        registry,
        threadId,
        `${current.draft.slice(0, dropped.start)}${current.draft.slice(dropped.start + droppedText.length)}`,
      );
    });
  };
  const open = (id: string, index: number) => {
    menuGeneration.current += 1;
    onActivate();
    setFocus(index);
    setDismissed(completionKey);
    setQuery("");
    setCursor(0);
    setDropdown((current) => (current === id ? null : id));
    if (id === "models") refresh(true);
  };
  const close = () => {
    menuGeneration.current += 1;
    setDropdown(null);
    setDismissed(completionKey);
    setFocus(0);
  };
  const editPastes = () => {
    onActivate();
    close();
    onDraftChange?.();
    const draft = client.actions.editPastes(registry, threadId);
    editor.current?.replace(draft, draft.length);
  };
  const chooseSuggestedReply = (index: number) => {
    const reply = suggestedReplies[index];
    if (!reply || interaction.pending || interaction.attachmentPending) return;
    client.actions.setDraft(registry, threadId, reply);
    onSubmit();
  };
  const menuHandlers = useComposerChoices({
    client,
    threadId,
    thread,
    provider,
    model,
    descriptors,
    interaction,
    catalogStatus: catalog.status,
    menu,
    query,
    cursor,
    cwd,
    completion,
    refreshing,
    editor,
    menuGeneration,
    mounted,
    close,
  });
  const { buttons, rows, index, choose } = menuHandlers;
  // Whole cells keep every control the same size; flex rounding would make them differ by one.
  const controlWidth = Math.max(
    1,
    Math.floor(Math.max(1, width - 4) / (buttons.length + (onCancel ? 1 : 0))),
  );
  const cancelIndex = suggestedReplies.length + buttons.length + 1;
  const focusCount = cancelIndex + (onCancel ? 1 : 0);
  const recallPrompt = (direction: "backward" | "forward") => {
    if (interaction.pending || interaction.attachments.length || interaction.attachmentPending)
      return false;
    const control = editor.current;
    if (!control?.isAtHistoryBoundary(direction)) return false;
    const step = stepComposerPromptHistory({
      direction,
      entries: buildComposerPromptHistoryEntries(thread?.messages ?? []),
      position: historyPosition.current,
      currentPrompt: control.snapshot().text,
    });
    if (!step) return false;
    recalling.current = true;
    try {
      control.replace(step.prompt, step.prompt.length);
      historyPosition.current = step.position;
      // A recalled slash command is a draft, not a request to open the skills menu.
      const trigger = skillCompletionAt(step.prompt, step.prompt.length);
      setDismissed(trigger ? JSON.stringify([trigger.start, trigger.end, trigger.query]) : null);
    } finally {
      recalling.current = false;
    }
    return true;
  };
  const composerHasFocus = active && focused;
  useKeyLayer("menu", {
    active: composerHasFocus && menu !== null,
    typing: true,
    bindings: {
      "menu.close": close,
      "menu.up": () => setCursor((value) => Math.max(0, value - 1)),
      "menu.down": () => setCursor((value) => Math.min(Math.max(0, rows.length - 1), value + 1)),
      "menu.choose": () => choose(index),
    },
  });
  const onSuggestedReplies =
    suggestedReplies.length > 0 &&
    ((focus === 0 && interaction.draft.length === 0) ||
      (focus > 0 && focus <= suggestedReplies.length));
  useKeyLayer("composer", {
    active: composerHasFocus,
    typing: focus === 0,
    bindings: {
      "composer.recallPrompt": {
        enabled: menu === null && focus === 0,
        run: (key) => recallPrompt(key?.name === "up" ? "backward" : "forward") || false,
      },
      "composer.chooseReply": {
        enabled: menu === null && onSuggestedReplies,
        run: (key) => {
          const offset = key?.name === "up" || key?.name === "left" ? -1 : 1;
          setFocus((current) => {
            if (current < 1 || current > suggestedReplies.length)
              return offset < 0 ? suggestedReplies.length : 1;
            return ((current - 1 + offset + suggestedReplies.length) % suggestedReplies.length) + 1;
          });
        },
      },
      "composer.send": {
        enabled: menu === null && focus === 0 && !suggestedReplies.length,
        label: sendLabel,
        run: () => false,
      },
      "composer.newline": { enabled: menu === null && focus === 0, run: () => false },
      "composer.skills": {
        enabled: menu === null && focus === 0 && !suggestedReplies.length,
        run: () => false,
      },
      "composer.activateControl": {
        enabled: menu === null && focus > 0,
        run: () => {
          if (focus <= suggestedReplies.length) chooseSuggestedReply(focus - 1);
          else if (onCancel && focus === cancelIndex) {
            if (!cancelPending) onCancel();
          } else {
            const button = buttons[focus - suggestedReplies.length - 1];
            if (button) open(button.id, focus);
          }
        },
      },
      "composer.nextControl": {
        enabled: menu === null,
        label: onFocusNext ? "Options/agents" : "Options",
        run: () => {
          if (onFocusNext && focus === focusCount - 1) onFocusNext();
          else setFocus((value) => (value + 1) % focusCount);
        },
      },
      "composer.previousControl": {
        enabled: menu === null,
        run: () => setFocus((value) => (value + focusCount - 1) % focusCount),
      },
      "composer.blur": {
        enabled: menu === null,
        run: () => {
          if (focus > 0) setFocus(0);
          else onBlur();
        },
      },
      "composer.editPastes": {
        enabled: menu === null && interaction.pastes.length > 0,
        run: editPastes,
      },
      "composer.scrollPastes": {
        enabled: showPastes && menu === null,
        run: (key) => {
          pastePreview.current?.scrollBy(key?.name === "pageup" ? -1 : 1, "viewport");
        },
      },
      "composer.removeAttachment": {
        enabled: interaction.attachments.length > 0,
        run: () => {
          client.actions.removeAttachment(registry, threadId, interaction.attachments.at(-1)!.id!);
        },
      },
    },
  });
  const attachmentHeight = interaction.attachments.length > 0 ? 1 : 0;
  const suggestedReplyHeight = suggestedReplies.length > 0 ? 1 : 0;
  const height = editorHeight + attachmentHeight + suggestedReplyHeight + pastePreviewHeight + 4;
  const menuHeight = Math.max(4, Math.min(10, availableHeight - height));
  const count = Math.max(1, menuHeight - (menu === "skills" ? 3 : 4));
  return (
    <Stack
      id="conversation-composer"
      height={height}
      flexShrink={0}
      width="100%"
      overflow="visible"
    >
      <Panel
        title={
          focused
            ? "Message"
            : interaction.draft
              ? "Draft / Enter to edit"
              : "Message / Enter to write"
        }
        width="100%"
        height={height}
        borderTone={focused ? "borderFocused" : "border"}
        flexDirection="column"
      >
        {interaction.pastes.length && onTogglePastes ? (
          <Stack height={pastePreviewHeight} flexShrink={0} flexDirection="column">
            <Stack height={1} flexDirection="row" gap={1}>
              <Text
                id="paste-visibility-toggle"
                tone="accent"
                height={1}
                onMouseDown={(event) => {
                  if (!active || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePastes();
                }}
              >
                {`[Ctrl+P ${showPastes ? "Hide" : "Show"} pasted text]`}
              </Text>
              <Text
                id="paste-edit"
                tone="accent"
                onMouseDown={(event) => {
                  if (!active || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  editPastes();
                }}
              >
                [Ctrl+O Edit pasted text]
              </Text>
              {showPastes ? <Text tone="muted">PgUp/PgDn Scroll</Text> : null}
            </Stack>
            {showPastes ? (
              <scrollbox
                ref={pastePreview}
                id="pasted-text-preview"
                height={pastePreviewHeight - 1}
                width="100%"
                scrollX={false}
              >
                <Text selectable wrapMode="word" flexShrink={0}>
                  {pastedText}
                </Text>
              </scrollbox>
            ) : null}
          </Stack>
        ) : null}
        <PromptEditor
          control={editor}
          initialCursor={savedComposer?.cursor ?? interaction.draft.length}
          value={interaction.draft}
          onChange={updateDraft}
          onSnapshot={updateSnapshot}
          onActivate={() => {
            onActivate();
            close();
          }}
          onSubmit={() => {
            const live = editor.current?.snapshot();
            const trigger = live ? skillCompletionAt(live.text, live.cursor) : null;
            if (
              dropdown ||
              (trigger && JSON.stringify([trigger.start, trigger.end, trigger.query]) !== dismissed)
            ) {
              if (live) updateSnapshot(live);
              return;
            }
            onSubmit();
          }}
          focused={active && focused && focus === 0 && dropdown === null}
          height={editorHeight}
          placeholder="Message the agent, or / for skills..."
        />
        {suggestedReplies.length > 0 ? (
          <Stack height={1} flexShrink={0} flexDirection="row" width="100%" overflow="hidden">
            {suggestedReplies.map((reply, replyIndex) => (
              <Stack
                key={reply}
                id={`suggested-reply-${replyIndex}`}
                height={1}
                flexGrow={1}
                flexBasis={0}
                minWidth={0}
                {...(focused && focus === replyIndex + 1 && selectedBackground
                  ? { backgroundColor: selectedBackground }
                  : {})}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  chooseSuggestedReply(replyIndex);
                }}
              >
                <Text
                  height={1}
                  tone={focused && focus === replyIndex + 1 ? "accent" : "muted"}
                  wrapMode="none"
                  truncate
                >
                  {`[ ${inlineTerminalText(reply)} ]`}
                </Text>
              </Stack>
            ))}
          </Stack>
        ) : null}
        {interaction.attachments.length > 0 ? (
          <Stack height={1} flexShrink={0} flexDirection="row" width="100%" overflow="hidden">
            {interaction.attachments.map((attachment, attachmentIndex) => (
              <Text
                key={attachment.id ?? `${attachment.name}:${attachmentIndex}`}
                height={1}
                flexShrink={0}
                tone="accent"
                wrapMode="none"
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  client.actions.removeAttachment(registry, threadId, attachment.id!);
                }}
              >
                {`${attachmentIndex ? " " : ""}[${attachment.type === "image" ? "Image" : "File"} #${attachmentIndex + 1}]`}
              </Text>
            ))}
            <Text height={1} flexGrow={1} tone="muted" wrapMode="none" truncate>
              {interaction.attachmentPending
                ? "  Loading..."
                : "  Click or Ctrl+Backspace to remove"}
            </Text>
          </Stack>
        ) : null}
        <Stack
          id="composer-divider"
          height={1}
          width="100%"
          flexShrink={0}
          border={["top"]}
          borderStyle="single"
          {...(dividerColor ? { borderColor: dividerColor } : {})}
        />
        <Stack height={1} flexShrink={0} flexDirection="row" width="100%">
          {buttons.map((button, buttonIndex) => (
            <Button
              key={button.id}
              id={`composer-${button.id}`}
              label={inlineTerminalText(button.label)}
              width={controlWidth}
              focused={focused && focus === suggestedReplies.length + buttonIndex + 1}
              selected={dropdown === button.id}
              onPress={() => open(button.id, suggestedReplies.length + buttonIndex + 1)}
            />
          ))}
          {onCancel ? (
            <Button
              id="conversation-cancel-turn"
              label="Cancel"
              tone="danger"
              width={controlWidth}
              focused={focused && focus === cancelIndex}
              disabled={cancelPending}
              onPress={() => {
                onActivate();
                setDropdown(null);
                setFocus(cancelIndex);
                onCancel();
              }}
            />
          ) : null}
        </Stack>
      </Panel>
      {menu ? (
        <ComposerMenu
          menu={menu}
          title={menuHandlers.title}
          rows={rows}
          selected={index}
          bottom={height}
          height={menuHeight}
          count={count}
          active={active}
          query={query}
          onQuery={(value) => {
            setQuery(value);
            setCursor(0);
          }}
          onChoose={choose}
          status={
            interaction.error ??
            refreshError ??
            (catalog.status === "error"
              ? "Catalog unavailable. Reconnect from history."
              : refreshing
                ? "Refreshing..."
                : interaction.pending || interaction.modelPending
                  ? "Applying selection..."
                  : rows[index]?.detail || "Enter chooses; Esc closes")
          }
          statusFailed={Boolean(interaction.error || refreshError)}
          empty={
            catalog.status === "loading" || refreshing
              ? "Loading..."
              : catalog.status === "error"
                ? "Catalog unavailable. Reconnect from history."
                : "No matches. Esc keeps the text."
          }
        />
      ) : null}
    </Stack>
  );
}
