#!/usr/bin/env node

const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const entrypoint = path.resolve(__dirname, "..", "dist", "mcp", "server.js");

if (!existsSync(entrypoint)) {
  console.error(
    "dist/mcp/server.js was not found. Run `npm run build` before invoking google-tool-mcp from this checkout.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [entrypoint, ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
