export const APP_NAME = "google-tool";
export const CLI_COMMAND = "google-tool";
export const MCP_COMMAND = "google-tool-mcp";
export const ENV_PROFILE = "GOOGLE_TOOL_PROFILE";
export const ENV_CREDENTIALS_PATH = "GOOGLE_TOOL_CREDENTIALS";
export const ENV_TOKEN_PATH = "GOOGLE_TOOL_TOKEN";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const DRIVE_METADATA_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";

export const BASELINE_DIRECTORIES = {
  cliContracts: "tests/contracts/cli",
  mcpContracts: "tests/contracts/mcp",
  labelFixtures: "tests/fixtures/baseline/labels",
  messageFixtures: "tests/fixtures/baseline/messages",
} as const;
