import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import type { FilesystemBrowseEntry, FilesystemBrowseResult, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { defaultCloneDestination } from "../features/projects/newProject.ts";
import { ListView } from "../ui/ListView.tsx";
import { EmptyState } from "../ui/StateMessage.tsx";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { useKeyLayer } from "../ui/keymap.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { Button } from "../ui/Button.tsx";
import { FormInput, FormRow, ListFilterRow } from "../ui/FormField.tsx";

interface Props {
  readonly client: TuiClient;
  readonly height: number;
  readonly onClose: () => void;
  readonly onCreated: (projectId: ProjectId) => void;
}

type Source = "local" | "github";
type TreeEntry = FilesystemBrowseEntry | { readonly name: ".."; readonly fullPath: string };

export function NewProjectForm({ client, height, onClose, onCreated }: Props) {
  const registry = useContext(RegistryContext);
  const settings = useAtomValue(client.settings);
  const shell = useAtomValue(client.shell);
  const creation = useAtomValue(client.newProjects.state);
  const initialDirectory = ensureBrowseDirectoryPath(
    settings?.addProjectBaseDirectory?.trim() || "~/",
  );
  const [source, setSource] = useState<Source>("local");
  const [path, setPath] = useState(initialDirectory);
  const [browse, setBrowse] = useState<FilesystemBrowseResult | null>(null);
  const [browsedPath, setBrowsedPath] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [treeIndex, setTreeIndex] = useState(0);
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState(initialDirectory);
  const [destinationEdited, setDestinationEdited] = useState(false);
  const [focus, setFocus] = useState("path");
  const browseGeneration = useRef(0);
  const busy = creation.phase === "creating" || creation.phase === "cloning";
  const created = creation.projectId
    ? (Option.getOrNull(shell.snapshot)?.projects.some(
        (project) => project.id === creation.projectId,
      ) ?? false)
    : false;

  const pathEdits = useRef(0);
  const load = async (nextPath: string) => {
    const normalized = ensureBrowseDirectoryPath(nextPath);
    const generation = ++browseGeneration.current;
    const editsAtStart = pathEdits.current;
    setLoading(true);
    setBrowseError(null);
    try {
      const result = await client.newProjects.browse(registry, normalized);
      if (generation !== browseGeneration.current) return;
      // Someone typing while a folder loads keeps what they typed.
      if (pathEdits.current === editsAtStart) setPath(normalized);
      setBrowse(result);
      setBrowsedPath(normalized);
      setTreeIndex(0);
    } catch {
      if (generation === browseGeneration.current) setBrowseError("Could not read that folder.");
    } finally {
      if (generation === browseGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    client.newProjects.reset(registry);
    // oxlint-disable-next-line react/set-state-in-effect -- Opening the modal starts a remote directory read whose pending state is rendered here.
    void load(initialDirectory);
    return () => {
      browseGeneration.current += 1;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The modal's initial directory is a mount-time snapshot; later navigation is explicit.
  }, []);
  useEffect(() => {
    if (!created || !creation.projectId) return;
    onCreated(creation.projectId);
  }, [created, creation.projectId, onCreated]);

  const allTreeEntries = useMemo<readonly TreeEntry[]>(() => {
    if (!browse) return [];
    const entries: TreeEntry[] = [...browse.entries].sort((a, b) => a.name.localeCompare(b.name));
    const parentPath = getBrowseParentPath(path);
    if (parentPath !== null) entries.unshift({ name: "..", fullPath: parentPath });
    return entries;
  }, [browse, path]);
  const [treeFilter, setTreeFilter] = useState<string | null>(null);
  const treeNeedle = treeFilter?.trim().toLocaleLowerCase();
  const treeEntries = treeNeedle
    ? allTreeEntries.filter((entry) => entry.name.toLocaleLowerCase().includes(treeNeedle))
    : allTreeEntries;
  const normalizedPath = ensureBrowseDirectoryPath(path);
  const selectedFolder = browse && browsedPath === normalizedPath ? browse.parentPath : path;
  const localTargets = [
    "local",
    "github",
    "path",
    ...(treeEntries.length ? ["tree"] : []),
    "add",
    "cancel",
  ];
  const githubTargets = ["local", "github", "url", "destination", "clone", "cancel"];
  const targets = source === "local" ? localTargets : githubTargets;
  const advance = (offset: number) => {
    const index = Math.max(0, targets.indexOf(focus));
    setFocus(targets[(index + offset + targets.length) % targets.length]!);
  };
  const chooseSource = (next: Source) => {
    setSource(next);
    setFocus(next === "local" ? "path" : "url");
  };
  const activate = (target: string) => {
    if (busy) return;
    if (target === "local" || target === "github") return chooseSource(target);
    if (target === "cancel") {
      client.newProjects.reset(registry);
      onClose();
      return;
    }
    if (target === "path") {
      // Enter opens a typed folder. Once it is open, Enter adds it.
      if (browse && browsedPath === ensureBrowseDirectoryPath(path) && !loading)
        void client.newProjects.createLocal(registry, selectedFolder);
      else void load(path);
      return;
    }
    if (target === "tree") {
      const entry = treeEntries[treeIndex];
      if (entry) void load(entry.fullPath);
      return;
    }
    if (target === "add") {
      void client.newProjects.createLocal(registry, selectedFolder);
      return;
    }
    if (target === "url") {
      setFocus("destination");
      return;
    }
    if (target === "destination") {
      setFocus("clone");
      return;
    }
    if (target === "clone") void client.newProjects.cloneGitHub(registry, url, destination);
  };

  const movingTree = focus === "tree";
  useKeyLayer("newProject", {
    modal: true,
    typing: treeFilter !== null || (focus !== "tree" && focus !== "local" && focus !== "github"),
    bindings: {
      "newProject.close": () => {
        if (treeFilter !== null) {
          setTreeFilter(null);
          setTreeIndex(0);
        } else activate("cancel");
      },
      "newProject.filter": {
        enabled: movingTree && treeFilter === null,
        run: () => {
          setTreeFilter("");
          setTreeIndex(0);
        },
      },
      "newProject.next": () => advance(1),
      "newProject.previous": () => advance(-1),
      "newProject.treeUp": {
        enabled: movingTree,
        run: () => setTreeIndex((index) => Math.max(0, index - 1)),
      },
      "newProject.treeDown": {
        enabled: movingTree,
        run: () => setTreeIndex((index) => Math.min(treeEntries.length - 1, index + 1)),
      },
      "newProject.activate": () => activate(focus),
    },
  });

  const button = (id: string, label: string, selected = false) => (
    <Button
      id={`new-project-${id}`}
      label={label}
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      focused={focus === id}
      selected={selected}
      onPress={() => activate(id)}
    />
  );
  const visibleCount = Math.max(1, height - 10);
  const message = creation.error ?? browseError;

  return (
    <Stack width="100%" height="100%" flexDirection="column" overflow="hidden">
      <Text height={1} strong>
        Add a project
      </Text>
      <Stack height={1} flexDirection="row" gap={1}>
        {button("local", `${source === "local" ? "[x]" : "[ ]"} Local folder`, source === "local")}
        {button("github", `${source === "github" ? "[x]" : "[ ]"} GitHub URL`, source === "github")}
      </Stack>
      {source === "local" ? (
        <>
          <FormRow label="Folder" labelWidth={8} focused={focus === "path"}>
            <FormInput
              id="new-project-path"
              value={path}
              focused={!busy && focus === "path"}
              onInput={(value) => {
                pathEdits.current += 1;
                setPath(value);
              }}
              onFocusRequest={() => setFocus("path")}
            />
          </FormRow>
          <ListFilterRow
            id="new-project-tree-filter"
            value={treeFilter}
            focused={!busy && focus === "tree"}
            onInput={(value) => {
              setTreeFilter(value);
              setTreeIndex(0);
            }}
          >
            <Text height={1} flexShrink={0} tone="muted">
              {loading
                ? "Loading folders..."
                : focus === "path"
                  ? "Enter adds this folder · Tab browses inside it"
                  : "Enter opens a folder · select .. to go up"}
            </Text>
          </ListFilterRow>
          <ListView
            items={treeEntries}
            selected={treeIndex}
            height={visibleCount}
            showCounter={false}
            itemKey={(entry) => entry.fullPath}
            empty={
              loading ? null : (
                <EmptyState title="No child folders. You can still add this folder." />
              )
            }
            onActivate={(_entry, index) => {
              setTreeIndex(index);
              setFocus("tree");
            }}
            renderItem={(entry, index) => (
              <SelectionRow
                label={`${entry.name}/`}
                selected={index === treeIndex}
                active={focus === "tree"}
              />
            )}
          />
          <Stack height={1} flexDirection="row" gap={1}>
            {button("add", busy ? "Adding..." : "[ Add this folder ]")}
            {button("cancel", "[ Cancel ]")}
          </Stack>
        </>
      ) : (
        <>
          <FormRow label="GitHub URL" labelWidth={13} focused={focus === "url"}>
            <FormInput
              id="new-project-url"
              value={url}
              placeholder="https://github.com/owner/repository"
              focused={!busy && focus === "url"}
              onInput={(value) => {
                setUrl(value);
                if (!destinationEdited)
                  setDestination(defaultCloneDestination(initialDirectory, value));
              }}
              onFocusRequest={() => setFocus("url")}
            />
          </FormRow>
          <FormRow label="Destination" labelWidth={13} focused={focus === "destination"}>
            <FormInput
              id="new-project-destination"
              value={destination}
              focused={!busy && focus === "destination"}
              onInput={(value) => {
                setDestinationEdited(true);
                setDestination(value);
              }}
              onFocusRequest={() => setFocus("destination")}
            />
          </FormRow>
          <Text height={2} tone="muted">
            The connected environment clones the repository. Private repositories use its GitHub
            credentials.
          </Text>
          <Stack flexGrow={1} />
          <Stack height={1} flexDirection="row" gap={1}>
            {button("clone", busy ? "Cloning..." : "[ Clone and add ]")}
            {button("cancel", "[ Cancel ]")}
          </Stack>
        </>
      )}
      <Text
        height={1}
        tone={message ? "danger" : creation.phase === "created" ? "success" : "muted"}
        truncate
      >
        {message ??
          (creation.phase === "created"
            ? "Project added."
            : inlineTerminalText(source === "local" ? selectedFolder : destination))}
      </Text>
    </Stack>
  );
}
