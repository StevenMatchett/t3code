import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useRenderer } from "@opentui/react";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ProviderInstanceConfig,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Option from "effect/Option";
import { useContext, useEffect, useState } from "react";

import type { TuiClient } from "../connection/clientRuntime.ts";
import {
  configFieldValue,
  effectiveInstanceConfig,
  GENERAL_SETTINGS,
  generalValueLabel,
  isDefaultInstance,
  nextGeneralValue,
  parseInstanceId,
  PROVIDER_DRIVERS,
  providerConfigFields,
  providerDriver,
  providerInstanceUpdate,
  providerName,
  providerStatus,
  suggestInstanceId,
  withConfigFieldValue,
  withEnvironmentVariable,
  withoutEnvironmentVariable,
} from "../features/settings/settingsModel.ts";
import { openBrowser } from "../platform/browser.ts";
import { FormInput } from "../ui/FormField.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { listWindowStart } from "../ui/ListView.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

type SettingsView =
  | { readonly kind: "root" }
  | { readonly kind: "providers" }
  | { readonly kind: "provider"; readonly instanceId: ProviderInstanceId }
  | { readonly kind: "signin"; readonly instanceId: ProviderInstanceId }
  | { readonly kind: "add-provider" }
  | { readonly kind: "general" };

/** One line of a settings list. Rows without an action are information and the cursor skips them. */
interface SettingsRow {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
  readonly badge?: { readonly label: string; readonly tone: StatusTone };
  readonly description?: string;
  readonly tone?: "muted" | "danger" | "accent";
  readonly activate?: () => unknown;
  /** Present on text rows: Enter edits, and Enter again saves through this. */
  readonly edit?: {
    readonly value: string;
    readonly placeholder?: string;
    readonly commit: (value: string) => unknown;
  };
  readonly remove?: () => unknown;
}

