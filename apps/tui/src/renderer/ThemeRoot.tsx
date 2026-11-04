import { CliRenderEvents } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import * as NodeProcess from "node:process";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { UiProvider, useUi } from "../ui/context.tsx";
import { resolveThemeMode, themes, type ThemeMode, type ThemePreference } from "../ui/theme.ts";

interface ThemeControl {
  readonly preference: ThemePreference;
  readonly resolved: ThemeMode;
  /** Shows a theme without saving it; null returns to the saved one. */
  readonly preview: (preference: ThemePreference | null) => void;
  readonly save: (preference: ThemePreference) => void;
}

const ThemeControlContext = createContext<ThemeControl | null>(null);

export function useThemeControl() {
  const control = useContext(ThemeControlContext);
  if (!control) throw new Error("useThemeControl needs a ThemeRoot");
  return control;
}

/** Owns the active theme. The default follows the terminal background when it can be detected. */
export function ThemeRoot({
  client,
  children,
}: {
  readonly client: TuiClient;
  readonly children?: ReactNode;
}) {
  const renderer = useRenderer();
  const { capabilities } = useUi();
  const [preference, setPreference] = useState<ThemePreference>(
    () => client.session?.themePreference() ?? "auto",
  );
  const [previewing, setPreviewing] = useState<ThemePreference | null>(null);
  const [detected, setDetected] = useState<ThemeMode | null>(renderer.themeMode);
  useEffect(() => {
    const onChange = (mode: ThemeMode) => setDetected(mode);
    renderer.on(CliRenderEvents.THEME_MODE, onChange);
    void renderer.waitForThemeMode(200).then((mode) => {
      if (mode) setDetected(mode);
    });
    return () => {
      renderer.off(CliRenderEvents.THEME_MODE, onChange);
    };
  }, [renderer]);
  const resolved = resolveThemeMode(previewing ?? preference, detected, NodeProcess.env.COLORFGBG);
  const control = useMemo<ThemeControl>(
    () => ({
      preference,
      resolved,
      preview: setPreviewing,
      save: (next) => {
        setPreference(next);
        setPreviewing(null);
        client.session?.saveThemePreference(next);
      },
    }),
    [client, preference, resolved],
  );
  return (
    <ThemeControlContext.Provider value={control}>
      <UiProvider capabilities={capabilities} theme={themes[resolved]}>
        {children}
      </UiProvider>
    </ThemeControlContext.Provider>
  );
}
