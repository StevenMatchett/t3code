import {
  AcpRegistrySettings,
  AntigravitySettings,
  BranchNamingMode,
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  DEFAULT_UNIFIED_SETTINGS,
  defaultInstanceIdForDriver,
  GrokSettings,
  OpenCodeSettings,
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ResponseStreamingMode,
  RuntimeMode,
  ThreadEnvMode,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ProviderInstanceMutation,
  type ProviderSettingsFormAnnotation,
  type ProviderSettingsFormControl,
  type ProviderSettingsFormOption,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { StatusTone } from "../../ui/StatusBadge.tsx";

/** One line of what a provider needs before it can run, worst problem first. */
export function providerStatus(provider: ServerProvider): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  if (!provider.enabled) return { label: "Off", tone: "muted" };
  if (provider.availability === "unavailable") return { label: "Unavailable", tone: "danger" };
  if (!provider.installed) return { label: "Not installed", tone: "warning" };
  if (provider.auth.status === "unauthenticated")
    return { label: "Sign in needed", tone: "warning" };
  if (provider.status === "error") return { label: "Error", tone: "danger" };
  if (provider.status === "warning") return { label: "Ready, with a warning", tone: "warning" };
  return { label: "Ready", tone: "success" };
}

export function providerName(provider: Pick<ServerProvider, "displayName" | "instanceId">) {
  return provider.displayName ?? provider.instanceId;
}

interface ProviderDriverDefinition {
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly settingsSchema: Schema.Struct<Schema.Struct.Fields>;
  /** Built-in drivers whose default instance mirrors `settings.providers[driver]`. */
  readonly legacyDefault: boolean;
}

/** Drivers the TUI can configure. Matches the web settings' provider list. */
export const PROVIDER_DRIVERS: readonly ProviderDriverDefinition[] = [
  {
    driver: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
    legacyDefault: true,
  },
  {
    driver: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
    legacyDefault: true,
  },
  {
    driver: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    settingsSchema: CursorSettings,
    legacyDefault: true,
  },
  {
    driver: ProviderDriverKind.make("grok"),
    label: "Grok",
    settingsSchema: GrokSettings,
    legacyDefault: true,
  },
  {
    driver: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    settingsSchema: OpenCodeSettings,
    legacyDefault: true,
  },
  {
    driver: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
    legacyDefault: true,
  },
  {
    driver: ProviderDriverKind.make("pi"),
    label: "Pi",
    settingsSchema: PiSettings,
    legacyDefault: true,
  },
  {
    driver: ProviderDriverKind.make("acpRegistry"),
    label: "ACP Registry",
    settingsSchema: AcpRegistrySettings,
    legacyDefault: false,
  },
];

export function providerDriver(driver: ProviderDriverKind) {
  return PROVIDER_DRIVERS.find((definition) => definition.driver === driver);
}

export interface ProviderConfigField {
  readonly key: string;
  readonly control: ProviderSettingsFormControl;
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly clearWhenEmpty: "omit" | "persist";
  readonly defaultBoolean?: boolean;
  readonly options?: readonly ProviderSettingsFormOption[];
}

type FieldSchema = Schema.Struct.Fields[string];

function fieldAnnotations(field: FieldSchema) {
  return Schema.resolveAnnotationsKey(field) ?? Schema.resolveAnnotations(field);
}

