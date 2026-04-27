import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const testFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(testFilePath), "..");

function runNodeScript(
  scriptPath: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {},
  input?: string,
) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: "utf-8",
    input,
  });
}

function encodeMcpMessage(message: unknown): string {
  return JSON.stringify(message);
}

function decodeMcpMessages(output: string): unknown[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test("google-tool bin launches the built Node CLI", () => {
  const tscCliPath = require.resolve("typescript/bin/tsc");
  const buildResult = runNodeScript(tscCliPath, ["-p", "tsconfig.json"]);
  assert.equal(buildResult.status, 0, buildResult.stderr);

  const result = runNodeScript(
    path.join(projectRoot, "bin", "google-tool.js"),
    ["--print-config-dir"],
    {
      HOME: "/home/bin-smoke",
    },
  );

  assert.equal(result.status, 0, result.stderr);
});

test("google-tool-mcp bin launches the built Node MCP server", () => {
  const tscCliPath = require.resolve("typescript/bin/tsc");
  const buildResult = runNodeScript(tscCliPath, ["-p", "tsconfig.json"]);
  assert.equal(buildResult.status, 0, buildResult.stderr);

  const mcpInput = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "bin-smoke-client",
          version: "1.0.0",
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    },
  ].map((message) => encodeMcpMessage(message)).join("\n") + "\n";
  const result = runNodeScript(
    path.join(projectRoot, "bin", "google-tool-mcp.js"),
    [],
    {},
    mcpInput,
  );

  assert.equal(result.status, 0, result.stderr);
});

test("build produces runnable dist entrypoints", () => {
  const tscCliPath = require.resolve("typescript/bin/tsc");
  const buildResult = runNodeScript(tscCliPath, ["-p", "tsconfig.json"]);
  assert.equal(buildResult.status, 0, buildResult.stderr);

  const cliResult = runNodeScript(
    path.join(projectRoot, "dist", "cli.js"),
    ["--print-config-dir"],
    {
      HOME: "/home/smoke",
    },
  );
  assert.equal(cliResult.status, 0, cliResult.stderr);

  const mcpInput = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "smoke-client",
          version: "1.0.0",
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    },
  ].map((message) => encodeMcpMessage(message)).join("\n") + "\n";
  const mcpResult = runNodeScript(
    path.join(projectRoot, "dist", "mcp", "server.js"),
    [],
    {},
    mcpInput,
  );
  assert.equal(mcpResult.status, 0, mcpResult.stderr);
});
