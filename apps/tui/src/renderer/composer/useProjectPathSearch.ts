import { RegistryContext } from "@effect/atom-react";
import type { ProjectEntry } from "@t3tools/contracts";
import { useContext, useEffect, useState } from "react";
import type { TuiClient } from "../../connection/clientRuntime.ts";

const SEARCH_DEBOUNCE_MS = 80;
const SEARCH_LIMIT = 20;

/** Project paths for an `@` query. A null query means no search is wanted. */
export function useProjectPathSearch({
  client,
  cwd,
  query,
}: {
  readonly client: TuiClient;
  readonly cwd: string | null;
  readonly query: string | null;
}) {
  const registry = useContext(RegistryContext);
  const [result, setResult] = useState<{
    readonly entries: readonly ProjectEntry[];
    readonly status: string;
  }>({ entries: [], status: "Searching..." });
  useEffect(() => {
    if (query === null || cwd === null) return;
    let cancelled = false;
    // Old results stay until new ones arrive, so the list does not flash on each key.
    setResult((current) => ({ ...current, status: "Searching..." }));
    const search = () =>
      client.searchProjectEntries(registry, { cwd, query, limit: SEARCH_LIMIT }).then(
        ({ entries }) => {
          if (!cancelled) setResult({ entries, status: "No matching files. Esc keeps the text." });
        },
        () => {
          if (!cancelled) setResult({ entries: [], status: "Could not search this project." });
        },
      );
    const debounceMs = client.pathSearchDebounceMs ?? SEARCH_DEBOUNCE_MS;
    if (debounceMs === 0) {
      void search();
      return () => {
        cancelled = true;
      };
    }
    // @effect-diagnostics-next-line globalTimers:off - Debounce tied to this effect's lifetime.
    const timer = setTimeout(() => void search(), debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, registry, cwd, query]);
  return result;
}
