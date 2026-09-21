import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useKeyboard } from "@opentui/react";
import {
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import type { FilesystemBrowseEntry, FilesystemBrowseResult, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { defaultCloneDestination } from "../features/projects/newProject.ts";
import { SelectionRow } from "../ui/SelectionRow.tsx";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";
import { useThemeColor } from "../ui/context.tsx";

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
  const [focus, setFocus] = useState("local");
  const browseGeneration = useRef(0);
  const background = useThemeColor("panel");
  const foreground = useThemeColor("text");
  const selectionColor = useThemeColor("selection");
  const inputColors = {
    ...(background ? { backgroundColor: background, focusedBackgroundColor: background } : {}),
    ...(foreground ? { textColor: foreground, focusedTextColor: foreground } : {}),
  };
  const busy = creation.phase === "creating" || creation.phase === "cloning";
  const created = creation.projectId
    ? (Option.getOrNull(shell.snapshot)?.projects.some(
        (project) => project.id === creation.projectId,
      ) ?? false)
    : false;

  const load = async (nextPath: string) => {
    const normalized = ensureBrowseDirectoryPath(nextPath);
    const generation = ++browseGeneration.current;
    setLoading(true);
    setBrowseError(null);
    try {
      const result = await client.newProjects.browse(registry, normalized);
      if (generation !== browseGeneration.current) return;
      setPath(normalized);
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

  const treeEntries = useMemo<readonly TreeEntry[]>(() => {
    if (!browse) return [];
    const entries: TreeEntry[] = [...browse.entries].sort((a, b) => a.name.localeCompare(b.name));
    const parentPath = getBrowseParentPath(path);
    if (parentPath !== null) entries.unshift({ name: "..", fullPath: parentPath });
    return entries;
  }, [browse, path]);
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
      void load(path);
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

  useKeyboard((key) => {
    if (key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") activate("cancel");
    else if (key.name === "tab") advance(key.shift ? -1 : 1);
    else if (focus === "tree" && (key.name === "up" || key.name === "down"))
      setTreeIndex((index) =>
        Math.max(0, Math.min(treeEntries.length - 1, index + (key.name === "up" ? -1 : 1))),
      );
    else if ((key.name === "return" || key.name === "enter") && !key.repeated) activate(focus);
    else return;
    key.preventDefault();
    key.stopPropagation();
  });

  const button = (id: string, label: string, selected = false) => (
    <Stack
      id={`new-project-${id}`}
      height={1}
      flexGrow={1}
      minWidth={0}
      {...(focus === id && selectionColor ? { backgroundColor: selectionColor } : {})}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activate(id);
      }}
    >
      <Text strong={selected} tone={focus === id || selected ? "accent" : "muted"} truncate>
        {label}
      </Text>
    </Stack>
  );
  const visibleCount = Math.max(1, height - 10);
  const start = Math.max(
    0,
    Math.min(treeIndex - Math.floor(visibleCount / 2), treeEntries.length - visibleCount),
  );
  const message = creation.error ?? browseError;

  return (
    <Stack width="100%" height="100%" flexDirection="column" overflow="hidden" gap={1}>
      <Text height={1} strong>
        Add a project
      </Text>
      <Stack height={1} flexDirection="row" gap={1}>
        {button("local", `${source === "local" ? "[x]" : "[ ]"} Local folder`, source === "local")}
        {button("github", `${source === "github" ? "[x]" : "[ ]"} GitHub URL`, source === "github")}
      </Stack>
      {source === "local" ? (
        <>
          <Stack height={1} flexDirection="row">
            <Text width={8}>Folder</Text>
            <input
              id="new-project-path"
              flexGrow={1}
              minWidth={1}
              value={path}
              focused={!busy && focus === "path"}
              onInput={setPath}
              onMouseDown={() => setFocus("path")}
              {...inputColors}
            />
          </Stack>
          <Text height={1} tone="muted">
            {loading ? "Loading folders..." : "Enter opens a folder · select .. to go up"}
          </Text>
          <Stack flexDirection="column" flexGrow={1} overflow="hidden">
            {treeEntries.length === 0 && !loading ? (
              <Text tone="muted">No child folders. You can still add this folder.</Text>
            ) : (
              treeEntries.slice(start, start + visibleCount).map((entry, offset) => {
                const index = start + offset;
                return (
                  <Stack
                    key={entry.fullPath}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      setTreeIndex(index);
                      setFocus("tree");
                    }}
                  >
                    <SelectionRow
                      label={`${entry.name}/`}
                      selected={index === treeIndex}
                      active={focus === "tree"}
                    />
                  </Stack>
                );
              })
            )}
          </Stack>
          <Stack height={1} flexDirection="row" gap={1}>
            {button("add", busy ? "Adding..." : "[ Add this folder ]")}
            {button("cancel", "[ Cancel ]")}
          </Stack>
        </>
      ) : (
        <>
          <Stack height={1} flexDirection="row">
            <Text width={13}>GitHub URL</Text>
            <input
              id="new-project-url"
              flexGrow={1}
              minWidth={1}
              value={url}
              placeholder="https://github.com/owner/repository"
              focused={!busy && focus === "url"}
              onInput={(value) => {
                setUrl(value);
                if (!destinationEdited)
                  setDestination(defaultCloneDestination(initialDirectory, value));
              }}
              onMouseDown={() => setFocus("url")}
              {...inputColors}
            />
          </Stack>
          <Stack height={1} flexDirection="row">
            <Text width={13}>Destination</Text>
            <input
              id="new-project-destination"
              flexGrow={1}
              minWidth={1}
              value={destination}
              focused={!busy && focus === "destination"}
              onInput={(value) => {
                setDestinationEdited(true);
                setDestination(value);
              }}
              onMouseDown={() => setFocus("destination")}
              {...inputColors}
            />
          </Stack>
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
