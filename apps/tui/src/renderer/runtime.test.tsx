import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import { useAtomValue } from "@effect/atom-react";
import { type CliRenderer } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, useEffect } from "react";

import { startRendererRuntime } from "./runtime.tsx";

const mutatedGlobalKeys = [
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "window",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

const activeRenderers = new Set<CliRenderer>();
const activeRegistries = new Set<AtomRegistry.AtomRegistry>();
let globalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

beforeEach(() => {
  globalDescriptors = new Map(
    mutatedGlobalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });
});

afterEach(() => {
  for (const renderer of activeRenderers) {
    if (!renderer.isDestroyed) renderer.destroy();
  }
  activeRenderers.clear();

  for (const registry of activeRegistries) registry.dispose();
  activeRegistries.clear();

  for (const [key, descriptor] of globalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }

  vi.restoreAllMocks();
});

function makeRegistry() {
  const registry = AtomRegistry.make();
  activeRegistries.add(registry);
  return registry;
}

async function makeRenderer() {
  const setup = await createTestRenderer({ width: 24, height: 4 });
  activeRenderers.add(setup.renderer);
  return setup;
}

describe("startRendererRuntime", () => {
  it("renders and updates an atom from the supplied registry", async () => {
    const valueAtom = Atom.make("first");
    const registry = makeRegistry();
    const setup = await makeRenderer();

    function Value() {
      return <text>{useAtomValue(valueAtom)}</text>;
    }

    let runtime!: Awaited<ReturnType<typeof startRendererRuntime>>;
    await act(async () => {
      runtime = await startRendererRuntime({
        registry,
        children: <Value />,
        createRenderer: async () => setup.renderer,
      });
    });
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("first");

    await act(async () => {
      registry.set(valueAtom, "second");
    });
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("second");

    await act(async () => {
      await runtime.close();
    });
  });

  it("unmounts effects before registry disposal and keeps close idempotent", async () => {
    const events: string[] = [];
    const registry = makeRegistry();
    const dispose = registry.dispose.bind(registry);
    const disposeSpy = vi.spyOn(registry, "dispose").mockImplementation(() => {
      events.push("registry disposed");
      dispose();
    });
    const setup = await makeRenderer();

    function TrackedValue() {
      useEffect(
        () => () => {
          events.push("effect unmounted");
        },
        [],
      );
      return <text>mounted</text>;
    }

    let runtime!: Awaited<ReturnType<typeof startRendererRuntime>>;
    await act(async () => {
      runtime = await startRendererRuntime({
        registry,
        children: <TrackedValue />,
        createRenderer: async () => setup.renderer,
      });
    });
    await setup.flush();

    await act(async () => setup.renderer.destroy());
    await Promise.resolve();

    expect(events).toEqual(["effect unmounted", "registry disposed"]);
    expect(disposeSpy).toHaveBeenCalledOnce();

    const firstClose = runtime.close();
    const secondClose = runtime.close();
    expect(firstClose).toBe(secondClose);
    await firstClose;
    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it("cleans up when startup fails after creating the renderer", async () => {
    const registry = makeRegistry();
    const disposeSpy = vi.spyOn(registry, "dispose");
    const setup = await makeRenderer();
    const startupError = new Error("root setup failed");
    const eventRenderer = setup.renderer as CliRenderer & {
      once(event: string, listener: () => void): CliRenderer;
    };
    const once = eventRenderer.once.bind(eventRenderer);
    vi.spyOn(eventRenderer, "once")
      .mockImplementationOnce((event, listener) => once(event, listener))
      .mockImplementationOnce(() => {
        throw startupError;
      });

    await expect(
      startRendererRuntime({
        registry,
        children: <text>never mounted</text>,
        createRenderer: async () => setup.renderer,
      }),
    ).rejects.toBe(startupError);

    expect(setup.renderer.isDestroyed).toBe(true);
    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it("closes after a fatal React render error", async () => {
    const registry = makeRegistry();
    const disposeSpy = vi.spyOn(registry, "dispose");
    const setup = await makeRenderer();
    const renderError = new Error("render failed");
    const errors: Error[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    function BrokenValue(): never {
      throw renderError;
    }

    await act(async () => {
      await startRendererRuntime({
        registry,
        children: <BrokenValue />,
        createRenderer: async () => setup.renderer,
        onError: (error) => errors.push(error),
      });
    });
    await Promise.resolve();

    expect(errors).toEqual([renderError]);
    expect(setup.renderer.isDestroyed).toBe(true);
    expect(disposeSpy).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
