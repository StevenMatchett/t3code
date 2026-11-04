import { RegistryContext } from "@effect/atom-react";
import { deriveLocalBranchNameFromRemoteRef } from "@t3tools/shared/git";
import type { ThreadId, VcsRef } from "@t3tools/contracts";
import { useContext, useEffect, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { CommandPalette } from "./CommandPalette.tsx";

const CREATE_PREFIX = "create:";

/** Finds a branch and switches to it. A name that matches nothing can be created instead. */
export function GitBranchPicker({
  client,
  cwd,
  threadId,
  active,
  height,
  onClose,
}: {
  readonly client: TuiClient;
  readonly cwd: string;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly height: number;
  readonly onClose: () => void;
}) {
  const registry = useContext(RegistryContext);
  const [refs, setRefs] = useState<readonly VcsRef[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    client.git?.listRefs(registry, cwd).then(
      (next) => {
        if (!cancelled) setRefs(next);
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not list.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, registry, cwd]);
  const settle = async (change: () => Promise<string | null | undefined>) => {
    setBusy(true);
    setError(null);
    try {
      const branch = await change();
      if (branch) await client.threadManagement.setBranch(registry, threadId, branch);
      onClose();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Error ? failure.message : "Could not switch branch.");
    }
  };
  const choose = (id: string) => {
    const git = client.git;
    if (busy || !git) return;
    if (id.startsWith(CREATE_PREFIX)) {
      const refName = id.slice(CREATE_PREFIX.length);
      void settle(() => git.createRef(registry, { cwd, refName }));
      return;
    }
    const ref = refs?.find((item) => item.name === id);
    if (!ref) return;
    if (ref.current) {
      onClose();
      return;
    }
    if (ref.worktreePath && ref.worktreePath !== cwd) {
      setError(`${ref.name} is checked out in ${ref.worktreePath}.`);
      return;
    }
    void settle(async () => {
      const switched = await git.switchRef(registry, { cwd, refName: ref.name });
      return switched ?? (ref.isRemote ? deriveLocalBranchNameFromRemoteRef(ref.name) : ref.name);
    });
  };
  const trimmed = query.trim();
  const exists = refs?.some((ref) => ref.name === trimmed);
  const items = [
    ...(refs ?? []).map((ref) => ({
      id: ref.name,
      label: ref.name,
      detail: [
        ...(ref.current ? ["Current"] : []),
        ...(ref.isDefault ? ["Default"] : []),
        ...(ref.isRemote ? ["Remote"] : []),
        ...(ref.worktreePath && ref.worktreePath !== cwd ? ["In another worktree"] : []),
      ].join(" · "),
      rank: ref.current ? 2 : ref.isDefault ? 1 : 0,
    })),
    ...(trimmed && !exists
      ? [
          {
            id: `${CREATE_PREFIX}${trimmed}`,
            label: `Create branch ${trimmed}`,
            detail: "New branch from the current one",
            rank: -1,
          },
        ]
      : []),
  ];
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      <CommandPalette
        items={items}
        height={Math.max(1, height - 1)}
        active={active}
        searching={refs === null}
        searchFailed={false}
        searchedQuery={query}
        searchDebounceMs={0}
        onSearchQueryChange={setQuery}
        onChoose={choose}
        onClose={onClose}
      />
      <Text height={1} flexShrink={0} wrapMode="none" truncate tone={error ? "danger" : "muted"}>
        {error ?? (busy ? "Switching..." : refs === null ? "Loading branches..." : "")}
      </Text>
    </Stack>
  );
}
