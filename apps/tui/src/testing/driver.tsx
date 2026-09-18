import { CliRenderEvents, type CliRenderer } from "@opentui/core";
import {
  createTestRenderer,
  type KeyInput,
  type MockInput,
  type MockMouse,
  type TestRendererSetup,
} from "@opentui/core/testing";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, type ErrorInfo, type ReactNode } from "react";

import { startRendererRuntime } from "../renderer/runtime.tsx";
import { normalizeFrame, type FrameReplacement } from "./frame.ts";

type KeyModifiers = Parameters<MockInput["pressKey"]>[1];

export interface TuiTestInput {
  readonly pressKey: (key: KeyInput, modifiers?: KeyModifiers) => Promise<void>;
  readonly typeText: (text: string) => Promise<void>;
  readonly paste: (text: string) => Promise<void>;
}

export interface TuiTestMouse {
  readonly moveTo: (...args: Parameters<MockMouse["moveTo"]>) => Promise<void>;
  readonly click: (...args: Parameters<MockMouse["click"]>) => Promise<void>;
  readonly doubleClick: (...args: Parameters<MockMouse["doubleClick"]>) => Promise<void>;
  readonly pressDown: (...args: Parameters<MockMouse["pressDown"]>) => Promise<void>;
  readonly release: (...args: Parameters<MockMouse["release"]>) => Promise<void>;
  readonly drag: (...args: Parameters<MockMouse["drag"]>) => Promise<void>;
  readonly scroll: (...args: Parameters<MockMouse["scroll"]>) => Promise<void>;
}

export interface TuiTestDriverOptions {
  readonly width?: number;
  readonly height?: number;
  readonly registry?: AtomRegistry.AtomRegistry;
  readonly frameReplacements?: readonly FrameReplacement[];
  readonly kittyKeyboard?: boolean;
  readonly otherModifiersMode?: boolean;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

export interface TuiTestDriver {
  readonly renderer: CliRenderer;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly input: TuiTestInput;
  readonly mouse: TuiTestMouse;
  readonly flush: () => Promise<void>;
  readonly resize: (width: number, height: number) => Promise<void>;
  readonly captureRawFrame: () => string;
  readonly captureFrame: (replacements?: readonly FrameReplacement[]) => string;
  readonly close: () => Promise<void>;
}

type ReactActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

let reactActEnvironmentLeases = 0;
let originalReactActEnvironment: PropertyDescriptor | undefined;

function acquireReactActEnvironment() {
  const global = globalThis as ReactActEnvironment;
  if (reactActEnvironmentLeases === 0) {
    originalReactActEnvironment = Object.getOwnPropertyDescriptor(
      globalThis,
      "IS_REACT_ACT_ENVIRONMENT",
    );
    Object.defineProperty(global, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
      writable: true,
    });
  }
  reactActEnvironmentLeases += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    reactActEnvironmentLeases -= 1;
    if (reactActEnvironmentLeases !== 0) return;

    if (originalReactActEnvironment) {
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalReactActEnvironment);
    } else {
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
    originalReactActEnvironment = undefined;
  };
}

function makeSettler(setup: TestRendererSetup) {
  return async (action: () => Promise<unknown> | unknown) => {
    if (setup.renderer.isDestroyed) {
      throw new Error("TUI test driver is closed");
    }
    await act(async () => {
      await action();
    });
    await setup.flush();
  };
}

export async function createTuiTestDriver(
  children: ReactNode,
  options: TuiTestDriverOptions = {},
): Promise<TuiTestDriver> {
  const releaseReactActEnvironment = acquireReactActEnvironment();
  let setup: TestRendererSetup | undefined;

  try {
    const rendererSetup = await createTestRenderer({
      width: options.width ?? 80,
      height: options.height ?? 24,
      exitOnCtrlC: false,
      clearOnShutdown: false,
      kittyKeyboard: options.kittyKeyboard ?? false,
      otherModifiersMode: options.otherModifiersMode ?? false,
    });
    setup = rendererSetup;

    const registry = options.registry ?? AtomRegistry.make();
    const defaultFrameReplacements = [...(options.frameReplacements ?? [])];
    let runtime!: Awaited<ReturnType<typeof startRendererRuntime>>;
    await act(async () => {
      runtime = await startRendererRuntime({
        registry,
        children,
        createRenderer: async () => rendererSetup.renderer,
        ...(options.onError ? { onError: options.onError } : {}),
      });
    });
    await rendererSetup.flush();

    const settle = makeSettler(rendererSetup);
    let closePromise: Promise<void> | undefined;
    const close = () => {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        try {
          await act(async () => {
            await runtime.close();
          });
        } finally {
          releaseReactActEnvironment();
        }
      })();
      return closePromise;
    };

    const input: TuiTestInput = {
      pressKey: (key, modifiers) =>
        settle(async () => {
          if (key !== "ESCAPE" || options.kittyKeyboard) {
            rendererSetup.mockInput.pressKey(key, modifiers);
            return;
          }
          const parsed = Promise.withResolvers<void>();
          const onKey = () => parsed.resolve();
          const onDestroy = () => parsed.reject(new Error("Renderer closed before parsing Escape"));
          rendererSetup.renderer.keyInput.prependOnceListener("keypress", onKey);
          rendererSetup.renderer.once(CliRenderEvents.DESTROY, onDestroy);
          try {
            rendererSetup.mockInput.pressKey(key, modifiers);
            await parsed.promise;
          } finally {
            rendererSetup.renderer.keyInput.off("keypress", onKey);
            rendererSetup.renderer.off(CliRenderEvents.DESTROY, onDestroy);
          }
        }),
      typeText: (text) => settle(() => rendererSetup.mockInput.typeText(text)),
      paste: (text) => settle(() => rendererSetup.mockInput.pasteBracketedText(text)),
    };
    const mouse: TuiTestMouse = {
      moveTo: (...args) => settle(() => rendererSetup.mockMouse.moveTo(...args)),
      click: (...args) => settle(() => rendererSetup.mockMouse.click(...args)),
      doubleClick: (...args) => settle(() => rendererSetup.mockMouse.doubleClick(...args)),
      pressDown: (...args) => settle(() => rendererSetup.mockMouse.pressDown(...args)),
      release: (...args) => settle(() => rendererSetup.mockMouse.release(...args)),
      drag: (...args) => settle(() => rendererSetup.mockMouse.drag(...args)),
      scroll: (...args) => settle(() => rendererSetup.mockMouse.scroll(...args)),
    };

    return {
      renderer: runtime.renderer,
      registry,
      input,
      mouse,
      flush: () => settle(() => undefined),
      resize: (width, height) => settle(() => rendererSetup.resize(width, height)),
      captureRawFrame: rendererSetup.captureCharFrame,
      captureFrame: (replacements = []) =>
        normalizeFrame(rendererSetup.captureCharFrame(), [
          ...defaultFrameReplacements,
          ...replacements,
        ]),
      close,
    };
  } catch (error) {
    if (setup && !setup.renderer.isDestroyed) setup.renderer.destroy();
    releaseReactActEnvironment();
    throw error;
  }
}
