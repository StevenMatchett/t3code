import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
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
import type { ProviderCatalog } from "../features/chat/providerChoices.ts";
import { selectionForModel } from "../features/chat/providerChoices.ts";
import { permissionChoices } from "../features/chat/composerModes.ts";
import { Panel } from "../ui/Panel.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { useThemeColor } from "../ui/context.tsx";

interface Props {
  readonly client: TuiClient;
  readonly projectId: ProjectId | null;
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
  useKeyboard((key) => {
    if (key.name !== "escape" || (project && settings && catalog.status === "live")) return;
    key.preventDefault();
    key.stopPropagation();
    props.onClose();
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
  const choices = catalog.providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.availability !== "unavailable" &&
        provider.status !== "error" &&
        provider.auth.status !== "unauthenticated",
    )
    .flatMap((provider) => provider.models.map((model) => ({ provider, model })));
  const preferred = defaults.defaultModelSelection;
  const defaultChoice =
    choices.find(
      (choice) =>
        choice.provider.instanceId === preferred?.instanceId &&
        choice.model.slug === preferred.model,
    ) ??
    choices.find((choice) => choice.model.isDefault) ??
    choices[0];
  const [title, setTitle] = useState(creation.attempt?.input.title ?? "");
  const [mode, setMode] = useState<"local" | "worktree">(
    creation.attempt?.input.mode ?? defaults.defaultThreadEnvMode,
  );
  const [baseRef, setBaseRef] = useState(creation.attempt?.input.baseRef ?? "HEAD");
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
  const background = useThemeColor("panel");
  const foreground = useThemeColor("text");
  const selectionColor = useThemeColor("selection");
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
  const filtered = choices.filter((choice) =>
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
  useKeyboard((key) => {
    if (key.ctrl || key.meta || key.option) return;
    if (permissionsMenu) {
      if (key.name === "escape") setPermissionsMenu(false);
      else if (key.name === "up") setCursor((value) => Math.max(0, value - 1));
      else if (key.name === "down")
        setCursor((value) => Math.min(permissionChoices.length - 1, value + 1));
      else if ((key.name === "return" || key.name === "enter") && !key.repeated) {
        setRuntimeMode(permissionChoices[cursor]!.id);
        setPermissionsMenu(false);
      } else return;
    } else if (modelMenu) {
      switch (key.name) {
        case "escape":
          setModelMenu(false);
          break;
        case "up":
          setCursor((value) => Math.max(0, value - 1));
          break;
        case "down":
          setCursor((value) => Math.min(Math.max(0, filtered.length - 1), value + 1));
          break;
        case "return":
        case "enter":
          if (!key.repeated) chooseModel(Math.min(cursor, filtered.length - 1));
          break;
        default:
          return;
      }
    } else if (key.name === "escape") activate("cancel");
    else if (key.name === "tab") advance(key.shift ? -1 : 1);
    else if (key.name === "up" || key.name === "down") advance(key.name === "up" ? -1 : 1);
    else if ((key.name === "left" || key.name === "right") && focus !== "title" && focus !== "base")
      advance(key.name === "left" ? -1 : 1);
    else if (
      (key.name === "enter" ||
        key.name === "return" ||
        (key.name === "space" && focus !== "title" && focus !== "base")) &&
      !key.repeated
    )
      activate(focus);
    else return;
    key.preventDefault();
    key.stopPropagation();
  });
  const button = (id: string, text: string, selected = false) => (
    <Stack
      id={`new-thread-${id}`}
      height={1}
      flexGrow={1}
      minWidth={0}
      {...(focus === id && selectionColor ? { backgroundColor: selectionColor } : {})}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activate(id);
      }}
    >
      <Text
        height={1}
        wrapMode="none"
        truncate
        strong={selected}
        tone={focus === id || selected ? "accent" : "muted"}
      >
        {text}
      </Text>
    </Stack>
  );
  const inputColors = {
    ...(background ? { backgroundColor: background, focusedBackgroundColor: background } : {}),
    ...(foreground ? { textColor: foreground, focusedTextColor: foreground } : {}),
  };
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
      <Stack height={1} flexDirection="row">
        <Text width={10}>Title</Text>
        <input
          id="new-thread-title"
          flexGrow={1}
          minWidth={1}
          value={title}
          placeholder="New thread"
          focused={!locked && focus === "title" && !modelMenu && !permissionsMenu}
          onInput={setTitle}
          onMouseDown={() => {
            if (!locked) setFocus("title");
          }}
          {...inputColors}
        />
      </Stack>
      <Stack height={1} flexDirection="row">
        <Text width={10}>Location</Text>
        {button("local", `${mode === "local" ? "[x]" : "[ ]"} Current checkout`, mode === "local")}
        {button(
          "worktree",
          `${mode === "worktree" ? "[x]" : "[ ]"} New worktree`,
          mode === "worktree",
        )}
      </Stack>
      {mode === "worktree" ? (
        <Stack height={1} flexDirection="row">
          <Text width={10}>Base ref</Text>
          <input
            id="new-thread-base"
            flexGrow={1}
            minWidth={1}
            value={baseRef}
            focused={!locked && focus === "base" && !modelMenu && !permissionsMenu}
            onInput={setBaseRef}
            onMouseDown={() => {
              if (!locked) setFocus("base");
            }}
            {...inputColors}
          />
        </Stack>
      ) : null}
      <Stack height={1} flexDirection="row">
        <Text width={10}>Model</Text>
        {button(
          "model",
          `${selectedChoice?.provider.displayName ?? selection?.instanceId ?? "No provider"} / ${selectedChoice?.model.name ?? selection?.model ?? "No available model"} v`,
        )}
      </Stack>
      <Stack height={1} flexDirection="row">
        <Text width={10}>Access</Text>
        {button(
          "permissions",
          `${permissionChoices.find((choice) => choice.id === (creation.attempt?.input.runtimeMode ?? runtimeMode))?.label ?? "Permissions"} v`,
        )}
      </Stack>
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
          <input
            id="new-thread-model-search"
            width="100%"
            focused
            value={query}
            placeholder="Search models..."
            onInput={(value) => {
              setQuery(value);
              setCursor(0);
            }}
            {...inputColors}
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
                label={`${choice.provider.displayName ?? choice.provider.instanceId} / ${choice.model.name}`}
              />
            </Stack>
          ))}
        </Panel>
      ) : null}
    </Stack>
  );
}
