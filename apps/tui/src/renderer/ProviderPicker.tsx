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
  availableHeight,
  onActivate,
  onBlur,
  onSubmit,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly focused: boolean;
  readonly editorHeight: number;
  readonly availableHeight: number;
  readonly onActivate: () => void;
  readonly onBlur: () => void;
  readonly onSubmit: () => void;
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
  const editor = useRef<PromptEditorControl | null>(null);
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
    const trigger = skillCompletionAt(next.text, next.cursor);
    if (trigger && previousTrigger.current !== trigger.start) refresh(false);
    previousTrigger.current = trigger?.start ?? null;
    setSnapshot((old) => (old.text === next.text && old.cursor === next.cursor ? old : next));
    if (next.text !== snapshot.text || next.cursor !== snapshot.cursor) setCursor(0);
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
  useKeyboard((key) => {
    if (!active || !focused || key.ctrl || key.meta || key.option) return;
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
    } else if (key.name === "tab")
      setFocus(
        (value) => (value + (key.shift ? descriptors.length + 1 : 1)) % (descriptors.length + 2),
      );
    else if (key.name === "escape") {
      if (focus > 0) setFocus(0);
      else onBlur();
    } else if (
      focus > 0 &&
      (key.name === "return" || key.name === "enter" || key.name === "space")
    ) {
      if (!key.repeated)
        open(focus === 1 ? "models" : `option:${descriptors[focus - 2]!.id}`, focus);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  const height = editorHeight + 3;
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
    <Stack height={height} flexShrink={0} width="100%" overflow="visible">
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
          value={interaction.draft}
          onChange={(value) => client.actions.setDraft(registry, threadId, value)}
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
        <Stack height={1} flexShrink={0} flexDirection="row" width="100%">
          {buttons.map((button, buttonIndex) => (
            <Stack
              key={button.id}
              id={`composer-${button.id}`}
              flexGrow={1}
              flexBasis={0}
              minWidth={0}
              height={1}
              {...(focused && focus === buttonIndex + 1 && selectedBackground
                ? { backgroundColor: selectedBackground }
                : {})}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                open(button.id, buttonIndex + 1);
              }}
            >
              <Text
                height={1}
                wrapMode="none"
                truncate
                tone={
                  dropdown === button.id || (focused && focus === buttonIndex + 1)
                    ? "accent"
                    : "muted"
                }
              >
                {inlineTerminalText(button.label)}
              </Text>
            </Stack>
          ))}
          {descriptors.length === 0 ? (
            <Text tone="muted" height={1} wrapMode="none" truncate flexGrow={1}>
              Reasoning: provider default
            </Text>
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
