import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  type ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { ConnectionBlockedError } from "@t3tools/client-runtime/connection";

export const tuiProtocolVersion = (
  descriptor: Pick<ExecutionEnvironmentDescriptor, "orchestrationProtocolVersion">,
) => descriptor.orchestrationProtocolVersion ?? 1;

export function tuiProtocolCompatibilityError(descriptor: ExecutionEnvironmentDescriptor) {
  const version = tuiProtocolVersion(descriptor);
  return version === 1 || version === 2
    ? null
    : new ConnectionBlockedError({
        reason: "unsupported",
        detail: `This TUI supports server protocols 1 and 2; ${descriptor.label} uses ${version}. Update the TUI to connect.`,
      });
}

export function appendTuiProtocol(socketUrl: string, version: number) {
  const url = new URL(socketUrl);
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(version));
  return url.toString();
}