interface ViewContext {
  readonly client: TuiClient;
  readonly settings: ServerSettings | null;
  readonly providers: readonly ServerProvider[];
  readonly push: (view: SettingsView) => void;
  readonly replace: (view: SettingsView) => void;
  readonly pop: () => void;
  /** Runs a server call, reporting failure or the success text on the notice line. */
  readonly run: (work: () => Promise<unknown>, success?: string) => Promise<boolean>;
  readonly notify: (text: string, failed?: boolean) => void;
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;

function errorText(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The server rejected the change.";
}

function viewTitle(view: SettingsView, providers: readonly ServerProvider[]) {
  const name = (instanceId: ProviderInstanceId) => {
    const provider = providers.find((item) => item.instanceId === instanceId);
    return provider ? providerName(provider) : instanceId;
  };
  switch (view.kind) {
    case "root":
      return "Settings";
    case "providers":
      return "Settings › Providers";
    case "provider":
      return `Settings › Providers › ${name(view.instanceId)}`;
    case "signin":
      return `Settings › Providers › ${name(view.instanceId)} › Sign in`;
    case "add-provider":
      return "Settings › Providers › Add an account";
    case "general":
      return "Settings › General";
  }
}

/**
 * Environment settings and provider setup: enable, install, sign in, configure, and add provider
 * accounts. Every change saves to the server at once, so other clients of the server see it too.
 */
export function SettingsPanel({
  client,
  height,
  active,
  onClose,
  onOpenTheme,
  onOpenFavorites,
}: {
  readonly client: TuiClient;
  readonly height: number;
  readonly active: boolean;
  readonly onClose: () => void;
  readonly onOpenTheme: () => void;
  readonly onOpenFavorites: () => void;
}) {
  const registry = useContext(RegistryContext);
  const settings = useAtomValue(client.settings);
  const catalog = useAtomValue(client.providers);
  const [stack, setStack] = useState<readonly { view: SettingsView; cursor: number }[]>([
    { view: { kind: "root" }, cursor: 0 },
  ]);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const top = stack.at(-1)!;
  const notify = (text: string, failed = false) => setNotice({ text, failed });
  const context: ViewContext = {
    client,
    settings,
    providers: catalog.providers,
    push: (view) => {
      setNotice(null);
      setStack((current) => [...current, { view, cursor: 0 }]);
    },
    replace: (view) => setStack((current) => [...current.slice(0, -1), { view, cursor: 0 }]),
    pop: () => {
      setNotice(null);
      if (stack.length === 1) onClose();
      else setStack((current) => current.slice(0, -1));
    },
    notify,
    run: async (work, success) => {
      try {
        await work();
        if (success) notify(success);
        return true;
      } catch (error) {
        notify(errorText(error), true);
        return false;
      }
    },
  };
  const setCursor = (cursor: number) =>
    setStack((current) => [...current.slice(0, -1), { ...current.at(-1)!, cursor }]);
  const list = {
    context,
    cursor: top.cursor,
    setCursor,
    active,
    height,
    title: viewTitle(top.view, catalog.providers),
    notice,
  };
  switch (top.view.kind) {
    case "root":
      return (
        <RootView
          {...list}
          catalogStatus={catalog.status}
          onOpenTheme={onOpenTheme}
          onOpenFavorites={onOpenFavorites}
        />
      );
    case "providers":
      return <ProvidersView {...list} registry={registry} />;
    case "provider":
      return (
        <ProviderView
          key={top.view.instanceId}
          {...list}
          registry={registry}
          instanceId={top.view.instanceId}
        />
      );
    case "signin":
      return (
        <SignInView
          key={top.view.instanceId}
          {...list}
          registry={registry}
          instanceId={top.view.instanceId}
        />
      );
    case "add-provider":
      return <AddProviderView {...list} registry={registry} />;
    case "general":
      return <GeneralView {...list} registry={registry} />;
  }
}

interface ListProps {
  readonly context: ViewContext;
  readonly cursor: number;
  readonly setCursor: (cursor: number) => void;
  readonly active: boolean;
  readonly height: number;
  readonly title: string;
  readonly notice: { readonly text: string; readonly failed: boolean } | null;
}

type Registry = React.ContextType<typeof RegistryContext>;

function RootView({
  catalogStatus,
  onOpenTheme,
  onOpenFavorites,
  ...props
}: ListProps & {
  readonly catalogStatus: "loading" | "live" | "error";
  readonly onOpenTheme: () => void;
  readonly onOpenFavorites: () => void;
}) {
  const { providers, push } = props.context;
  const ready = providers.filter((provider) => providerStatus(provider).tone === "success").length;
  const needsSetup = providers.filter(
    (provider) => provider.enabled && providerStatus(provider).tone !== "success",
  ).length;
  const summary =
    catalogStatus !== "live"
      ? catalogStatus === "error"
        ? "unavailable"
        : "loading…"
      : `${ready} ready${needsSetup ? ` · ${needsSetup} need setup` : ""}`;
  return (
    <SettingsList
      {...props}
      rows={[
        {
          id: "providers",
          label: "Providers",
          value: summary,
          description: "Install, sign in to, and configure the agents this server runs.",
          activate: () => push({ kind: "providers" }),
        },
        {
          id: "general",
          label: "General",
          description: "Defaults for new threads, worktrees, and branches.",
          activate: () => push({ kind: "general" }),
        },
        {
          id: "favorites",
          label: "Favorite models",
          description: "Pick and order the models new threads offer first.",
          activate: onOpenFavorites,
        },
        {
          id: "theme",
          label: "Theme",
          description: "Colors for this terminal.",
          activate: onOpenTheme,
        },
      ]}
    />
  );
}

function ProvidersView({ registry, ...props }: ListProps & { readonly registry: Registry }) {
  const { providers, push, run, client } = props.context;
  return (
    <SettingsList
      {...props}
      refresh={() =>
        run(
          () =>
            Promise.all(
              providers.map((provider) =>
                client.providerSetup.refresh(registry, provider.instanceId),
              ),
            ),
          "Checked every provider.",
        )
      }
      rows={[
        ...(providers.length === 0
          ? [
              {
                id: "empty",
                label: "This server has not reported any providers yet.",
                tone: "muted" as const,
              },
            ]
          : providers.map((provider) => ({
              id: `provider:${provider.instanceId}`,
              label: providerName(provider),
              badge: providerStatus(provider),
              description: inlineTerminalText(
                [
                  providerDriver(provider.driver)?.label ?? provider.driver,
                  provider.message ?? provider.unavailableReason,
                ]
                  .filter(Boolean)
                  .join(" · "),
              ),
              activate: () => push({ kind: "provider", instanceId: provider.instanceId }),
            }))),
        {
          id: "add",
          label: "Add a provider account…",
          tone: "accent",
          description:
            "Run a second account of a provider side by side, such as a work and a personal Codex.",
          activate: () => push({ kind: "add-provider" }),
        },
      ]}
    />
  );
}

function ProviderView({
  registry,
  instanceId,
  ...props
}: ListProps & { readonly registry: Registry; readonly instanceId: ProviderInstanceId }) {
  const { client, settings, providers, push, pop, run } = props.context;
  const provider = providers.find((item) => item.instanceId === instanceId);
  const install = useAtomValue(client.providerSetup.installState(instanceId));
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (!provider || !settings) {
    return (
      <SettingsList
        {...props}
        rows={[
          { id: "loading", label: "Waiting for the server to load this provider…", tone: "muted" },
        ]}
      />
    );
  }
  const instance = effectiveInstanceConfig(settings, provider);
  const driverLabel = providerDriver(provider.driver)?.label ?? provider.driver;
  const save = (next: ProviderInstanceConfig, success = "Saved.") => {
    const { patch, mutation } = providerInstanceUpdate(provider, next);
    return run(() => client.providerSetup.updateSettings(registry, patch, mutation), success);
  };
  const refresh = () =>
    run(
      () => client.providerSetup.refresh(registry, instanceId),
      `Checked ${providerName(provider)}.`,
    );
  const installing = Option.getOrNull(AsyncResult.value(install));
  const installBusy =
    installing !== null && ["downloading", "extracting", "verifying"].includes(installing.phase);
  const advisory = provider.versionAdvisory;
  const auth = provider.auth;
  const rows: SettingsRow[] = [
    {
      id: "summary",
      label: [
        driverLabel,
        provider.version ? `v${provider.version}` : provider.installed ? null : "not installed",
        auth.email ?? auth.label ?? null,
      ]
        .filter(Boolean)
        .join(" · "),
      badge: providerStatus(provider),
      tone: "muted",
    },
    ...(provider.message || provider.unavailableReason
      ? [
          {
            id: "message",
            label: inlineTerminalText(provider.message ?? provider.unavailableReason ?? ""),
            tone: "muted" as const,
          },
        ]
      : []),
    {
      id: "enabled",
      label: "Enabled",
      value: provider.enabled ? "On" : "Off",
      description: "Turned off, the provider is hidden from model pickers and never started.",
      activate: () =>
        save(
          { ...instance, enabled: !provider.enabled },
          provider.enabled ? "Turned off." : "Turned on.",
        ),
    },
  ];
  if (provider.setup?.canInstall && !provider.installed) {
    rows.push(
      installBusy && installing
        ? {
            id: "install",
            label: `Installing ${driverLabel}…`,
            value: installing.totalBytes
              ? `${Math.round((installing.downloadedBytes / installing.totalBytes) * 100)}%`
              : installing.phase,
            description: "Press Enter to cancel.",
            activate: () =>
              installing.operationId
                ? run(() =>
                    client.providerSetup.cancelInstall(registry, {
                      instanceId,
                      operationId: installing.operationId!,
                    }),
                  )
                : undefined,
          }
        : {
            id: "install",
            label: `Install ${driverLabel}`,
            tone: "accent",
            description:
              installing?.phase === "failed"
                ? (installing.message ?? "The last install failed.")
                : "Download a copy managed by this server.",
            activate: () =>
              run(() => client.providerSetup.startInstall(registry, instanceId), "Installing…"),
          },
    );
  } else if (!provider.installed) {
    rows.push({
      id: "install-help",
      label: `Install the ${driverLabel} CLI on the server's machine, then press R.`,
      tone: "muted",
      ...(provider.setup?.documentationUrl ? { description: provider.setup.documentationUrl } : {}),
    });
  }
  if (provider.installed && auth.status !== "authenticated") {
    rows.push(
      provider.setup?.canAuthenticate
        ? {
            id: "signin",
            label: "Sign in",
            tone: "accent",
            description: "Sign in through the server. Works from any device connected to it.",
            activate: () => push({ kind: "signin", instanceId }),
          }
        : {
            id: "signin-help",
            label: `Sign in with the ${driverLabel} CLI in a terminal, then press R.`,
            tone: "muted",
          },
    );
  }
  if (auth.status === "authenticated" && provider.setup?.canAuthenticate) {
    rows.push({
      id: "signout",
      label: "Sign out",
      description: "Removes this provider's saved sign-in on the server.",
      activate: () => run(() => client.providerSetup.logout(registry, instanceId), "Signed out."),
    });
  }
  rows.push({
    id: "refresh",
    label: "Check again",
    description: "Re-detect the CLI, sign-in, and models now.",
    activate: refresh,
  });
  if (advisory?.status === "behind_latest" && advisory.canUpdate) {
    rows.push({
      id: "update",
      label: `Update to ${advisory.latestVersion ?? "the latest version"}`,
      ...(provider.updateState?.status === "running" ? { value: "updating…" } : {}),
      description:
        provider.updateState?.message ?? advisory.message ?? "Install the newest CLI version.",
      activate: () =>
        run(
          () => client.providerSetup.update(registry, { provider: provider.driver, instanceId }),
          "Update started.",
        ),
    });
  }
  rows.push({
    id: "displayName",
    label: "Display name",
    value: instance.displayName ?? "",
    description: "The name model pickers show.",
    edit: {
      value: instance.displayName ?? "",
      placeholder: driverLabel,
      commit: (value) => {
        const { displayName: _previous, ...rest } = instance;
        return save(value.trim() ? { ...rest, displayName: value.trim() } : rest);
      },
    },
  });
  for (const field of providerConfigFields(provider.driver)) {
    const value = configFieldValue(instance.config, field);
    const setField = (next: string | boolean) =>
      save({ ...instance, config: withConfigFieldValue(instance.config, field, next) });
    const base = {
      id: `config:${field.key}`,
      label: field.label,
      ...(field.description ? { description: field.description } : {}),
    };
    if (field.control === "switch") {
      rows.push({ ...base, value: value ? "On" : "Off", activate: () => setField(!value) });
    } else if (field.control === "select" && field.options?.length) {
      const options = field.options;
      const index = options.findIndex((option) => option.value === value);
      rows.push({
        ...base,
        value: options[Math.max(0, index)]!.label,
        activate: () => setField(options[(index + 1) % options.length]!.value),
      });
    } else {
      const text = String(value);
      rows.push({
        ...base,
        value: field.control === "password" && text ? "••••••" : text,
        edit: {
          value: field.control === "password" ? "" : text,
          ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          commit: setField,
        },
      });
    }
  }
  for (const variable of instance.environment ?? []) {
    // A value is plain text or a reference into a secret store, which only the server reads.
    const plain = typeof variable.value === "string" ? variable.value : null;
    const hidden = variable.sensitive || variable.valueRedacted || plain === null;
    rows.push({
      id: `env:${variable.name}`,
      label: variable.name,
      value:
        typeof variable.value !== "string"
          ? `secret from ${variable.value.provider}`
          : hidden
            ? plain || variable.valueRedacted
              ? "••••••"
              : ""
            : plain,
      description: "Environment variable for this provider. Enter replaces it; X removes it.",
      edit: {
        value: hidden ? "" : (plain ?? ""),
        commit: (value) =>
          save(withEnvironmentVariable(instance, { ...variable, value, valueRedacted: false })),
      },
      remove: () =>
        save(withoutEnvironmentVariable(instance, variable.name), `Removed ${variable.name}.`),
    });
  }
  rows.push({
    id: "env:add",
    label: "Add environment variable…",
    description:
      "Type NAME=value. Names with KEY, TOKEN, SECRET, or PASSWORD are stored as secrets.",
    edit: {
      value: "",
      placeholder: "NAME=value",
      commit: (entry) => {
        const separator = entry.indexOf("=");
        const name = entry.slice(0, separator).trim();
        if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          props.context.notify("Type the variable as NAME=value.", true);
          return;
        }
        return save(
          withEnvironmentVariable(instance, {
            name,
            value: entry.slice(separator + 1),
            sensitive: SECRET_NAME.test(name),
          }),
          `Added ${name}.`,
        );
      },
    },
  });
  if (!isDefaultInstance(provider)) {
    rows.push({
      id: "remove",
      label: confirmRemove ? "Press Enter again to remove this account" : "Remove this account",
      tone: "danger",
      description: "Deletes this provider account's settings from the server.",
      activate: async () => {
        if (!confirmRemove) {
          setConfirmRemove(true);
          return;
        }
        if (
          await run(
            () =>
              client.providerSetup.updateSettings(
                registry,
                {},
                { operation: "remove", instanceId },
              ),
            `Removed ${providerName(provider)}.`,
          )
        )
          pop();
      },
    });
  }
  return <SettingsList {...props} rows={rows} refresh={refresh} />;
}

