import type {
  ModelSelection,
  OrchestrationThread,
  ServerProvider,
  ServerProviderSkill,
} from "@t3tools/contracts";
import {
  getProviderSkillsForSlashMenu,
  resolveProviderSkillSourceKind,
  resolveProviderSkillsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";

export interface ProviderCatalog {
  readonly providers: readonly ServerProvider[];
  readonly status: "loading" | "live" | "error";
}

export function selectableSkills(provider: ServerProvider, cwd: string | null) {
  const root = cwd?.replaceAll("\\", "/").replace(/\/+$/, "");
  const rank = (skill: ServerProviderSkill) => {
    const source = resolveProviderSkillSourceKind(skill);
    const path = skill.path.replaceAll("\\", "/");
    const inWorkspace = root !== undefined && path.startsWith(`${root}/`);
    return source === "repo" || source === "project" || inWorkspace ? 0 : 1;
  };
  // Rank before name deduplication so a global entry cannot hide a repo skill.
  return getProviderSkillsForSlashMenu(
    resolveProviderSkillsForCwd(provider, cwd).toSorted((left, right) => rank(left) - rank(right)),
    true,
  );
}

export function skillPrefix(provider: ServerProvider, skill: ServerProviderSkill) {
  return `${provider.driver === "claudeAgent" || provider.driver === "cursor" ? "/" : "$"}${skill.name} `;
}

export function modelChangeProblem(
  thread: OrchestrationThread,
  provider: ServerProvider | undefined,
  next: ModelSelection,
): string | null {
  if (
    !provider ||
    !provider.enabled ||
    !provider.installed ||
    provider.availability === "unavailable" ||
    provider.status === "error" ||
    provider.auth.status === "unauthenticated"
  )
    return "This provider is unavailable. Configure it in T3 settings.";
  if (
    next.instanceId !== thread.modelSelection.instanceId ||
    next.instanceId !== provider.instanceId
  )
    return "Changing provider accounts is not supported in this picker. Use a separate T3 thread.";
  if (!provider.models.some((model) => model.slug === next.model))
    return "That model is no longer advertised by this provider.";
  if (thread.latestTurn?.state === "running" || thread.session?.status === "starting")
    return "Wait for the current turn to finish, or stop it before changing models.";
  if (
    provider.requiresNewThreadForModelChange &&
    (thread.session !== null ||
      thread.latestTurn !== null ||
      thread.messages.some((message) => message.role === "user")) &&
    next.model !== thread.modelSelection.model
  )
    return "This provider requires a new thread to change models after a conversation starts.";
  return null;
}

export function selectionForModel(
  provider: ServerProvider,
  slug: string,
  previous: ModelSelection,
): ModelSelection {
  if (previous.instanceId === provider.instanceId && previous.model === slug) return previous;
  const model = provider.models.find((item) => item.slug === slug);
  const descriptors = getProviderOptionDescriptors({
    caps: model?.capabilities ?? {},
    selections: previous.instanceId === provider.instanceId ? previous.options : undefined,
  });
  const options = buildExplicitProviderOptionSelectionsFromDescriptors(
    descriptors,
    previous.options,
  );
  return { instanceId: provider.instanceId, model: slug, ...(options ? { options } : {}) };
}

export function modelOptionsAreValid(provider: ServerProvider, selection: ModelSelection): boolean {
  const descriptors =
    provider.models.find((model) => model.slug === selection.model)?.capabilities
      ?.optionDescriptors ?? [];
  return (selection.options ?? []).every((option) => {
    const descriptor = descriptors.find((entry) => entry.id === option.id);
    return descriptor?.type === "boolean"
      ? typeof option.value === "boolean"
      : descriptor?.options.some((choice) => choice.id === option.value) === true;
  });
}
