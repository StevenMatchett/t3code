import {
  WsRpcGroup,
  WS_METHODS,
  ServerConfig,
  ServerConfigStreamEvent,
  WsSubscribeServerConfigRpc,
  KeybindingsConfigError,
  ServerSettingsError,
  EnvironmentAuthorizationError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { Rpc, RpcClient, RpcGroup } from "effect/rpc";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function normalizeSettings(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    ...(value.responseStreamingMode === "token" ? { responseStreamingMode: "paragraph" } : {}),
    ...(isRecord(value.projectSettingsOverrides)
      ? {
          projectSettingsOverrides: Object.fromEntries(
            Object.entries(value.projectSettingsOverrides).map(([key, settings]) => [
              key,
              normalizeSettings(settings),
            ]),
          ),
        }
      : {}),
  };
}
// V1's token mode disappeared in V2. The TUI renders streamed messages itself.
export function normalizeV1Config(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    ...("settings" in value ? { settings: normalizeSettings(value.settings) } : {}),
    ...("config" in value ? { config: normalizeV1Config(value.config) } : {}),
    ...(value.type === "settingsUpdated" ? { payload: normalizeV1Config(value.payload) } : {}),
  };
}
const normalized = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform({ decode: normalizeV1Config, encode: (value) => value }),
  ),
);
const config = normalized.pipe(Schema.decodeTo(ServerConfig));
const configStream = normalized.pipe(Schema.decodeTo(ServerConfigStreamEvent));
const overrides = RpcGroup.make(
  Rpc.make(WS_METHODS.serverGetConfig, {
    payload: Schema.Struct({}),
    success: config,
    error: Schema.Union([
      KeybindingsConfigError,
      ServerSettingsError,
      EnvironmentAuthorizationError,
    ]),
  }),
  Rpc.make(WS_METHODS.subscribeServerConfig, {
    payload: WsSubscribeServerConfigRpc.payloadSchema,
    success: configStream,
    error: WsSubscribeServerConfigRpc.errorSchema,
    stream: true,
  }),
);
export const makeV1CommonClient = RpcClient.make(
  WsRpcGroup.omit(WS_METHODS.serverGetConfig, WS_METHODS.subscribeServerConfig).merge(overrides),
);