function SignInView({
  registry,
  instanceId,
  ...props
}: ListProps & { readonly registry: Registry; readonly instanceId: ProviderInstanceId }) {
  const { client, providers, pop, run, notify } = props.context;
  const renderer = useRenderer();
  const result = useAtomValue(client.providerSetup.authState(instanceId));
  const state: ProviderAuthState | null = Option.getOrNull(AsyncResult.value(result));
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const provider = providers.find((item) => item.instanceId === instanceId);
  const signedIn = state?.phase === "succeeded";
  useEffect(() => {
    if (signedIn) void client.providerSetup.refresh(registry, instanceId).catch(() => undefined);
  }, [signedIn, client, registry, instanceId]);
  const start = (methodId?: string) =>
    run(() =>
      client.providerSetup.startAuth(registry, {
        instanceId,
        callbackMode: "server",
        ...(methodId ? { methodId } : {}),
      }),
    );
  const respond = (
    response: Parameters<TuiClient["providerSetup"]["respondAuth"]>[1]["response"],
  ) =>
    state?.flowId && state.interaction
      ? run(() =>
          client.providerSetup.respondAuth(registry, {
            instanceId,
            flowId: state.flowId!,
            interactionId: state.interaction!.id,
            response,
          }),
        )
      : undefined;
  const linkRows = (url: string): SettingsRow[] => [
    { id: "url", label: inlineTerminalText(url), tone: "muted" },
    {
      id: "open",
      label: "Open in browser",
      activate: async () => {
        try {
          if (!(await openBrowser(url)))
            notify("No browser here. Copy the link and open it on any device.");
        } catch (error) {
          notify(errorText(error), true);
        }
      },
    },
    {
      id: "copy",
      label: "Copy link",
      activate: () =>
        notify(
          renderer.copyToClipboardOSC52(url)
            ? "Copied the link."
            : "This terminal cannot copy. Select the link above.",
        ),
    },
  ];
  const back = () => {
    if (state?.flowId && (state.phase === "waiting" || state.phase === "starting")) {
      void client.providerSetup
        .cancelAuth(registry, { instanceId, flowId: state.flowId })
        .catch(() => undefined);
    }
    pop();
  };
  const rows: SettingsRow[] = [];
  if (!state || result._tag === "Initial") {
    rows.push({ id: "loading", label: "Loading sign-in options…", tone: "muted" });
  } else if (state.phase === "idle" || state.phase === "cancelled" || state.phase === "failed") {
    if (state.phase === "failed")
      rows.push({
        id: "failed",
        label: inlineTerminalText(state.message ?? "Sign-in failed."),
        tone: "danger",
      });
    const methods = state.methods ?? [];
    if (methods.length > 1) {
      for (const method of methods)
        rows.push({
          id: `method:${method.id}`,
          label: method.name,
          ...(method.description ? { description: method.description } : {}),
          activate: () => start(method.id),
        });
    } else {
      rows.push({
        id: "start",
        label:
          state.phase === "failed"
            ? "Try again"
            : `Sign in to ${provider ? providerName(provider) : instanceId}`,
        tone: "accent",
        activate: () => start(methods[0]?.id),
      });
    }
  } else if (state.phase === "starting" || state.phase === "verifying") {
    rows.push({
      id: "busy",
      label: state.phase === "starting" ? "Starting sign-in…" : "Verifying…",
      tone: "muted",
    });
  } else if (signedIn) {
    rows.push(
      {
        id: "done-message",
        label: inlineTerminalText(state.message ?? "Signed in."),
        badge: { label: "Signed in", tone: "success" },
      },
      { id: "done", label: "Done", tone: "accent", activate: pop },
    );
  } else {
    const interaction = state.interaction;
    if (state.message)
      rows.push({ id: "message", label: inlineTerminalText(state.message), tone: "muted" });
    if (interaction?.type === "deviceCode") {
      rows.push(
        {
          id: "code",
          label: "Code",
          value: interaction.userCode,
          badge: { label: "Enter it on the sign-in page", tone: "info" },
        },
        ...linkRows(interaction.url),
        {
          id: "copy-code",
          label: "Copy code",
          activate: () =>
            notify(
              renderer.copyToClipboardOSC52(interaction.userCode)
                ? "Copied the code."
                : "This terminal cannot copy.",
            ),
        },
      );
    } else if (interaction?.type === "browser") {
      rows.push(
        { id: "browser-help", label: "Open this link and finish signing in:", tone: "muted" },
        ...linkRows(interaction.url),
      );
      if (interaction.requiresConsent)
        rows.push(
          {
            id: "accept",
            label: "Continue",
            tone: "accent",
            activate: () => respond({ type: "browser", action: "accept" }),
          },
          {
            id: "decline",
            label: "Decline",
            activate: () => respond({ type: "browser", action: "decline" }),
          },
        );
      if (interaction.acceptsCallback && state.flowId)
        rows.push({
          id: "callback",
          label: "Paste the address the browser ended on",
          description:
            "Only needed when the browser runs on another machine and shows an error page.",
          edit: {
            value: "",
            placeholder: "http://localhost:…",
            commit: (callbackUrl) =>
              run(() =>
                client.providerSetup.completeAuth(registry, {
                  instanceId,
                  flowId: state.flowId!,
                  callbackUrl,
                }),
              ),
          },
        });
    } else if (interaction?.type === "terminal") {
      const lines = interaction.output
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-Math.max(3, props.height - 8));
      lines.forEach((line, index) =>
        rows.push({ id: `out:${index}`, label: inlineTerminalText(line), tone: "muted" }),
      );
      rows.push({
        id: "terminal-input",
        label: "Send input",
        description: "Typed text is sent to the sign-in program, followed by Enter.",
        edit: { value: "", commit: (data) => respond({ type: "terminal", data: `${data}\r` }) },
      });
    } else if (interaction?.type === "credentials") {
      for (const field of interaction.fields)
        rows.push({
          id: `field:${field.name}`,
          label: field.label,
          value:
            field.secret && credentials[field.name] ? "••••••" : (credentials[field.name] ?? ""),
          edit: {
            value: field.secret ? "" : (credentials[field.name] ?? ""),
            commit: (value) => setCredentials((current) => ({ ...current, [field.name]: value })),
          },
        });
      rows.push({
        id: "submit",
        label: "Submit",
        tone: "accent",
        activate: () => respond({ type: "credentials", values: credentials }),
      });
    } else if (state.authorizationUrl) {
      rows.push(...linkRows(state.authorizationUrl));
    } else {
      rows.push({ id: "waiting", label: "Waiting for the provider…", tone: "muted" });
    }
  }
  return <SettingsList {...props} rows={rows} onBack={back} />;
}

