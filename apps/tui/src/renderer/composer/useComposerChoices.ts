import { RegistryContext } from "@effect/atom-react";
import { formatProviderSkillDisplayName } from "@t3tools/client-runtime/providerSkills";
import type { ModelSelection, ServerProvider, ThreadId } from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  type getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { useContext, type RefObject } from "react";
import type { TuiClient } from "../../connection/clientRuntime.ts";
import type { TuiThread } from "../../connection/models.ts";
import { permissionChoices, planModeProblem } from "../../features/chat/composerModes.ts";
import type { ThreadInteractionState } from "../../features/chat/interactions.ts";
import { selectableSkills, selectionForModel } from "../../features/chat/providerChoices.ts";
import {
  completeSkillDraft,
  skillCompletionAt,
  type SkillCompletion,
} from "../../features/chat/skillCompletion.ts";
import { useUi } from "../../ui/context.tsx";
import { composerCommands } from "../../features/chat/composerCommands.ts";
import {
  completePathDraft,
  pathCompletionAt,
  type PathCompletion,
} from "../../features/chat/pathCompletion.ts";
import { useProjectPathSearch } from "./useProjectPathSearch.ts";
import type { PromptEditorControl } from "../PromptEditor.tsx";
import type { ComposerMenuRow } from "./ComposerMenu.tsx";

