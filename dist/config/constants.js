"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASELINE_DIRECTORIES = exports.DRIVE_METADATA_READONLY_SCOPE = exports.GMAIL_READONLY_SCOPE = exports.ENV_TOKEN_PATH = exports.ENV_CREDENTIALS_PATH = exports.ENV_PROFILE = exports.MCP_COMMAND = exports.CLI_COMMAND = exports.APP_NAME = void 0;
exports.APP_NAME = "google-tool";
exports.CLI_COMMAND = "google-tool";
exports.MCP_COMMAND = "google-tool-mcp";
exports.ENV_PROFILE = "GOOGLE_TOOL_PROFILE";
exports.ENV_CREDENTIALS_PATH = "GOOGLE_TOOL_CREDENTIALS";
exports.ENV_TOKEN_PATH = "GOOGLE_TOOL_TOKEN";
exports.GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
exports.DRIVE_METADATA_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
exports.BASELINE_DIRECTORIES = {
    cliContracts: "tests/contracts/cli",
    mcpContracts: "tests/contracts/mcp",
    labelFixtures: "tests/fixtures/baseline/labels",
    messageFixtures: "tests/fixtures/baseline/messages",
};