function AddProviderView({ registry, ...props }: ListProps & { readonly registry: Registry }) {
  const { client, providers, settings, replace, run, notify } = props.context;
  const drivers = PROVIDER_DRIVERS.filter(
    // ACP Registry accounts are picked from a registry search the TUI does not have.
    (definition) => definition.driverKind !== "acpRegistry",
  );
  const taken = [
    ...providers.map((provider) => provider.instanceId as string),
    ...Object.keys(settings?.providerInstances ?? {}),
  ];
  const [driver, setDriver] = useState<ProviderDriverKind>(drivers[0]!.driverKind);
  const [instanceId, setInstanceId] = useState(() =>
    suggestInstanceId(drivers[0]!.driverKind, taken),
  );
  const [label, setLabel] = useState("");
  const definition = providerDriver(driver)!;
  const add = async () => {
    const parsed = parseInstanceId(instanceId, taken);
    if ("error" in parsed) {
      notify(parsed.error, true);
      return;
    }
    const id = parsed.id;
    const instance: ProviderInstanceConfig = {
      driver,
      enabled: true,
      ...(label.trim() ? { displayName: label.trim() } : {}),
      // The web settings start new Codex accounts on the user's own CLI, not a managed copy.
      ...(driver === "codex" ? { config: { setupMode: "existing" } } : {}),
    };
    if (
      await run(
        () =>
          client.providerSetup.updateSettings(
            registry,
            {},
            { operation: "create", instanceId: id, instance },
          ),
        `Added ${label.trim() || id}.`,
      )
    )
      replace({ kind: "provider", instanceId: id });
  };
  return (
    <SettingsList
      {...props}
      rows={[
        {
          id: "driver",
          label: "Provider",
          value: definition.label,
          description: "Enter cycles through the providers.",
          activate: () => {
            const next =
              drivers[
                (drivers.findIndex((item) => item.driverKind === driver) + 1) % drivers.length
              ]!.driverKind;
            setDriver(next);
            setInstanceId(suggestInstanceId(next, taken));
          },
        },
        {
          id: "id",
          label: "Id",
          value: instanceId,
          description: "A permanent id for this account: lowercase letters, digits, and dashes.",
          edit: { value: instanceId, commit: (value) => setInstanceId(value.trim()) },
        },
        {
          id: "label",
          label: "Display name",
          value: label,
          description: "Optional, such as Work Codex.",
          edit: { value: label, placeholder: definition.label, commit: setLabel },
        },
        { id: "add", label: "Add account", tone: "accent", activate: add },
      ]}
    />
  );
}

