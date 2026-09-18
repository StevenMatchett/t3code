import { RegistryContext } from "@effect/atom-react";
import {
  CliRenderEvents,
  createCliRenderer,
  type CliRenderer,
  type CliRendererErrorEvent,
} from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";

export interface RendererRuntimeOptions {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly children: ReactNode;
  readonly createRenderer?: () => Promise<CliRenderer>;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

export interface RendererRuntime {
  readonly renderer: CliRenderer;
  readonly close: () => Promise<void>;
}

interface FatalErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onError: (error: Error, info: ErrorInfo) => void;
}

interface DestroyEventRenderer extends CliRenderer {
  once(event: CliRenderEvents.DESTROY, listener: () => void): this;
}

interface RegistryLifetimeProps {
  readonly onMount: () => void;
  readonly onUnmount: () => void;
}

function RegistryLifetime({ onMount, onUnmount }: RegistryLifetimeProps) {
  useEffect(() => {
    onMount();
    return onUnmount;
  }, [onMount, onUnmount]);
  return null;
}

class FatalErrorBoundary extends Component<FatalErrorBoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Takes ownership of the supplied registry until the renderer is destroyed. */
export async function startRendererRuntime(
  options: RendererRuntimeOptions,
): Promise<RendererRuntime> {
  let renderer: CliRenderer | undefined;
  let root: Root | undefined;
  let registryLifetimeMounted = false;
  let registryDisposed = false;
  let closePromise: Promise<void> | undefined;
  let rendererDestroyed: Promise<void> | undefined;
  let fatalErrorReported = false;

  const disposeRegistry = () => {
    if (registryDisposed) return;
    registryDisposed = true;
    options.registry.dispose();
  };

  const unmount = () => {
    root?.unmount();
    root = undefined;
    queueMicrotask(() => {
      if (!registryLifetimeMounted) disposeRegistry();
    });
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;

    closePromise = (async () => {
      if (renderer && !renderer.isDestroyed) {
        renderer.destroy();
      }

      // OpenTUI defers final destruction when close is requested during a frame.
      await rendererDestroyed;
      if (!registryLifetimeMounted) disposeRegistry();
    })();
    return closePromise;
  };

  const onFatalError = (error: Error, info: ErrorInfo) => {
    if (fatalErrorReported) return;
    fatalErrorReported = true;
    const report = (failure: Error) => {
      if (options.onError) {
        options.onError(failure, info);
      } else {
        process.stderr.write(`${failure.stack ?? failure.message}\n`);
      }
    };
    queueMicrotask(() => {
      void close().then(
        () => report(error),
        (cleanupError: unknown) =>
          report(new AggregateError([error, cleanupError], "Renderer cleanup failed")),
      );
    });
  };

  try {
    renderer = await (options.createRenderer ?? createCliRenderer)();
    root = createRoot(renderer);
    const destroyed = Promise.withResolvers<void>();
    (renderer as DestroyEventRenderer).once(CliRenderEvents.DESTROY, destroyed.resolve);
    rendererDestroyed = destroyed.promise;

    // createRoot registers its destroy listener first. RegistryLifetime is the
    // last child so its passive cleanup runs after the caller's effects.
    (renderer as DestroyEventRenderer).once(CliRenderEvents.DESTROY, unmount);
    renderer.once(CliRenderEvents.RENDER_ERROR, ({ error }: CliRendererErrorEvent) =>
      onFatalError(error, { componentStack: null }),
    );
    root.render(
      <FatalErrorBoundary onError={onFatalError}>
        <RegistryContext.Provider value={options.registry}>
          {options.children}
          <RegistryLifetime
            onMount={() => {
              registryLifetimeMounted = true;
            }}
            onUnmount={disposeRegistry}
          />
        </RegistryContext.Provider>
      </FatalErrorBoundary>,
    );

    return { renderer, close };
  } catch (startError) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [startError, cleanupError],
        "Renderer runtime failed to start and clean up",
        { cause: cleanupError },
      );
    }
    throw startError;
  }
}
