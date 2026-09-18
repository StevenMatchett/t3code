import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const bin = NodeURL.fileURLToPath(new URL("../dist/cli/bin.js", import.meta.url));

NodeTest.test(
  "a legacy query-token link reaches the exchange through the compiled CLI",
  async () => {
    const state = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-pair-query-"));
    const tokens = [];
    const server = NodeHttp.createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/.well-known/t3/environment") {
        response.end(
          JSON.stringify({
            environmentId: "cli-query-pairing",
            label: "CLI pairing fixture",
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.40",
            capabilities: { repositoryIdentity: true, connectionProbe: true },
          }),
        );
      } else if (request.url === "/oauth/token") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          tokens.push(new URLSearchParams(body).get("subject_token"));
          response.writeHead(400);
          response.end(JSON.stringify({ error: "invalid_grant" }));
        });
      } else {
        response.writeHead(404);
        response.end("{}");
      }
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      NodeAssert.ok(address && typeof address !== "string");
      const origin = `http://127.0.0.1:${address.port}`;
      const child = NodeChildProcess.spawn(
        process.execPath,
        ["--experimental-ffi", bin, "--state-dir", state, "--connect", origin, "--pair-stdin"],
        {
          cwd: state,
          env: { PATH: process.env.PATH },
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 10_000,
        },
      );
      let stdout = "";
      let stderr = "";
      const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.stdin.on("error", reject);
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.once("close", resolve);
      });
      child.stdin.end(`${origin}/?token=query-token-fixture`);
      NodeAssert.equal(await closed, 1);
      NodeAssert.deepEqual(tokens, ["query-token-fixture"]);
      NodeAssert.match(stderr, /TuiEnvironmentConnectionError/);
      NodeAssert.doesNotMatch(stderr, /^\s+at\s/m);
      NodeAssert.equal(`${stdout}${stderr}`.includes("query-token-fixture"), false);
      NodeAssert.deepEqual(await NodeFSP.readdir(state), []);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await NodeFSP.rm(state, { recursive: true, force: true });
    }
  },
);

NodeTest.test(
  "default launch requires pairing and leaves the state directory untouched",
  async () => {
    const state = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-attach-cli-"));
    try {
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        ["--experimental-ffi", bin, "--state-dir", state],
        {
          cwd: state,
          env: { PATH: process.env.PATH },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      NodeAssert.ifError(result.error);
      NodeAssert.equal(result.status, 1, result.stderr);
      NodeAssert.match(result.stderr, /Pair with your existing T3 environment/);
      NodeAssert.doesNotMatch(result.stderr, /^\s+at\s/m);
      NodeAssert.deepEqual(await NodeFSP.readdir(state), []);
    } finally {
      await NodeFSP.rm(state, { recursive: true, force: true });
    }
  },
);

NodeTest.test(
  "a mismatched pairing link is rejected without echoing the token or writing state",
  async () => {
    const state = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-pair-cli-"));
    try {
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [
          "--experimental-ffi",
          bin,
          "--state-dir",
          state,
          "--connect",
          "http://127.0.0.1:43110",
          "--pair-stdin",
        ],
        {
          cwd: state,
          env: { PATH: process.env.PATH },
          input: "http://127.0.0.1:43111/pair#token=private-pairing-fixture",
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      NodeAssert.ifError(result.error);
      NodeAssert.equal(result.status, 2);
      NodeAssert.match(result.stderr, /selected origin/);
      NodeAssert.doesNotMatch(result.stderr, /^\s+at\s/m);
      NodeAssert.ok(!`${result.stdout}${result.stderr}`.includes("private-pairing-fixture"));
      NodeAssert.deepEqual(await NodeFSP.readdir(state), []);
    } finally {
      await NodeFSP.rm(state, { recursive: true, force: true });
    }
  },
);