function GeneralView({ registry, ...props }: ListProps & { readonly registry: Registry }) {
  const { client, settings, run } = props.context;
  if (!settings)
    return (
      <SettingsList
        {...props}
        rows={[{ id: "loading", label: "Loading settings…", tone: "muted" }]}
      />
    );
  const save = (patch: Parameters<TuiClient["providerSetup"]["updateSettings"]>[1]) =>
    run(() => client.providerSetup.updateSettings(registry, patch), "Saved.");
  return (
    <SettingsList
      {...props}
      rows={GENERAL_SETTINGS.map((setting) => {
        const current = setting.read(settings);
        const next = nextGeneralValue(setting, current);
        return {
          id: setting.key,
          label: setting.label,
          value: generalValueLabel(setting, current),
          description: setting.description,
          ...(next === null
            ? {
                edit: {
                  value: String(current),
                  commit: (value: string) => save(setting.patch(value)),
                },
              }
            : { activate: () => save(setting.patch(next)) }),
        };
      })}
    />
  );
}

/** A scrolling list of settings rows with a title, the selected row's help, and a notice line. */
function SettingsList({
  context,
  rows,
  cursor,
  setCursor,
  active,
  height,
  title,
  notice,
  refresh,
  onBack,
}: ListProps & {
  readonly rows: readonly SettingsRow[];
  readonly refresh?: () => unknown;
  readonly onBack?: () => void;
}) {
  const [editing, setEditing] = useState<{ readonly id: string; readonly value: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const selectable = rows.flatMap((row, index) => (row.activate || row.edit ? [index] : []));
  const selectedIndex = selectable.includes(cursor)
    ? cursor
    : (selectable.find((index) => index >= cursor) ?? selectable.at(-1) ?? -1);
  const selected = selectedIndex === -1 ? undefined : rows[selectedIndex];
  const editingRow = editing ? rows.find((row) => row.id === editing.id) : undefined;
  const move = (offset: number) => {
    if (selectable.length === 0) return;
    const position = Math.max(0, selectable.indexOf(selectedIndex));
    setCursor(selectable[(position + offset + selectable.length) % selectable.length]!);
  };
  const perform = async (work: () => unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  useKeyLayer("settings", {
    active,
    modal: true,
    typing: editingRow !== undefined,
    ...(busy ? { context: "Saving…" } : {}),
    bindings: {
      "settings.up": { enabled: !editingRow, run: () => move(-1) },
      "settings.down": { enabled: !editingRow, run: () => move(1) },
      "settings.confirm": () => {
        if (editingRow?.edit && editing) {
          const { value } = editing;
          setEditing(null);
          void perform(() => editingRow.edit!.commit(value));
        } else if (selected?.edit) setEditing({ id: selected.id, value: selected.edit.value });
        else if (selected?.activate) void perform(selected.activate);
      },
      "settings.back": () => {
        if (editingRow) setEditing(null);
        else (onBack ?? context.pop)();
      },
      "settings.refresh": {
        enabled: refresh !== undefined && !editingRow,
        run: () => {
          if (refresh) void perform(refresh);
        },
      },
      "settings.remove": {
        enabled: selected?.remove !== undefined && !editingRow,
        run: () => {
          if (selected?.remove) void perform(selected.remove);
        },
      },
    },
  });
  // Title, help, and notice take three rows.
  const visible = Math.max(1, height - 3);
  const start = listWindowStart(Math.max(0, selectedIndex), visible, rows.length);
  const help = editingRow
    ? "Enter saves · Esc cancels"
    : (selected?.description ?? (selected?.edit ? "Enter to edit" : ""));
  return (
    <Stack width="100%" height="100%" flexDirection="column">
      <Text height={1} tone="accent" strong wrapMode="none" truncate>
        {title}
      </Text>
      <Stack flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">
        {rows.slice(start, start + visible).map((row, offset) => {
          const index = start + offset;
          const isSelected = index === selectedIndex;
          if (editingRow && row.id === editingRow.id && editing) {
            return (
              <Stack key={row.id} height={1} flexShrink={0} flexDirection="row">
                <Text
                  width={Math.min(28, row.label.length + 4)}
                  flexShrink={0}
                  tone="accent"
                  strong
                  wrapMode="none"
                  truncate
                >
                  {`> ${row.label}: `}
                </Text>
                <FormInput
                  id={`settings-edit-${row.id}`}
                  value={editing.value}
                  {...(row.edit?.placeholder ? { placeholder: row.edit.placeholder } : {})}
                  focused={active}
                  onInput={(value) => setEditing({ id: row.id, value })}
                />
              </Stack>
            );
          }
          if (!row.activate && !row.edit) {
            return (
              <Stack key={row.id} height={1} flexShrink={0} flexDirection="row">
                <Text flexGrow={1} minWidth={0} tone={row.tone ?? "muted"} wrapMode="none" truncate>
                  {`  ${row.label}${row.value ? `  ${row.value}` : ""}`}
                </Text>
                {row.badge ? (
                  <StatusBadge flexShrink={0} label={row.badge.label} tone={row.badge.tone} />
                ) : null}
              </Stack>
            );
          }
          return (
            <Stack
              key={row.id}
              id={`settings-row-${row.id}`}
              height={1}
              flexShrink={0}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                setCursor(index);
              }}
            >
              <SelectionRow
                selected={isSelected}
                active={active}
                label={
                  row.value !== undefined ? `${row.label}: ${row.value || "(not set)"}` : row.label
                }
                {...(row.badge
                  ? {
                      trailing: (
                        <StatusBadge flexShrink={0} label={row.badge.label} tone={row.badge.tone} />
                      ),
                    }
                  : {})}
              />
            </Stack>
          );
        })}
      </Stack>
      <Text height={1} tone="muted" wrapMode="none" truncate>
        {help}
      </Text>
      <Text height={1} tone={notice?.failed ? "danger" : "success"} wrapMode="none" truncate>
        {busy ? "Saving…" : (notice?.text ?? "")}
      </Text>
    </Stack>
  );
}
