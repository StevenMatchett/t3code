import type { ServerProvider } from "@t3tools/contracts";
import { planModeProblem } from "./composerModes.ts";

export type ComposerCommand = { readonly name: string; readonly detail: string } & (
  | { readonly kind: "model" }
  | { readonly kind: "mode"; readonly mode: "plan" | "default" }
  /** Runs right away as its own turn. */
  | { readonly kind: "run" }
  /** Goes into the draft, because the provider's command may take arguments. */
  | { readonly kind: "text" }
);

/** The `/` commands to offer: the app's own, then the provider's, without repeats. */
export function composerCommands(provider: ServerProvider | undefined): readonly ComposerCommand[] {
  const own: ComposerCommand[] = [
    { name: "model", kind: "model", detail: "Choose the model." },
    ...(planModeProblem(provider)
      ? []
      : [
          {
            name: "plan",
            kind: "mode",
            mode: "plan",
            detail: "Plan the work before making changes.",
          } as const,
        ]),
    { name: "default", kind: "mode", mode: "default", detail: "Work on the task normally." },
  ];
  const names = new Set(own.map((command) => command.name));
  const fromProvider = (provider?.slashCommands ?? []).flatMap((command): ComposerCommand[] => {
    if (names.has(command.name)) return [];
    names.add(command.name);
    return [
      {
        name: command.name,
        // /compact takes no arguments and is what the context meter offers in the GUI.
        kind: command.name === "compact" ? "run" : "text",
        detail: command.description ?? "Provider command.",
      },
    ];
  });
  return [...own, ...fromProvider];
}
