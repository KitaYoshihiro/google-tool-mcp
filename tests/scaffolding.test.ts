import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_NAME,
  BASELINE_DIRECTORIES,
  CLI_COMMAND,
  DRIVE_METADATA_READONLY_SCOPE,
  ENV_CREDENTIALS_PATH,
  ENV_PROFILE,
  GMAIL_READONLY_SCOPE,
  ENV_TOKEN_PATH,
  MCP_COMMAND,
} from "../src/config/constants";
import { getDefaultConfigDirHint } from "../src/config/paths";

test("scaffolding exposes stable app constants", () => {
  assert.equal(APP_NAME, "google-tool");
  assert.equal(CLI_COMMAND, "google-tool");
  assert.equal(MCP_COMMAND, "google-tool-mcp");
  assert.equal(ENV_PROFILE, "GOOGLE_TOOL_PROFILE");
  assert.equal(ENV_CREDENTIALS_PATH, "GOOGLE_TOOL_CREDENTIALS");
  assert.equal(ENV_TOKEN_PATH, "GOOGLE_TOOL_TOKEN");
  assert.equal(GMAIL_READONLY_SCOPE, "https://www.googleapis.com/auth/gmail.readonly");
  assert.equal(
    DRIVE_METADATA_READONLY_SCOPE,
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  );
});

test("scaffolding fixes baseline storage locations", () => {
  assert.deepEqual(BASELINE_DIRECTORIES, {
    cliContracts: "tests/contracts/cli",
    mcpContracts: "tests/contracts/mcp",
    labelFixtures: "tests/fixtures/baseline/labels",
    messageFixtures: "tests/fixtures/baseline/messages",
  });
});

test("config dir hint reuses the app name", () => {
  assert.equal(getDefaultConfigDirHint(), APP_NAME);
});
