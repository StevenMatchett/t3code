import { RegistryContext } from "@effect/atom-react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { GitResolvedPullRequest } from "@t3tools/contracts";
import { useContext, useEffect, useState } from "react";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { openBrowser } from "../platform/browser.ts";
import { Stack, Text } from "../ui/primitives.tsx";
import { inlineTerminalText } from "../ui/textLayout.ts";

export function PullRequestPanel({
  client,
  cwd,
  branch,
  active,
  onClose,
}: {
  readonly client: TuiClient;
  readonly cwd: string;
  readonly branch: string | null;
  readonly active: boolean;
  readonly onClose: () => void;
}) {
  const registry = useContext(RegistryContext);
  const renderer = useRenderer();
  const [request, setRequest] = useState<GitResolvedPullRequest | null>(null);
  const [status, setStatus] = useState("Finding pull request...");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void client
      .resolvePullRequest(registry, { cwd, branch })
      .then(async (pr) => {
        if (cancelled) return;
        const url = new URL(pr.url);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid PR URL.");
        setRequest(pr);
        const opened = await openBrowser(pr.url);
        if (!cancelled)
          setStatus(
            opened
              ? "Opened in your browser."
              : "Open the link below in your local browser, or press C to copy it.",
          );
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setStatus(error instanceof Error ? error.message : "Could not open the pull request.");
      });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The retry counter reruns the same lookup.
  }, [client, registry, cwd, branch, attempt]);
  const copy = () => {
    if (request)
      setStatus(
        renderer.copyToClipboardOSC52(request.url)
          ? "PR URL copied."
          : "Clipboard unavailable; use the link below.",
      );
  };
  useKeyboard((key) => {
    if (!active || key.ctrl || key.meta || key.option) return;
    if (key.name === "escape") onClose();
    else if (key.name === "c") copy();
    else if (key.name === "r" && !key.repeated) {
      setRequest(null);
      setStatus("Finding pull request...");
      setAttempt((value) => value + 1);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  return (
    <Stack flexDirection="column" gap={1}>
      <Text>{inlineTerminalText(status)}</Text>
      {request ? (
        <>
          <Text strong>{`#${request.number} ${inlineTerminalText(request.title)}`}</Text>
          <Text tone="muted">{inlineTerminalText(request.headBranch)}</Text>
          <Text tone="accent">
            <a href={request.url}>{request.url}</a>
          </Text>
          <Text
            tone="accent"
            onMouseDown={(event) => {
              if (event.button === 0) copy();
            }}
          >
            [ Copy PR URL ]
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
