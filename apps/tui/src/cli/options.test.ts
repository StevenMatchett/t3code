import { describe, expect, it } from "@effect/vitest";

import {
  buildTuiLaunchOptions,
  DEFAULT_TUI_PORT,
  parseTuiCliArgs,
  TuiCliUsageError,
} from "./options.ts";

const context = { cwd: "/work/repository", homeDir: "/users/tui" };

describe("TUI CLI options", () => {
  it("uses a TUI-only state directory and current working directory by default", () => {
    expect(parseTuiCliArgs([], context)).toEqual({
      action: "run",
      options: {
        stateDir: "/users/tui/.t3-tui",
        cwd: "/work/repository",
        port: DEFAULT_TUI_PORT,
      },
    });
  });

  it("resolves explicit paths and accepts equals-style flags", () => {
    expect(
      parseTuiCliArgs(["--state-dir=./state", "--cwd", "~/projects/demo", "--port=43111"], context),
    ).toEqual({
      action: "run",
      options: {
        stateDir: "/work/repository/state",
        cwd: "/users/tui/projects/demo",
        port: 43_111,
      },
    });
  });

  it("accepts a package-runner argument separator", () => {
    expect(parseTuiCliArgs(["--", "--port", "43110"], context)).toMatchObject({
      action: "run",
      options: { port: 43_110 },
    });
  });

  it.each([
    ["help", ["--help"], { action: "help" }],
    ["short help", ["-h"], { action: "help" }],
    ["version", ["--version"], { action: "version" }],
    ["short version", ["-v"], { action: "version" }],
  ] as const)("returns the %s action", (_label, argv, expected) => {
    expect(parseTuiCliArgs(argv, context)).toEqual(expected);
  });

  it.each([
    [["--port", "0"], /between 1 and 65535/u],
    [["--port", "65536"], /between 1 and 65535/u],
    [["--port", "abc"], /between 1 and 65535/u],
    [["--cwd"], /requires a value/u],
    [["--cwd", "a", "--cwd", "b"], /only be supplied once/u],
    [["project"], /Unknown argument/u],
  ] as const)("rejects invalid arguments %j", (argv, message) => {
    expect(() => parseTuiCliArgs(argv, context)).toThrow(message);
  });

  it.each(["~/.t3", "~/.t3/userdata", "~/.t3/userdata/test"])(
    "refuses the live state location %s",
    (stateDir) => {
      expect(() => parseTuiCliArgs(["--state-dir", stateDir], context)).toThrow(TuiCliUsageError);
    },
  );

  it("attaches to existing environments unless a separate environment is explicit", () => {
    expect(parseTuiCliArgs([], context)).toMatchObject({ action: "run", options: {} });
    expect(parseTuiCliArgs(["--connect", "http://127.0.0.1:43110/"], context)).toMatchObject({
      options: { connect: "http://127.0.0.1:43110" },
    });
    expect(parseTuiCliArgs(["--new-environment"], context)).toMatchObject({
      options: { newEnvironment: true },
    });
    expect(
      parseTuiCliArgs(["--connect", "http://127.0.0.1:43110", "--pair-stdin"], context),
    ).toMatchObject({
      options: { connect: "http://127.0.0.1:43110", pairStdin: true },
    });
  });

  it.each(
    [
      ["--pair-stdin"],
      ["--connect", "http://127.0.0.1:43110", "--new-environment"],
      ["--new-environment", "--pair-stdin"],
      ["--connect", "http://user:secret@example.test"],
      ["--connect", "http://example.test/#token=secret"],
      ["--connect", "http://example.test/?token=secret"],
      ["--connect", "file:///tmp/environment"],
    ].map((argv) => [argv] as const),
  )("rejects ambiguous connection options without disclosing credentials: %j", (argv) => {
    expect(() => parseTuiCliArgs(argv, context)).toThrow(TuiCliUsageError);
    try {
      parseTuiCliArgs(argv, context);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });

  it("builds a loopback-only child launch and replaces ambient location overrides", () => {
    const result = buildTuiLaunchOptions(
      { stateDir: "/tmp/tui-state", cwd: "/work/project", port: 43_112 },
      {
        executable: "/node-26.4/bin/node",
        serverEntryPath: "/repo/apps/server/src/bin.ts",
        env: {
          PATH: "/bin",
          T3CODE_HOME: "/users/tui/.t3",
          T3CODE_TELEMETRY_ENABLED: "true",
          T3CODE_HOST: "0.0.0.0",
          T3CODE_TAILSCALE_SERVE: "true",
          T3CODE_BOOTSTRAP_FD: "9",
          T3CODE_DEV_AUTH_TOKEN: "do-not-forward",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      },
    );

    expect(result.httpBaseUrl).toBe("http://127.0.0.1:43112");
    expect(result.start).toMatchObject({
      executable: "/node-26.4/bin/node",
      args: ["/repo/apps/server/src/bin.ts"],
      cwd: "/work/project",
      delivery: "fd3",
      bootstrap: {
        mode: "desktop",
        noBrowser: true,
        port: 43_112,
        t3Home: "/tmp/tui-state",
        host: "127.0.0.1",
        tailscaleServeEnabled: false,
      },
    });
    expect(result.start.env).toMatchObject({
      PATH: "/bin",
      T3CODE_HOME: "/tmp/tui-state",
      T3CODE_TELEMETRY_ENABLED: "false",
      T3CODE_HOST: "127.0.0.1",
      T3CODE_TAILSCALE_SERVE: "false",
    });
    expect(result.start.env).not.toHaveProperty("T3CODE_BOOTSTRAP_FD");
    expect(result.start.env).not.toHaveProperty("T3CODE_DEV_AUTH_TOKEN");
    expect(result.start.env).not.toHaveProperty("VITE_DEV_SERVER_URL");
  });
});
