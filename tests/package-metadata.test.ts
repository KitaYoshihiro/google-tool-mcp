import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const packageJsonPath = path.join(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
  bugs?: { url?: string };
  description?: string;
  homepage?: string;
  keywords?: string[];
  license?: string;
  private?: boolean;
  repository?: { type?: string; url?: string };
  type?: string;
};

test("package metadata matches the GitHub-distributed package", () => {
  assert.equal(packageJson.private, true);
  assert.equal(
    packageJson.description,
    "MCP server and CLI for reading Gmail messages and Google Drive metadata",
  );
  assert.equal(packageJson.type, "commonjs");
  assert.equal(packageJson.license, "MIT");
  assert.deepEqual(packageJson.keywords, [
    "gmail",
    "drive",
    "mcp",
    "cli",
    "google-api",
    "oauth2",
    "typescript",
  ]);
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/KitaYoshihiro/google-tool-mcp.git",
  });
  assert.equal(
    packageJson.homepage,
    "https://github.com/KitaYoshihiro/google-tool-mcp#readme",
  );
  assert.deepEqual(packageJson.bugs, {
    url: "https://github.com/KitaYoshihiro/google-tool-mcp/issues",
  });
});