/** What the composer's controls say and what choosing a menu row does. */
export function useComposerChoices({
  client,
  threadId,
  thread,
  provider,
  model,
  descriptors,
  interaction,
  catalogStatus,
  menu,
  query,
  cursor,
  cwd,
  completion,
  pathTrigger,
  refreshing,
  editor,
  menuGeneration,
  mounted,
  close,
  openMenu,
}: {
  readonly client: TuiClient;
  readonly threadId: ThreadId;
  readonly thread: TuiThread | null;
  readonly provider: ServerProvider | undefined;
  readonly model: ServerProvider["models"][number] | undefined;
  readonly descriptors: ReturnType<typeof getProviderOptionDescriptors>;
  readonly interaction: ThreadInteractionState;
  readonly catalogStatus: string;
  readonly menu: string | null;
  readonly query: string;
  readonly cursor: number;
  readonly cwd: string | null;
  readonly completion: SkillCompletion | null;
  readonly pathTrigger: PathCompletion | null;
  readonly refreshing: boolean;
  readonly editor: RefObject<PromptEditorControl | null>;
  readonly menuGeneration: RefObject<number>;
  readonly mounted: RefObject<boolean>;
  readonly close: () => void;
  readonly openMenu: (id: string) => void;
}) {
  const registry = useContext(RegistryContext);
  const { capabilities } = useUi();
  const arrow = capabilities.unicode ? "▼" : "v";
  const planProblem = planModeProblem(provider);
  const runtimeMode = interaction.runtimeMode ?? thread?.runtimeMode;
  const interactionMode =
    interaction.interactionMode ?? (planProblem ? "default" : thread?.interactionMode);
  const buttons = [
    {
      id: "models",
      label: `${model?.shortName ?? model?.name ?? thread?.modelSelection.model ?? "Loading"} ${arrow}`,
    },
    ...descriptors.map((item) => ({
      id: `option:${item.id}`,
      label: `${item.label}: ${getProviderOptionCurrentLabel(item) ?? "Default"} ${arrow}`,
    })),
    {
      id: "mode",
      label: `${interactionMode === "plan" ? "Plan" : "Chat"} ${arrow}`,
    },
    {
      id: "permissions",
      label: `${permissionChoices.find((choice) => choice.id === runtimeMode)?.label ?? "Permissions"} ${arrow}`,
    },
  ];
  const needle = (menu === "skills" ? (completion?.query ?? "") : query).toLocaleLowerCase();
  const commands = composerCommands(provider).filter((command) =>
    `${command.name} ${command.detail}`.toLocaleLowerCase().includes(needle),
  );
  const files = useProjectPathSearch({
    client,
    cwd,
    query: menu === "files" ? (pathTrigger?.query ?? null) : null,
  });
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
  const modeChoices = (
    menu === "permissions"
      ? permissionChoices
      : [
          { id: "default", label: "Chat", detail: "Work on the task normally." },
          {
            id: "plan",
            label: `Plan${planProblem ? " (unavailable)" : ""}`,
            detail: planProblem ?? "Plan the work before making changes.",
          },
        ]
  ).filter((item) => item.label.toLocaleLowerCase().includes(needle));
  const rows: readonly ComposerMenuRow[] =
    menu === "permissions" || menu === "mode"
      ? modeChoices.map((item) => ({
          ...item,
          label: `${item.id === (menu === "permissions" ? runtimeMode : interactionMode) ? "* " : ""}${item.label}`,
        }))
      : menu === "files"
        ? files.entries.map((entry) => ({
            id: entry.path,
            label: `@${entry.path}${entry.kind === "directory" ? "/" : ""}`,
            detail: `Enter adds this ${entry.kind === "directory" ? "folder" : "file"}. Esc keeps your text.`,
          }))
        : menu === "skills"
          ? [
              ...commands.map((command) => ({
                id: `command:${command.name}`,
                label: `/${command.name}`,
                detail: command.detail,
              })),
              ...skills.map((skill) => ({
                id: skill.path,
                label: `/${skill.name}  ${formatProviderSkillDisplayName(skill)}`,
                detail: skill.shortDescription ?? skill.description ?? skill.path,
              })),
            ]
          : menu === "models"
            ? models.map((item) => ({
                id: item.slug,
                label: `${item.slug === thread?.modelSelection.model ? "* " : ""}${item.name}  [${item.slug}]`,
                detail:
                  thread?.latestTurn?.state === "running" || thread?.session?.status === "starting"
                    ? "Applies to the next turn."
                    : item.slug,
              }))
            : choices.map((item, rowIndex) => ({
                id: String(rowIndex),
                label: item.label,
                detail: descriptor?.description ?? "",
              }));
  const index = Math.max(0, Math.min(cursor, rows.length - 1));
  const busy =
    refreshing ||
    interaction.pending !== null ||
    interaction.modelPending !== null ||
    catalogStatus !== "live";
  const choose = (selected: number) => {
    if (menu === "files") {
      const entry = files.entries[selected];
      const live = editor.current?.snapshot();
      const trigger = live ? pathCompletionAt(live.text, live.cursor) : null;
      if (!entry || !live || !trigger) return;
      const replacement = completePathDraft(live.text, trigger, entry.path);
      close();
      editor.current?.replace(replacement.text, replacement.cursor);
      return;
    }
    if (busy || !thread || !provider || !rows[selected]) return;
    if (menu === "skills" && selected < commands.length) {
      const live = editor.current?.snapshot();
      const trigger = live ? skillCompletionAt(live.text, live.cursor) : null;
      if (!live || !trigger) return;
      const command = commands[selected]!;
      if (command.kind === "text") {
        const replacement = `${live.text.slice(0, trigger.start)}/${command.name} ${live.text.slice(trigger.end).replace(/^ /u, "")}`;
        close();
        editor.current?.replace(replacement, trigger.start + command.name.length + 2);
        return;
      }
      const remaining = completeSkillDraft(live.text, "", trigger);
      close();
      editor.current?.replace(remaining.text, remaining.cursor);
      if (command.kind === "model") openMenu("models");
      else if (command.kind === "mode")
        client.actions.setInteractionMode(registry, threadId, command.mode);
      else void client.actions.sendCommand(registry, threadId, `/${command.name}`);
      return;
    }
    if (menu === "skills") {
      const live = editor.current?.snapshot();
      const trigger = live ? skillCompletionAt(live.text, live.cursor) : null;
      if (!trigger || trigger.query !== completion?.query || trigger.text !== interaction.draft)
        return;
      const previousPrefix = interaction.skill?.prefix;
      if (
        !client.actions.selectSkill(
          registry,
          threadId,
          skills[selected - commands.length]!,
          trigger,
        )
      )
        return;
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
    if (menu === "permissions") {
      const choice = permissionChoices.find((item) => item.id === rows[selected]!.id);
      if (choice && client.actions.setRuntimeMode(registry, threadId, choice.id)) close();
      return;
    }
    if (menu === "mode") {
      const mode = rows[selected]!.id;
      if (
        (mode === "default" || mode === "plan") &&
        client.actions.setInteractionMode(registry, threadId, mode)
      )
        close();
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
  const title =
    menu === "files"
      ? "Files"
      : menu === "skills"
        ? "Commands and skills"
        : menu === "models"
          ? "Models"
          : menu === "permissions"
            ? "Permissions — next message"
            : menu === "mode"
              ? "Mode — next message"
              : (descriptor?.label ?? "Options");
  return { buttons, rows, index, choose, title, filesEmpty: files.status };
}