function titleize(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

/**
 * The driver's editable config fields, read from the annotations on its settings schema in
 * `packages/contracts`, so the TUI and the web settings render the same fields in the same order.
 */
export function providerConfigFields(driver: ProviderDriverKind): readonly ProviderConfigField[] {
  const definition = providerDriver(driver);
  if (!definition) return [];
  const schema = definition.settingsSchema;
  const order = Schema.resolveAnnotations(schema)?.providerSettingsFormSchema?.order ?? [];
  const rank = (key: string, index: number) => {
    const position = order.indexOf(key);
    return position === -1 ? order.length + index : position;
  };
  return Object.keys(schema.fields)
    .map((key, index) => ({ key, index }))
    .toSorted((left, right) => rank(left.key, left.index) - rank(right.key, right.index))
    .flatMap(({ key }) => {
      const field = schema.fields[key]!;
      const annotations = fieldAnnotations(field);
      const form: ProviderSettingsFormAnnotation = annotations?.providerSettingsForm ?? {};
      if (form.hidden) return [];
      const control = form.control ?? "text";
      const title = annotations?.title;
      const description = annotations?.description;
      const decodedDefault = Schema.decodeUnknownOption(field as Schema.Decoder<unknown>)(
        undefined as unknown,
      );
      return [
        {
          key,
          control,
          label: typeof title === "string" ? title : titleize(key),
          ...(typeof description === "string" ? { description } : {}),
          ...(form.placeholder === undefined ? {} : { placeholder: form.placeholder }),
          clearWhenEmpty: form.clearWhenEmpty ?? "omit",
          ...(control === "switch" &&
          Option.isSome(decodedDefault) &&
          typeof decodedDefault.value === "boolean"
            ? { defaultBoolean: decodedDefault.value }
            : {}),
          ...(form.options ? { options: form.options } : {}),
        } satisfies ProviderConfigField,
      ];
    });
}

function configRecord(config: unknown): Record<string, unknown> {
  return typeof config === "object" && config !== null && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

export function configFieldValue(config: unknown, field: ProviderConfigField): string | boolean {
  const value = configRecord(config)[field.key];
  if (field.control === "switch")
    return typeof value === "boolean" ? value : (field.defaultBoolean ?? false);
  if (field.control === "select")
    return typeof value === "string" ? value : (field.options?.[0]?.value ?? "");
  if (Array.isArray(value)) return value.join(" ");
  return typeof value === "string" ? value : "";
}

/** Config with one field set. An emptied field is dropped when the schema says to omit it. */
export function withConfigFieldValue(
  config: unknown,
  field: ProviderConfigField,
  value: string | boolean,
): Record<string, unknown> {
  const { [field.key]: _previous, ...rest } = configRecord(config);
  if (typeof value === "string" && value.trim() === "" && field.clearWhenEmpty === "omit")
    return rest;
  return { ...rest, [field.key]: typeof value === "string" ? value.trim() : value };
}

/**
 * The instance config the server runs. A built-in default instance that was never edited lives
 * only in the legacy `settings.providers[driver]` blob, so it is synthesized from there.
 */
export function effectiveInstanceConfig(
  settings: Pick<ServerSettings, "providers" | "providerInstances">,
  provider: Pick<ServerProvider, "instanceId" | "driver" | "enabled">,
): ProviderInstanceConfig {
  const explicit = settings.providerInstances?.[provider.instanceId];
  if (explicit) return explicit;
  const legacy = (settings.providers as Record<string, Record<string, unknown> | undefined>)[
    provider.driver
  ];
  if (provider.instanceId === defaultInstanceIdForDriver(provider.driver) && legacy) {
    const { enabled, ...config } = legacy;
    return {
      driver: provider.driver,
      enabled: typeof enabled === "boolean" ? enabled : provider.enabled,
      config,
    };
  }
  return { driver: provider.driver, enabled: provider.enabled };
}

export function isDefaultInstance(provider: Pick<ServerProvider, "instanceId" | "driver">) {
  return provider.instanceId === defaultInstanceIdForDriver(provider.driver);
}

/**
 * The settings update that saves one instance. Saving a default instance also resets its legacy
 * blob, as the web settings do, so the explicit instance is the only copy that can win.
 */
export function providerInstanceUpdate(
  settings: Pick<ServerSettings, "providers">,
  provider: Pick<ServerProvider, "instanceId" | "driver">,
  instance: ProviderInstanceConfig,
): { readonly patch: ServerSettingsPatch; readonly mutation: ProviderInstanceMutation } {
  const legacyDefault = isDefaultInstance(provider)
    ? (DEFAULT_UNIFIED_SETTINGS.providers as Record<string, unknown>)[provider.driver]
    : undefined;
  return {
    patch:
      legacyDefault === undefined
        ? {}
        : ({
            providers: { ...settings.providers, [provider.driver]: legacyDefault },
          } as ServerSettingsPatch),
    mutation: { operation: "upsert", instanceId: provider.instanceId, instance },
  };
}

export function withEnvironmentVariable(
  instance: ProviderInstanceConfig,
  variable: ProviderInstanceEnvironmentVariable,
): ProviderInstanceConfig {
  const rest = (instance.environment ?? []).filter((entry) => entry.name !== variable.name);
  return { ...instance, environment: [...rest, variable] };
}

export function withoutEnvironmentVariable(
  instance: ProviderInstanceConfig,
  name: string,
): ProviderInstanceConfig {
  return {
    ...instance,
    environment: (instance.environment ?? []).filter((entry) => entry.name !== name),
  };
}

/** A free instance id for another account of a driver: `codex-2`, `codex-3`, ... */
export function suggestInstanceId(driver: ProviderDriverKind, taken: readonly string[]) {
  for (let index = 2; ; index += 1) {
    const candidate = `${driver}-${index}`.toLowerCase();
    if (!taken.includes(candidate)) return candidate;
  }
}

const isProviderInstanceId = Schema.is(ProviderInstanceId);

export function parseInstanceId(
  value: string,
  taken: readonly string[],
): { readonly id: ProviderInstanceId } | { readonly error: string } {
  const trimmed = value.trim();
  if (!isProviderInstanceId(trimmed))
    return { error: "Use lowercase letters, digits, and dashes, starting with a letter." };
  if (taken.includes(trimmed)) return { error: "That id is already used by another provider." };
  return { id: trimmed };
}

export interface GeneralSetting {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly read: (settings: ServerSettings) => string | boolean;
  readonly patch: (value: string | boolean) => ServerSettingsPatch;
  /** Toggles flip; choices cycle in order; anything else is free text. */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

const toggle = <Key extends keyof ServerSettings & keyof ServerSettingsPatch>(
  key: Key,
  label: string,
  description: string,
): GeneralSetting => ({
  key,
  label,
  description,
  read: (settings) => settings[key] === true,
  patch: (value) => ({ [key]: value === true }) as ServerSettingsPatch,
});

const text = <Key extends keyof ServerSettings & keyof ServerSettingsPatch>(
  key: Key,
  label: string,
  description: string,
): GeneralSetting => ({
  key,
  label,
  description,
  read: (settings) => String(settings[key] ?? ""),
  patch: (value) => ({ [key]: String(value).trim() }) as ServerSettingsPatch,
});

const choice = <Key extends keyof ServerSettings & keyof ServerSettingsPatch>(
  key: Key,
  label: string,
  description: string,
  options: readonly { readonly value: string; readonly label: string }[],
  /** The stored value for the option whose value is "" (a nullable setting's "unset"). */
  empty: null | undefined = undefined,
): GeneralSetting => ({
  key,
  label,
  description,
  options,
  read: (settings) => String(settings[key] ?? ""),
  patch: (value) =>
    ({ [key]: value === "" && empty === null ? null : value }) as ServerSettingsPatch,
});

const labelled = (values: readonly string[], labels: Record<string, string>) =>
  values.map((value) => ({ value, label: labels[value] ?? value }));

/** Environment-wide server settings the TUI edits. Every client of this server shares them. */
export const GENERAL_SETTINGS: readonly GeneralSetting[] = [
  choice(
    "defaultRuntimeMode",
    "Default permissions",
    "What new threads may do without asking.",
    labelled(RuntimeMode.literals, {
      "approval-required": "Ask before changes",
      "auto-accept-edits": "Accept edits",
      auto: "Auto",
      "full-access": "Full access",
    }),
  ),
  choice(
    "defaultThreadEnvMode",
    "New threads run in",
    "Where new threads work by default.",
    [
      { value: "", label: "Ask each time" },
      ...labelled(ThreadEnvMode.literals, { local: "This checkout", worktree: "A new worktree" }),
    ],
    null,
  ),
  toggle(
    "newWorktreesStartFromOrigin",
    "Start worktrees from origin",
    "Fetch and branch new worktrees from the remote's default branch.",
  ),
  text("worktreesDirectory", "Worktrees folder", "Where new worktrees go. Empty uses the T3 home."),
  text("addProjectBaseDirectory", "Projects folder", "Where the new project form starts browsing."),
  choice(
    "responseStreamingMode",
    "Stream replies",
    "Show agent replies paragraph by paragraph, or when the turn ends.",
    labelled(ResponseStreamingMode.literals, { paragraph: "By paragraph", turn: "At turn end" }),
  ),
  choice(
    "branchNamingMode",
    "Branch names",
    "How new worktree branches are named.",
    labelled(BranchNamingMode.literals, {
      static: "Prefix + id",
      semantic: "From the prompt",
      custom: "Custom instructions",
    }),
  ),
  text("branchNamePrefix", "Branch prefix", "Prepended to new branch names, such as t3/."),
  toggle(
    "defaultAutoPull",
    "Pull before new threads",
    "Pull the project before a new thread starts.",
  ),
  toggle(
    "removeAgentCreditsOnMerge",
    "Remove agent credits on merge",
    "Strip agent co-author lines from merged commits.",
  ),
  toggle(
    "sidebarAutoSettleOnMerge",
    "Settle threads on merge",
    "Move a thread out of the inbox when its pull request merges.",
  ),
  toggle(
    "snoozeLimitedThreads",
    "Snooze rate-limited threads",
    "Snooze a thread until its provider's usage limit resets.",
  ),
  toggle(
    "autoResumeLimitedThreads",
    "Resume after rate limits",
    "Continue a rate-limited thread when the limit resets.",
  ),
  toggle(
    "enableProviderUpdateChecks",
    "Check for provider updates",
    "Report when a provider CLI has a newer version.",
  ),
  toggle(
    "enableAgentBrowserAccess",
    "Let agents use the preview browser",
    "Give agents the browser tools. Your own browser panel is unaffected.",
  ),
];

/** The next value for a setting activated with Enter: flip, cycle, or null to edit as text. */
export function nextGeneralValue(setting: GeneralSetting, current: string | boolean) {
  if (typeof current === "boolean") return !current;
  if (!setting.options) return null;
  const index = setting.options.findIndex((option) => option.value === current);
  return setting.options[(index + 1) % setting.options.length]!.value;
}

export function generalValueLabel(setting: GeneralSetting, value: string | boolean) {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return setting.options?.find((option) => option.value === value)?.label ?? (value || "(default)");
}
