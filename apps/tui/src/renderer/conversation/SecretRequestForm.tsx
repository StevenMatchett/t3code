import { RegistryContext } from "@effect/atom-react";
import { decodePasteBytes } from "@opentui/core";
import { usePaste } from "@opentui/react";
import {
  SECRET_REQUEST_DEFAULT_PLACEHOLDER,
  SECRET_REQUEST_PRIVACY_NOTE,
  secretRequestAnswerInput,
  secretRequestFailureMessage,
} from "@t3tools/client-runtime/secret-request";
import { useContext, useState } from "react";
import type { TuiClient } from "../../connection/clientRuntime.ts";
import type { TuiSecretRequest } from "../../connection/models.ts";
import { useUi } from "../../ui/context.tsx";
import { useKeyLayer } from "../../ui/keymap.ts";
import { Stack, Text } from "../../ui/primitives.tsx";
import { wrapTerminalWords } from "../../ui/textLayout.ts";

/**
 * Asks for a secret the agent needs. The value stays in this component's state: it never reaches
 * the draft, the saved session, or a frame, and only its length is drawn.
 */
export function SecretRequestForm({
  request,
  client,
  active,
  width,
  height,
  onBack,
}: {
  readonly request: TuiSecretRequest;
  readonly client: TuiClient;
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
  readonly onBack: () => void;
}) {
  const registry = useContext(RegistryContext);
  const { capabilities } = useUi();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = (answerValue: Parameters<typeof secretRequestAnswerInput>[1]) => {
    const input = secretRequestAnswerInput(request, answerValue);
    if (!input || sending) return;
    setSending(true);
    setError(null);
    client.answerSecretRequest(registry, input).then(
      () => setValue(""),
      (failure: unknown) => {
        setSending(false);
        setError(secretRequestFailureMessage(failure));
      },
    );
  };
  const canSave = !sending && value.trim().length > 0;
  usePaste((event) => {
    if (!active || sending) return;
    event.preventDefault();
    event.stopPropagation();
    setValue((current) => current + decodePasteBytes(event.bytes).replace(/[\r\n]+$/u, ""));
  });
  useKeyLayer("secret", {
    active,
    typing: true,
    raw: (key) => {
      if (sending) return false;
      if (key.name === "backspace") {
        setValue((current) => current.slice(0, -1));
        return true;
      }
      if (key.ctrl && key.name === "u") {
        setValue("");
        return true;
      }
      if (key.ctrl || key.meta || key.name === "return" || key.name === "escape") return false;
      const text = key.sequence;
      const isControl = [...text].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      });
      if (text.length === 0 || isControl) return false;
      setValue((current) => current + text);
      return true;
    },
    bindings: {
      "secret.save": {
        enabled: canSave,
        run: () => answer({ type: "save", secret: value }),
      },
      "secret.decline": {
        enabled: !sending,
        run: () => answer({ type: "decline" }),
      },
      "secret.back": onBack,
    },
  });
  const lines = wrapTerminalWords(request.reason, width);
  const reasonRows = Math.max(0, height - 3);
  const mask = (capabilities.unicode ? "•" : "*").repeat(Math.min(value.length, width - 3));
  const cursor = active && !sending ? (capabilities.unicode ? "█" : "_") : "";
  return (
    <Stack flexDirection="column" height="100%" overflow="hidden">
      {reasonRows > 0 ? (
        <Text height={reasonRows} flexShrink={0} wrapMode="none">
          {lines.slice(0, reasonRows).join("\n")}
        </Text>
      ) : null}
      <Text
        height={1}
        flexShrink={0}
        wrapMode="none"
        truncate
        {...(value ? {} : { tone: "muted" })}
      >
        {`> ${mask}${cursor}${value ? "" : (request.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER)}`}
      </Text>
      <Text height={1} flexShrink={0} wrapMode="none" truncate tone="muted">
        {SECRET_REQUEST_PRIVACY_NOTE}
      </Text>
      <Text height={1} flexShrink={0} wrapMode="none" truncate tone={error ? "danger" : "muted"}>
        {error ?? (sending ? "Sending..." : "")}
      </Text>
    </Stack>
  );
}
