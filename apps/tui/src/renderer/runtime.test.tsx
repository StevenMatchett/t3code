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

  it("waits for an active frame to finish before resolving close", async () => {
    const registry = makeRegistry();
    const setup = await makeRenderer();
    let runtime!: Awaited<ReturnType<typeof startRendererRuntime>>;
    await act(async () => {
      runtime = await startRendererRuntime({
        registry,
        children: <text>frame</text>,
        createRenderer: async () => setup.renderer,
      });
    });
    await setup.flush();

    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const frame = async () => {
      entered.resolve();
      await release.promise;
    };
    setup.renderer.setFrameCallback(frame);
    setup.renderer.requestRender();
    const flushing = setup.flush();
    await entered.promise;
    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    try {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      release.resolve();
      await act(async () => {
        await flushing;
        await closing;
      });
    }
    expect(closed).toBe(true);
    expect(registry.getNodes().size).toBe(0);
  });

  it("restores the terminal after a native render pass fails", async () => {
    const registry = makeRegistry();
    const setup = await makeRenderer();
    const nativeError = new Error("native frame failed");
    const errors: Error[] = [];
    const fail = vi.fn(() => {
      throw nativeError;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      await startRendererRuntime({
        registry,
        children: <text>native frame</text>,
        createRenderer: async () => setup.renderer,
        onError: (error) => errors.push(error),
      });
    });
    await setup.flush();
    vi.spyOn(setup.renderer.root, "render").mockImplementationOnce(fail);
    setup.renderer.requestRender();
    await act(async () => {
      await setup.flush();
    });
    expect(fail).toHaveBeenCalledOnce();
    expect(errors).toEqual([nativeError]);
    expect(setup.renderer.isDestroyed).toBe(true);
    expect(registry.getNodes().size).toBe(0);
  });

  it("releases atom listeners and effects across 100 mount/unmount cycles", async () => {
    const valueAtom = Atom.make("live");
    let mounted = 0;
    function Value() {
      const value = useAtomValue(valueAtom);
      useEffect(() => {
        mounted += 1;
        return () => {
          mounted -= 1;
        };
      }, []);
      return <text>{value}</text>;
    }
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const registry = makeRegistry();
      const setup = await makeRenderer();
      let runtime!: Awaited<ReturnType<typeof startRendererRuntime>>;
      await act(async () => {
        runtime = await startRendererRuntime({
          registry,
          children: <Value />,
          createRenderer: async () => setup.renderer,
        });
      });
      await setup.flush();
      const node = registry.getNodes().get(valueAtom)!;
      expect(node.listeners.size).toBeGreaterThan(0);
      expect(mounted).toBe(1);
      await act(async () => {
        registry.set(valueAtom, `cycle ${cycle}`);
      });
      await setup.flush();
      expect(setup.captureCharFrame()).toContain(`cycle ${cycle}`);
      await act(async () => {
        await runtime.close();
      });
      expect(node.listeners.size).toBe(0);
      expect(registry.getNodes().size).toBe(0);
      expect(mounted).toBe(0);
      activeRenderers.delete(setup.renderer);
      activeRegistries.delete(registry);
    }
  });

  it("closes after a fatal React render error", async () => {
    const registry = makeRegistry();
    const disposeSpy = vi.spyOn(registry, "dispose");
    const setup = await makeRenderer();
    const renderError = new Error("render failed");
    const errors: Error[] = [];
    const destroyedWhenReported: boolean[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    function BrokenValue(): never {
      throw renderError;
    }

    await act(async () => {
      await startRendererRuntime({
        registry,
        children: <BrokenValue />,
        createRenderer: async () => setup.renderer,
        onError: (error) => {
          destroyedWhenReported.push(setup.renderer.isDestroyed);
          errors.push(error);
        },
      });
    });
    await Promise.resolve();

    expect(errors).toEqual([renderError]);
    expect(destroyedWhenReported).toEqual([true]);
    expect(setup.renderer.isDestroyed).toBe(true);
    expect(disposeSpy).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
