import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type {
  ModelSelection,
  OrchestrationProjectShell,
  ProjectId,
  RuntimeMode,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Option from "effect/Option";
import { useContext, useEffect, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import type { FavoriteModel, ProviderCatalog } from "../features/chat/providerChoices.ts";
import {
  availableModelChoices,
  favoriteChoicesFirst,
  isFavoriteChoice,
  selectionForModel,
} from "../features/chat/providerChoices.ts";
import { permissionChoices } from "../features/chat/composerModes.ts";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { Button } from "../ui/Button.tsx";
import { FormInput, FormRow } from "../ui/FormField.tsx";

interface Props {
  readonly client: TuiClient;
  readonly projectId: ProjectId | null;
  readonly favoriteModels: readonly FavoriteModel[];
  readonly height: number;
  readonly onClose: () => void;
  readonly onCreated: (projectId: ProjectId, threadId: ThreadId) => void;
}

export function NewThreadForm(props: Props) {
  const { client, onCreated } = props;
  const registry = useContext(RegistryContext);
  const shell = useAtomValue(props.client.shell);
  const catalog = useAtomValue(props.client.providers);
  const settings = useAtomValue(props.client.settings);
  const creation = useAtomValue(props.client.newThreads.state);
  const snapshot = Option.getOrNull(shell.snapshot);
  const [initialProjectId] = useState(props.projectId);
  const projectId = creation.attempt?.input.projectId ?? initialProjectId;
  const project = snapshot?.projects.find((item) => item.id === projectId);
  const created =
    creation.phase === "created"
      ? snapshot?.threads.find((thread) => thread.id === creation.attempt?.command.threadId)
      : undefined;
  useEffect(() => {
    if (!created) return;
    client.newThreads.reset(registry);
    onCreated(created.projectId, created.id);
  }, [created, registry, client, onCreated]);
  useKeyLayer("newThread", {
    modal: true,
    active: !(project && settings && catalog.status === "live"),
    bindings: { "newThread.close": props.onClose },
  });
  if (!project) return <Text tone="danger">The project is no longer available. Esc closes.</Text>;
  if (!settings || catalog.status !== "live")
    return (
      <Text tone="muted">
        {catalog.status === "error"
          ? "Provider catalog unavailable. Close and reconnect."
          : "Loading provider choices... Esc closes."}
      </Text>
    );
  return (
    <Fields key={project.id} {...props} project={project} catalog={catalog} settings={settings} />
  );
}

function Fields({
  client,
  project,
  catalog,
  settings,
  favoriteModels,
  height,
  onClose,
}: Props & {
  readonly project: OrchestrationProjectShell;
  readonly catalog: ProviderCatalog;
  readonly settings: ServerSettings;
}) {
  const registry = useContext(RegistryContext);
  const creation = useAtomValue(client.newThreads.state);
  const defaults = resolveProjectSettings(settings, project.id, project).settings;
  const choices = availableModelChoices(catalog.providers);
  const preferred = defaults.defaultModelSelection;
  const rankedChoices = favoriteChoicesFirst(choices, favoriteModels);
  const topFavorite = rankedChoices.find((choice) => isFavoriteChoice(favoriteModels, choice));
  const defaultChoice =
    topFavorite ??
    choices.find(
      (choice) =>
        choice.provider.instanceId === preferred?.instanceId &&
        choice.model.slug === preferred.model,
    ) ??
    choices.find((choice) => choice.model.isDefault) ??
    choices[0];
  const [title, setTitle] = useState(creation.attempt?.input.title ?? "");
  const [mode, setMode] = useState<"local" | "worktree">(
    creation.attempt?.input.mode ?? defaults.defaultThreadEnvMode ?? "local",
  );
  const [baseRef, setBaseRef] = useState(creation.attempt?.input.baseRef ?? "main");
  const [selection, setSelection] = useState<ModelSelection | null>(
    creation.attempt?.input.modelSelection ??
      (defaultChoice
        ? preferred?.instanceId === defaultChoice.provider.instanceId &&
          preferred.model === defaultChoice.model.slug
          ? preferred
          : { instanceId: defaultChoice.provider.instanceId, model: defaultChoice.model.slug }
        : null),
  );
  const [focus, setFocus] = useState("title");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    creation.attempt?.input.runtimeMode ?? defaults.defaultRuntimeMode,
  );
  const [permissionsMenu, setPermissionsMenu] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const locked = creation.attempt !== null;
  const busy =
    creation.phase === "worktree" || creation.phase === "thread" || creation.phase === "created";
  const targets = locked
    ? ["create", ...(creation.phase === "error" ? ["restart"] : []), "cancel"]
    : [
        "title",
        "local",
        "worktree",
        ...(mode === "worktree" ? ["base"] : []),
        "model",
        "permissions",
        "create",
        "cancel",
      ];
  const filtered = rankedChoices.filter((choice) =>
    `${choice.provider.displayName ?? choice.provider.instanceId} ${choice.model.name} ${choice.model.slug}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const advance = (offset: number) =>
    setFocus(targets[(targets.indexOf(focus) + offset + targets.length) % targets.length]!);
  const activate = (target: string) => {
    if (target === "cancel") {
      if (!locked) client.newThreads.reset(registry);
      onClose();
      return;
    }
    if (target === "restart") {
      setFocus("restart");
      if (!confirmRestart) setConfirmRestart(true);
      else if (client.newThreads.abandon(registry)) {
        setConfirmRestart(false);
        setFocus("title");
      }
      return;
    }
    if (target === "create") {
      setConfirmRestart(false);
      if (!selection) {
        setModelMenu(true);
        setFocus("model");
        return;
      }
      if (!busy && selection)
        void client.newThreads.create(registry, {
          projectId: project.id,
          title,
          mode,
          baseRef,
          modelSelection: selection,
          runtimeMode: creation.attempt?.input.runtimeMode ?? runtimeMode,
        });
      return;
    }
    if (locked) return;
    // Enter in the title is the short path: everything else already has a good default.
    if (target === "title" && selection && !busy) {
      void client.newThreads.create(registry, {
        projectId: project.id,
        title,
        mode,
        baseRef,
        modelSelection: selection,
        runtimeMode,
      });
      return;
    }
    setFocus(target);
    if (target === "local" || target === "worktree") setMode(target);
    else if (target === "permissions") {
      setPermissionsMenu(true);
      setCursor(
        Math.max(
          0,
          permissionChoices.findIndex((choice) => choice.id === runtimeMode),
        ),
      );
    } else if (target === "model") {
      setModelMenu(true);
      setQuery("");
      setCursor(0);
    } else advance(1);
  };
  const chooseModel = (index: number) => {
    const choice = filtered[index];
    if (!choice) return;
    setSelection(
      selection && selection.instanceId === choice.provider.instanceId
        ? selectionForModel(choice.provider, choice.model.slug, selection)
        : { instanceId: choice.provider.instanceId, model: choice.model.slug },
    );
    setModelMenu(false);
    setFocus("model");
  };
  const menuOpen = permissionsMenu || modelMenu;
  const moveCursor = (offset: number) => {
    const last = permissionsMenu ? permissionChoices.length - 1 : Math.max(0, filtered.length - 1);
    setCursor((value) => Math.max(0, Math.min(last, value + offset)));
  };
  useKeyLayer("newThread", {
    modal: true,
    typing: modelMenu || focus === "title" || focus === "base",
    bindings: {
      "newThread.close": () => {
        if (permissionsMenu) setPermissionsMenu(false);
        else if (modelMenu) setModelMenu(false);
        else activate("cancel");
      },
      "newThread.next": (key) => {
        if (menuOpen) {
          if (key?.name === "down") moveCursor(1);
          else return false;
        } else advance(1);
      },
      "newThread.previous": (key) => {
        if (menuOpen) {
          if (key?.name === "up") moveCursor(-1);
          else return false;
        } else advance(-1);
      },
      "newThread.previousOption": {
        enabled: !menuOpen && focus !== "title" && focus !== "base",
        run: () => advance(-1),
      },
      "newThread.nextOption": {
        enabled: !menuOpen && focus !== "title" && focus !== "base",
        run: () => advance(1),
      },
      "newThread.activate": {
        label:
          focus === "title" && !menuOpen ? "Create" : focus === "create" ? "Create" : "Activate",
        run: (key) => {
          if (permissionsMenu) {
            if (key?.name === "space") return false;
            setRuntimeMode(permissionChoices[cursor]!.id);
            setPermissionsMenu(false);
          } else if (modelMenu) {
            if (key?.name === "space") return false;
            chooseModel(Math.min(cursor, filtered.length - 1));
          } else {
            if (key?.name === "space" && (focus === "title" || focus === "base")) return false;
            activate(focus);
          }
        },
      },
    },
  });
  const button = (id: string, text: string, selected = false) => (
    <Button
      id={`new-thread-${id}`}
      label={text}
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      focused={focus === id}
      selected={selected}
      onPress={() => activate(id)}
    />
  );
  const selectedChoice = choices.find(
    (choice) =>
      choice.provider.instanceId === selection?.instanceId && choice.model.slug === selection.model,
  );
  const count = Math.max(1, Math.min(8, height - 5));
  const selectedIndex = Math.min(cursor, filtered.length - 1);
  const start = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(count / 2), filtered.length - count),
  );
  return (
    <Stack width="100%" height="100%" flexDirection="column" overflow="hidden">
      <Text height={1} strong>{`New thread in ${inlineTerminalText(project.title)}`}</Text>
      <Text height={1} tone="muted" wrapMode="none" truncate>
        {inlineTerminalText(project.workspaceRoot)}
      </Text>
      <FormRow label="Title" focused={focus === "title"}>
        <FormInput
          id="new-thread-title"
          value={title}
          placeholder="New thread"
          focused={!locked && focus === "title" && !modelMenu && !permissionsMenu}
          onInput={setTitle}
          onFocusRequest={() => {
            if (!locked) setFocus("title");
          }}
        />
      </FormRow>
      <FormRow label="Location" focused={focus === "local" || focus === "worktree"}>
        {button("local", `${mode === "local" ? "[x]" : "[ ]"} Current checkout`, mode === "local")}
        {button(
          "worktree",
          `${mode === "worktree" ? "[x]" : "[ ]"} New worktree`,
          mode === "worktree",
        )}
      </FormRow>
      {mode === "worktree" ? (
        <FormRow label="Base ref" focused={focus === "base"}>
          <FormInput
            id="new-thread-base"
            value={baseRef}
            focused={!locked && focus === "base" && !modelMenu && !permissionsMenu}
            onInput={setBaseRef}
            onFocusRequest={() => {
              if (!locked) setFocus("base");
            }}
          />
        </FormRow>
      ) : null}
      <FormRow label="Model" focused={focus === "model"}>
        {button(
          "model",
          `${selectedChoice?.provider.displayName ?? selection?.instanceId ?? "No provider"} / ${selectedChoice?.model.name ?? selection?.model ?? "No available model"} v`,
        )}
      </FormRow>
      <FormRow label="Access" focused={focus === "permissions"}>
        {button(
          "permissions",
          `${permissionChoices.find((choice) => choice.id === (creation.attempt?.input.runtimeMode ?? runtimeMode))?.label ?? "Permissions"} v`,
        )}
      </FormRow>
      <Text height={2} tone="muted">
        {mode === "worktree"
          ? "New branch and worktree from the base ref's committed files. No setup scripts run automatically."
          : "Uses the project's existing checkout. No Git branch or worktree is created."}
      </Text>
      {creation.attempt?.worktree ? (
        <Text
          height={1}
          tone="muted"
          wrapMode="none"
          truncate
        >{`Worktree: ${inlineTerminalText(creation.attempt.worktree.path)}`}</Text>
      ) : creation.attempt?.worktreeInput ? (
        <Text
          height={1}
          tone="muted"
          wrapMode="none"
          truncate
        >{`Branch: ${creation.attempt.worktreeInput.newRefName}`}</Text>
      ) : null}
      <Text height={2} tone={creation.error ? "danger" : "muted"}>
        {confirmRestart
          ? "Start over keeps any created thread, branch, or worktree. Note its location above; select Confirm start over to continue."
          : (creation.error ??
            (creation.phase === "worktree"
              ? "Creating the worktree on the environment..."
              : creation.phase === "thread"
                ? "Creating the shared thread..."
                : creation.phase === "created"
                  ? "Waiting for the shared thread to appear..."
                  : !selection
                    ? "No model is available. Configure a provider in T3 settings, then choose its model."
                    : "Create opens an empty thread. No prompt is sent."))}
      </Text>
      <Stack flexGrow={1} />
      <Stack height={1} flexShrink={0} flexDirection="row">
        {button(
          "create",
          busy ? "[ Creating... ]" : locked ? "[ Retry creation ]" : "[ Create thread ]",
        )}
        {locked && creation.phase === "error"
          ? button("restart", confirmRestart ? "[ Confirm start over ]" : "[ Start over ]")
          : null}
        {button("cancel", locked ? "[ Close ]" : "[ Cancel ]")}
      </Stack>
      {permissionsMenu ? (
        <Panel
          title="Access level · Esc cancels"
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          zIndex={25}
          flexDirection="column"
        >
          {permissionChoices.map((choice, index) => (
            <Stack
              key={choice.id}
              id={`new-thread-access-${choice.id}`}
              height={2}
              flexShrink={0}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                setRuntimeMode(choice.id);
                setPermissionsMenu(false);
              }}
            >
              <SelectionRow
                selected={cursor === index}
                active
                label={`${choice.id === runtimeMode ? "* " : ""}${choice.label}`}
              />
              <Text height={1} tone="muted" wrapMode="none" truncate>
                {choice.detail}
              </Text>
            </Stack>
          ))}
        </Panel>
      ) : null}
      {modelMenu ? (
        <Panel
          position="absolute"
          top={2}
          left={0}
          width="100%"
          height={count + 3}
          title="Choose provider / model"
          borderTone="borderFocused"
          flexDirection="column"
        >
          <FormInput
            id="new-thread-model-search"
            width="100%"
            focused
            value={query}
            placeholder="Search models..."
            onInput={(value) => {
              setQuery(value);
              setCursor(0);
            }}
          />
          {filtered.length === 0 ? (
            <Text tone="muted">No available models match. Configure providers in T3 settings.</Text>
          ) : null}
          {filtered.slice(start, start + count).map((choice, index) => (
            <Stack
              key={JSON.stringify([choice.provider.instanceId, choice.model.slug])}
              height={1}
              flexShrink={0}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                chooseModel(start + index);
              }}
            >
              <SelectionRow
                selected={start + index === selectedIndex}
                label={`${isFavoriteChoice(favoriteModels, choice) ? "★ " : ""}${choice.provider.displayName ?? choice.provider.instanceId} / ${choice.model.name}`}
              />
            </Stack>
          ))}
        </Panel>
      ) : null}
    </Stack>
  );
}
