import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import type { ModelSelection, ThreadId } from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/client-runtime/providerSkills";
import { getProviderOptionDescriptors, getProviderOptionCurrentLabel } from "@t3tools/shared/model";
import * as Option from "effect/Option";
import { useContext, useEffect, useRef, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { selectableSkills, selectionForModel } from "../features/chat/providerChoices.ts";
import { completeSkillDraft, skillCompletionAt } from "../features/chat/skillCompletion.ts";
import {
  buildComposerPromptHistoryEntries,
  stepComposerPromptHistory,
  type ComposerPromptHistoryPosition,
} from "../features/chat/promptHistory.ts";
import { trailingPastedImagePaths } from "../features/chat/imageAttachments.ts";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { useThemeColor } from "../ui/context.tsx";
import { PromptEditor, type PromptEditorControl, type PromptSnapshot } from "./PromptEditor.tsx";

export function ComposerControls({
  client,
  threadId,
  active,
  focused,
  editorHeight,
  suggestedReplies,
  availableHeight,
  onActivate,
  onDraftChange,
  onBlur,
  onSubmit,
  onFocusNext,
  onMenuChange,
  onCancel,
  cancelPending = false,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly focused: boolean;
  readonly editorHeight: number;
  readonly suggestedReplies: readonly string[];
  readonly availableHeight: number;
  readonly onActivate: () => void;
  readonly onDraftChange?: () => void;
  readonly onBlur: () => void;
  readonly onSubmit: () => void;
  readonly onFocusNext?: () => void;
  readonly onMenuChange?: (open: boolean) => void;
  readonly onCancel?: () => void;
  readonly cancelPending?: boolean;
}) {
  const registry = useContext(RegistryContext);
  const catalog = useAtomValue(client.providers);
  const threadState = useAtomValue(client.thread(threadId));
  const shell = useAtomValue(client.shell);
  const interaction = useAtomValue(client.actions.state(threadId));
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
  const background = useThemeColor("panel");
  const foreground = useThemeColor("text");
  const selectedBackground = useThemeColor("selection");
  const [savedComposer] = useState(() => client.session?.composer(threadId));
  const editor = useRef<PromptEditorControl | null>(null);
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
  useEffect(() => {
    onMenuChange?.(menu !== null);
  }, [menu, onMenuChange]);
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
  const chooseSuggestedReply = (index: number) => {
    const reply = suggestedReplies[index];
    if (!reply || interaction.pending || interaction.attachmentPending) return;
    client.actions.setDraft(registry, threadId, reply);
    onSubmit();
  };
  const cancelIndex = suggestedReplies.length + descriptors.length + 2;
  const focusCount = cancelIndex + (onCancel ? 1 : 0);
  const needle = (menu === "skills" ? (completion?.query ?? "") : query).toLocaleLowerCase();
  const skills = provider
    ? selectableSkills(provider, cwd).filter((skill) =>
        `${skill.name} ${skill.displayName ?? ""} ${skill.description ?? ""}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : [];
  const models = (provider?.models ?? []).filter((item) =>
    `${item.name} ${item.slug}`.toLocaleLowerCase().includes(needle),
  );
  const descriptor = descriptors.find((item) => `option:${item.id}` === menu);
  const choices = descriptor
    ? [
        { label: "Provider default", value: undefined as string | boolean | undefined },
        ...(descriptor.type === "boolean"
          ? [
              { label: "On", value: true },
              { label: "Off", value: false },
            ]
          : descriptor.options.map((item) => ({ label: item.label, value: item.id }))),
      ].filter((item) => item.label.toLocaleLowerCase().includes(needle))
    : [];
  const rows =
    menu === "skills"
      ? skills.map((skill) => ({
          id: skill.path,
          label: `/${skill.name}  ${formatProviderSkillDisplayName(skill)}`,
          detail: skill.shortDescription ?? skill.description ?? skill.path,
        }))
      : menu === "models"
        ? models.map((item) => ({
            id: item.slug,
            label: `${item.slug === thread?.modelSelection.model ? "* " : ""}${item.name}  [${item.slug}]`,
            detail: item.slug,
          }))
        : choices.map((item, index) => ({
            id: String(index),
            label: item.label,
            detail: descriptor?.description ?? "",
          }));
  const index = Math.max(0, Math.min(cursor, rows.length - 1));
  const busy =
    refreshing ||
    interaction.pending !== null ||
    interaction.modelPending !== null ||
    catalog.status !== "live";
  const choose = (selected: number) => {
    if (busy || !thread || !provider || !rows[selected]) return;
    if (menu === "skills") {
      const live = editor.current?.snapshot();
      const trigger = live ? skillCompletionAt(live.text, live.cursor) : null;
      if (!trigger || trigger.query !== completion?.query || trigger.text !== interaction.draft)
        return;
      const previousPrefix = interaction.skill?.prefix;
      if (!client.actions.selectSkill(registry, threadId, skills[selected]!, trigger)) return;
      const current = registry.get(client.actions.state(threadId));
      const replacement = completeSkillDraft(
        trigger.text,
        current.skill!.prefix,
        trigger,
        previousPrefix,
      );
      close();
      editor.current?.replace(replacement.text, replacement.cursor);
      return;
    }
    let selection: ModelSelection;
    if (menu === "models")
      selection = selectionForModel(provider, models[selected]!.slug, thread.modelSelection);
    else if (descriptor) {
      const options = (thread.modelSelection.options ?? []).filter(
        (option) => option.id !== descriptor.id,
      );
      const value = choices[selected]!.value;
      if (value !== undefined) options.push({ id: descriptor.id, value });
      selection = {
        instanceId: provider.instanceId,
        model: thread.modelSelection.model,
        ...(options.length ? { options } : {}),
      };
    } else return;
    const generation = menuGeneration.current;
    void client.actions.changeModel(registry, threadId, selection).then((ok) => {
      if (mounted.current && ok && generation === menuGeneration.current) close();
    });
  };
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
  useKeyboard((key) => {
    if (!active || !focused) return;
    if (key.ctrl && key.name === "backspace" && interaction.attachments.length > 0) {
      const attachment = interaction.attachments.at(-1)!;
      client.actions.removeAttachment(registry, threadId, attachment.id!);
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (key.ctrl || key.meta || key.option) return;
    if (
      !menu &&
      focus === 0 &&
      !key.shift &&
      (key.name === "up" || key.name === "down") &&
      recallPrompt(key.name === "up" ? "backward" : "forward")
    ) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (menu) {
      switch (key.name) {
        case "escape":
          close();
          break;
        case "up":
          setCursor((value) => Math.max(0, value - 1));
          break;
        case "down":
          setCursor((value) => Math.min(Math.max(0, rows.length - 1), value + 1));
          break;
        case "tab":
          if (!key.shift) choose(index);
          else close();
          break;
        case "return":
        case "enter":
          if (key.shift) return;
          if (!key.repeated) choose(index);
          break;
        default:
          return;
      }
    } else if (
      suggestedReplies.length > 0 &&
      (key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") &&
      ((focus === 0 && interaction.draft.length === 0) ||
        (focus > 0 && focus <= suggestedReplies.length))
    ) {
      const offset = key.name === "up" || key.name === "left" ? -1 : 1;
      setFocus((current) => {
        if (current < 1 || current > suggestedReplies.length)
          return offset < 0 ? suggestedReplies.length : 1;
        return ((current - 1 + offset + suggestedReplies.length) % suggestedReplies.length) + 1;
      });
    } else if (key.name === "tab") {
      if (!key.shift && onFocusNext && focus === focusCount - 1) onFocusNext();
      else setFocus((value) => (value + (key.shift ? focusCount - 1 : 1)) % focusCount);
    } else if (key.name === "escape") {
      if (focus > 0) setFocus(0);
      else onBlur();
    } else if (
      focus > 0 &&
      (key.name === "return" || key.name === "enter" || key.name === "space")
    ) {
      if (!key.repeated) {
        if (focus <= suggestedReplies.length) chooseSuggestedReply(focus - 1);
        else if (onCancel && focus === cancelIndex) {
          if (!cancelPending) onCancel();
        } else {
          const controlIndex = focus - suggestedReplies.length;
          open(
            controlIndex === 1 ? "models" : `option:${descriptors[controlIndex - 2]!.id}`,
            focus,
          );
        }
      }
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  const attachmentHeight = interaction.attachments.length > 0 ? 1 : 0;
  const suggestedReplyHeight = suggestedReplies.length > 0 ? 1 : 0;
  const height = editorHeight + attachmentHeight + suggestedReplyHeight + 3;
  const menuHeight = Math.max(4, Math.min(10, availableHeight - height));
  const count = Math.max(1, menuHeight - (menu === "skills" ? 3 : 4));
  const start = Math.max(0, Math.min(index - Math.floor(count / 2), rows.length - count));
  const buttons = [
    {
      id: "models",
      label: `Model: ${model?.shortName ?? model?.name ?? thread?.modelSelection.model ?? "Loading"} v`,
    },
    ...descriptors.map((item) => ({
      id: `option:${item.id}`,
      label: `${item.label}: ${getProviderOptionCurrentLabel(item) ?? "Default"} v`,
    })),
  ];
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
        <Stack height={1} flexShrink={0} flexDirection="row" width="100%">
          {buttons.map((button, buttonIndex) => (
            <Stack
              key={button.id}
              id={`composer-${button.id}`}
              flexGrow={1}
              flexBasis={0}
              minWidth={0}
              height={1}
              {...(focused &&
              focus === suggestedReplies.length + buttonIndex + 1 &&
              selectedBackground
                ? { backgroundColor: selectedBackground }
                : {})}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                open(button.id, suggestedReplies.length + buttonIndex + 1);
              }}
            >
              <Text
                height={1}
                wrapMode="none"
                truncate
                tone={
                  dropdown === button.id ||
                  (focused && focus === suggestedReplies.length + buttonIndex + 1)
                    ? "accent"
                    : "muted"
                }
              >
                {inlineTerminalText(button.label)}
              </Text>
            </Stack>
          ))}
          {descriptors.length === 0 ? (
            <Text
              tone="muted"
              height={1}
              wrapMode="none"
              truncate
              flexGrow={1}
              flexBasis={0}
              minWidth={0}
            >
              Reasoning: provider default
            </Text>
          ) : null}
          {onCancel ? (
            <Stack
              id="conversation-cancel-turn"
              height={1}
              flexGrow={1}
              flexBasis={0}
              minWidth={0}
              {...(focused && focus === cancelIndex && selectedBackground
                ? { backgroundColor: selectedBackground }
                : {})}
              onMouseDown={(event) => {
                if (event.button !== 0 || cancelPending) return;
                event.preventDefault();
                event.stopPropagation();
                onActivate();
                setDropdown(null);
                setFocus(cancelIndex);
                onCancel();
              }}
            >
              <Text height={1} tone="danger" strong wrapMode="none" truncate>
                Cancel
              </Text>
            </Stack>
          ) : null}
        </Stack>
      </Panel>
      {menu ? (
        <Panel
          id="composer-dropdown"
          position="absolute"
          bottom={height}
          left={0}
          zIndex={20}
          width="100%"
          height={menuHeight}
          borderTone="borderFocused"
          title={
            menu === "skills"
              ? "Skills"
              : menu === "models"
                ? "Models"
                : (descriptor?.label ?? "Options")
          }
          flexDirection="column"
        >
          {menu !== "skills" ? (
            <input
              id="composer-filter"
              focused={active}
              width="100%"
              value={query}
              placeholder="Search..."
              onInput={(value) => {
                setQuery(value);
                setCursor(0);
              }}
              {...(background
                ? { backgroundColor: background, focusedBackgroundColor: background }
                : {})}
              {...(foreground ? { textColor: foreground, focusedTextColor: foreground } : {})}
            />
          ) : null}
          <Stack height={count} flexShrink={0} flexDirection="column" overflow="hidden">
            {rows.length ? (
              rows.slice(start, start + count).map((row, rowIndex) => (
                <Stack
                  key={row.id}
                  height={1}
                  flexShrink={0}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    choose(start + rowIndex);
                  }}
                >
                  <SelectionRow label={row.label} selected={start + rowIndex === index} />
                </Stack>
              ))
            ) : (
              <Text tone="muted">
                {catalog.status === "loading" || refreshing
                  ? "Loading..."
                  : catalog.status === "error"
                    ? "Catalog unavailable. Reconnect from history."
                    : "No matches. Esc keeps the text."}
              </Text>
            )}
          </Stack>
          <Text
            height={1}
            tone={interaction.error || refreshError ? "danger" : "muted"}
            wrapMode="none"
            truncate
          >
            {interaction.error ??
              refreshError ??
              (catalog.status === "error"
                ? "Catalog unavailable. Reconnect from history."
                : refreshing
                  ? "Refreshing..."
                  : interaction.pending || interaction.modelPending
                    ? "Applying selection..."
                    : rows[index]?.detail || "Enter chooses; Esc closes")}
          </Text>
        </Panel>
      ) : null}
    </Stack>
  );
}
