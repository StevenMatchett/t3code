import { createContext, useContext, useMemo, type ReactNode } from "react";

import { richTerminalCapabilities, type TerminalCapabilities } from "./capabilities.ts";
import { defaultTheme, resolveThemeColor, type SemanticTheme, type ThemeToken } from "./theme.ts";

interface UiContextValue {
  readonly capabilities: TerminalCapabilities;
  readonly theme: SemanticTheme;
}

const defaultUiContext: UiContextValue = Object.freeze({
  capabilities: richTerminalCapabilities,
  theme: defaultTheme,
});

const UiContext = createContext(defaultUiContext);

export interface UiProviderProps {
  readonly capabilities?: TerminalCapabilities;
  readonly children?: ReactNode;
  readonly theme?: SemanticTheme;
}

export function UiProvider({ capabilities, children, theme }: UiProviderProps) {
  const value = useMemo(
    () => ({
      capabilities: capabilities ?? defaultUiContext.capabilities,
      theme: theme ?? defaultUiContext.theme,
    }),
    [capabilities, theme],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  return useContext(UiContext);
}

export function useThemeColor(token: ThemeToken) {
  const { capabilities, theme } = useUi();
  return resolveThemeColor(theme, token, capabilities);
}
