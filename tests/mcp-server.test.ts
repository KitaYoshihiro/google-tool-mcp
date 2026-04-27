import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  GmailAuthRequiredError,
  GoogleScopeRequiredError,
} from "../src/auth/googleAuth";
import {
  createMcpProtocolHandler,
  parseMcpServerArgs,
  runMcpServer,
} from "../src/mcp/server";

function encodeMcpFrame(message: unknown): string {
  return JSON.stringify(message) + "\n";
}

function decodeMcpFrames(output: string): unknown[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function initializeHandler(
  handler: ReturnType<typeof createMcpProtocolHandler>,
): Promise<void> {
  const initializeResponse = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  });

  assert.equal(initializeResponse?.jsonrpc, "2.0");
  assert.equal(initializeResponse?.id, 1);

  const initializedResponse = await handler.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(initializedResponse, null);
}

function configuredCredentialDependencies() {
  return {
    homeDir: "/home/test",
    platform: "linux" as const,
    ensureDir: async () => {},
    pathExists: async (filePath: string) =>
      filePath === "/home/test/.config/google-tool/credentials.json",
  };
}

test("mcp initialize returns tools capability and instructions", async () => {
  const handler = createMcpProtocolHandler();
  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-11-25",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "google-tool",
        version: "0.1.0",
      },
      instructions:
        "Read Gmail messages, supported Gmail text attachments, and Google Drive file metadata from the authorized account. If OAuth is not initialized, configure credentials first: place credentials.json in the config directory or set GOOGLE_TOOL_CREDENTIALS. GOOGLE_TOOL_PROFILE selects a profile, GOOGLE_TOOL_TOKEN can point to an existing token, and the first tool call can launch browser auth after credentials are configured.",
    },
  });
});

test("mcp initialize accepts older supported protocol versions", async () => {
  const handler = createMcpProtocolHandler();
  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "google-tool",
        version: "0.1.0",
      },
      instructions:
        "Read Gmail messages, supported Gmail text attachments, and Google Drive file metadata from the authorized account. If OAuth is not initialized, configure credentials first: place credentials.json in the config directory or set GOOGLE_TOOL_CREDENTIALS. GOOGLE_TOOL_PROFILE selects a profile, GOOGLE_TOOL_TOKEN can point to an existing token, and the first tool call can launch browser auth after credentials are configured.",
    },
  });
});

test("mcp initialize falls back to the latest supported protocol version for unknown clients", async () => {
  const handler = createMcpProtocolHandler();
  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "9999-01-01",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-11-25",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "google-tool",
        version: "0.1.0",
      },
      instructions:
        "Read Gmail messages, supported Gmail text attachments, and Google Drive file metadata from the authorized account. If OAuth is not initialized, configure credentials first: place credentials.json in the config directory or set GOOGLE_TOOL_CREDENTIALS. GOOGLE_TOOL_PROFILE selects a profile, GOOGLE_TOOL_TOKEN can point to an existing token, and the first tool call can launch browser auth after credentials are configured.",
    },
  });
});

test("mcp tools/list returns the expected tool definitions", async () => {
  const handler = createMcpProtocolHandler();
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });

  assert.equal(response?.jsonrpc, "2.0");
  assert.equal(response?.id, 2);
  assert.deepEqual((response as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name), [
    "whoami",
    "list_gmail_messages",
    "list_gmail_labels",
    "read_gmail_message",
    "list_gmail_attachments",
    "read_gmail_attachment_text",
    "download_gmail_attachment",
    "get_drive_about",
    "list_drive_files",
    "read_drive_file",
  ]);
});

test("mcp server parses --profile", () => {
  assert.deepEqual(parseMcpServerArgs(["--profile", "work"]), {
    driveEnabled: true,
    gmailEnabled: true,
    profileName: "work",
  });
});

test("mcp server parses --profile=value", () => {
  assert.deepEqual(parseMcpServerArgs(["--profile=work"]), {
    driveEnabled: true,
    gmailEnabled: true,
    profileName: "work",
  });
});

test("mcp server parses gmail/drive feature toggles", () => {
  assert.deepEqual(parseMcpServerArgs(["--gmail=off", "--drive=on"]), {
    driveEnabled: true,
    gmailEnabled: false,
  });
});

test("mcp server rejects --profile without a value", () => {
  assert.throws(
    () => parseMcpServerArgs(["--profile"]),
    /Missing value for --profile\./u,
  );
});

test("mcp server rejects --profile= without a value", () => {
  assert.throws(
    () => parseMcpServerArgs(["--profile="]),
    /Missing value for --profile\./u,
  );
});

test("mcp server rejects invalid gmail/drive toggle values", () => {
  assert.throws(
    () => parseMcpServerArgs(["--gmail=maybe"]),
    /Invalid value for --gmail: maybe. Use on or off./u,
  );
  assert.throws(
    () => parseMcpServerArgs(["--drive"]),
    /Missing value for --drive. Use on or off./u,
  );
});

test("mcp server rejects unknown options", () => {
  assert.throws(
    () => parseMcpServerArgs(["--unknown"]),
    /Unknown option: --unknown/u,
  );
});

test("mcp tools/call starts browser auth in the background and returns a retry response", async () => {
  const observedCalls: Array<{
    allowBrowserAuth: boolean;
    requireGrantedScopes: boolean | undefined;
    scopes: readonly string[];
  }> = [];
  let authorizationCalls = 0;
  const notices: Array<{ authorizationUrl: string; browserOpened: boolean }> = [];

  const handler = createMcpProtocolHandler({
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/credentials.json",
    onAuthorizationReady: async (notice) => {
      notices.push({
        authorizationUrl: notice.authorizationUrl,
        browserOpened: notice.browserOpened,
      });
    },
    ensureAuthorizedToken: async (options) => {
      authorizationCalls += 1;
      observedCalls.push({
        allowBrowserAuth: options.allowBrowserAuth,
        requireGrantedScopes: options.requireGrantedScopes,
        scopes: options.scopes,
      });
      if (!options.allowBrowserAuth) {
        throw new GmailAuthRequiredError("/home/test/.config/google-tool/token.json");
      }
      await options.onAuthorizationReady?.({
        authorizationUrl: "https://example.com/auth",
        browserOpened: true,
        redirectUri: "http://127.0.0.1:43123/callback",
      });
      return await new Promise(() => undefined);
    },
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: {
      name: "list_gmail_labels",
      arguments: {},
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(authorizationCalls, 2);
  assert.deepEqual(observedCalls, [
    {
      allowBrowserAuth: false,
      requireGrantedScopes: true,
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
    },
    {
      allowBrowserAuth: true,
      requireGrantedScopes: true,
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
    },
  ]);
  assert.deepEqual(notices, [
    {
      authorizationUrl: "https://example.com/auth",
      browserOpened: true,
    },
  ]);
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 22,
    result: {
      content: [
        {
          type: "text",
          text:
            "RuntimeError: Google authorization has started. Complete it in the browser. After completing Google authorization, retry the same request.",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/call reports when browser auth is already in progress", async () => {
  let authorizationCalls = 0;

  const handler = createMcpProtocolHandler({
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/credentials.json",
    ensureAuthorizedToken: async (options) => {
      authorizationCalls += 1;
      if (!options.allowBrowserAuth) {
        throw new GmailAuthRequiredError("/home/test/.config/google-tool/token.json");
      }
      await options.onAuthorizationReady?.({
        authorizationUrl: "https://example.com/auth",
        browserOpened: false,
        manualInstructions:
          "Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth",
        redirectUri: "http://127.0.0.1:43123/callback",
      });
      return await new Promise(() => undefined);
    },
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  await handler.handleMessage({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: {
      name: "list_gmail_labels",
      arguments: {},
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 23,
    method: "tools/call",
    params: {
      name: "list_gmail_labels",
      arguments: {},
    },
  });

  assert.equal(authorizationCalls, 2);
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 23,
    result: {
      content: [
        {
          type: "text",
          text:
            "RuntimeError: Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth\nThe MCP server is still waiting for Google authorization to finish. After completing Google authorization, retry the same request.",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/call reports the previous background authorization failure", async () => {
  let authorizationCalls = 0;

  const handler = createMcpProtocolHandler({
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/credentials.json",
    ensureAuthorizedToken: async (options) => {
      authorizationCalls += 1;
      if (!options.allowBrowserAuth) {
        throw new GmailAuthRequiredError("/home/test/.config/google-tool/token.json");
      }
      throw new Error("OAuth callback was not received, so token.json was not saved");
    },
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  await handler.handleMessage({
    jsonrpc: "2.0",
    id: 24,
    method: "tools/call",
    params: {
      name: "list_gmail_labels",
      arguments: {},
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 25,
    method: "tools/call",
    params: {
      name: "list_gmail_labels",
      arguments: {},
    },
  });

  assert.equal(authorizationCalls, 2);
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 25,
    result: {
      content: [
        {
          type: "text",
          text:
            "RuntimeError: The previous Google authorization attempt did not finish successfully: OAuth callback was not received, so token.json was not saved. Retry the same request to start authorization again.",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/call keeps browser auth disabled when the token file exists", async () => {
  const observedCalls: Array<{
    allowBrowserAuth: boolean;
    requireGrantedScopes: boolean | undefined;
    scopes: readonly string[];
  }> = [];

  const handler = createMcpProtocolHandler({
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/credentials.json" ||
      filePath === "/home/test/.config/google-tool/token.json",
    ensureAuthorizedToken: async (options) => {
      observedCalls.push({
        allowBrowserAuth: options.allowBrowserAuth,
        requireGrantedScopes: options.requireGrantedScopes,
        scopes: options.scopes,
      });
      return {
        source: "saved",
        token: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      };
    },
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 23,
    method: "tools/call",
    params: {
      name: "list_gmail_labels",
      arguments: {},
    },
  });

  assert.deepEqual(observedCalls, [
    {
      allowBrowserAuth: false,
      requireGrantedScopes: true,
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
    },
  ]);
  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    count: 0,
    labels: [],
  });
});

test("mcp tools/call upgrades a partial token to all enabled scopes", async () => {
  const observedCalls: Array<{
    allowBrowserAuth: boolean;
    requireGrantedScopes: boolean | undefined;
    scopes: readonly string[];
  }> = [];

  const handler = createMcpProtocolHandler({
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/credentials.json" ||
      filePath === "/home/test/.config/google-tool/token.json",
    ensureAuthorizedToken: async (options) => {
      observedCalls.push({
        allowBrowserAuth: options.allowBrowserAuth,
        requireGrantedScopes: options.requireGrantedScopes,
        scopes: options.scopes,
      });
      if (!options.allowBrowserAuth) {
        throw new GoogleScopeRequiredError("/home/test/.config/google-tool/token.json", [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/drive.metadata.readonly",
        ]);
      }
      await options.onAuthorizationReady?.({
        authorizationUrl: "https://example.com/auth",
        browserOpened: true,
        redirectUri: "http://127.0.0.1:43123/callback",
      });
      return await new Promise(() => undefined);
    },
    createDriveClient: async () => ({
      async getAbout() {
        throw new Error("not needed");
      },
      async getFile() {
        throw new Error("not needed");
      },
      async listFiles() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 24,
    method: "tools/call",
    params: {
      name: "list_drive_files",
      arguments: {},
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(observedCalls, [
    {
      allowBrowserAuth: false,
      requireGrantedScopes: true,
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
    },
    {
      allowBrowserAuth: true,
      requireGrantedScopes: true,
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
    },
  ]);
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 24,
    result: {
      content: [
        {
          type: "text",
          text:
            "RuntimeError: Google authorization has started. Complete it in the browser. After completing Google authorization, retry the same request.",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/call whoami uses Gmail identity when Gmail is enabled", async () => {
  const handler = createMcpProtocolHandler({
    env: {
      GOOGLE_TOOL_PROFILE: "work",
    },
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/profiles/work/token.json" ||
      filePath === "/home/test/.config/google-tool/credentials.json",
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
      },
    }),
    createGmailClient: async () => ({
      async getProfile() {
        return {
          emailAddress: "work@example.com",
        };
      },
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 23,
    method: "tools/call",
    params: {
      name: "whoami",
      arguments: {},
    },
  });

  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    account_email: "work@example.com",
    display_name: "",
    enabled_features: {
      gmail: true,
      drive: true,
    },
    identity_source: "gmail",
    profile_name: "work",
  });
});

test("mcp tools/call whoami uses Drive identity when Gmail is disabled", async () => {
  const handler = createMcpProtocolHandler({
    driveEnabled: true,
    gmailEnabled: false,
    profileName: "drive-only",
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/profiles/drive-only/token.json" ||
      filePath === "/home/test/.config/google-tool/credentials.json",
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
      },
    }),
    createDriveClient: async () => ({
      async getAbout() {
        return {
          user: {
            displayName: "Drive Account",
            emailAddress: "drive@example.com",
          },
        };
      },
      async getFile() {
        throw new Error("not needed");
      },
      async listFiles() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 24,
    method: "tools/call",
    params: {
      name: "whoami",
      arguments: {},
    },
  });

  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    account_email: "drive@example.com",
    display_name: "Drive Account",
    enabled_features: {
      gmail: false,
      drive: true,
    },
    identity_source: "drive",
    profile_name: "drive-only",
  });
});

test("mcp tools/call list_gmail_labels returns structured content", async () => {
  const handler = createMcpProtocolHandler({
    ...configuredCredentialDependencies(),
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
      },
    }),
    createGmailClient: async () => ({
      async listLabels() {
        return [
          { id: "Label_2", name: "Receipts", type: "user" },
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "Projects", type: "user" },
        ];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "list_gmail_labels",
      arguments: {},
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 3,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: 3,
              labels: [
                { id: "INBOX", name: "INBOX", type: "system" },
                { id: "Label_1", name: "Projects", type: "user" },
                { id: "Label_2", name: "Receipts", type: "user" },
              ],
            },
            null,
            2,
          ),
        },
      ],
      structuredContent: {
        count: 3,
        labels: [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "Projects", type: "user" },
          { id: "Label_2", name: "Receipts", type: "user" },
        ],
      },
      isError: false,
    },
  });
});

test("mcp tools/call list_gmail_messages uses MCP defaults", async () => {
  const ensuredDirs: string[] = [];
  let observedListMessageIds:
    | {
        labelIds: readonly string[];
        maxResults: number;
        query: string;
      }
    | undefined;

  const handler = createMcpProtocolHandler({
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async (dirPath) => {
      ensuredDirs.push(dirPath);
    },
    pathExists: async (filePath) =>
      filePath === "/home/test/.config/google-tool/credentials.json",
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
      },
    }),
    createGmailClient: async () => ({
      async listLabels() {
        return [
          { id: "Label_1", name: "Projects", type: "user" },
        ];
      },
      async listMessageIds(options) {
        observedListMessageIds = options;
        return ["msg-001"];
      },
      async getMessage() {
        return {
          id: "msg-001",
          threadId: "thread-001",
          snippet: "The nightly build passed.",
          payload: {
            headers: [
              { name: "Subject", value: "Build report" },
              { name: "From", value: "Dev Team <dev@example.com>" },
              { name: "Date", value: "Tue, 22 Apr 2026 09:00:00 +0900" },
            ],
          },
        };
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "list_gmail_messages",
      arguments: {
        labels: ["Projects"],
        query: "is:unread",
      },
    },
  });

  assert.deepEqual(observedListMessageIds, {
    labelIds: ["Label_1"],
    maxResults: 10,
    query: "is:unread",
  });
  assert.deepEqual(ensuredDirs, ["/home/test/.config/google-tool"]);
  assert.equal(
    JSON.stringify((response as { result: { structuredContent: unknown } }).result.structuredContent),
    JSON.stringify({
      count: 1,
      query: "is:unread",
      labels: ["Projects"],
      resolved_label_ids: ["Label_1"],
      messages: [
        {
          id: "msg-001",
          thread_id: "thread-001",
          subject: "Build report",
          sender: "Dev Team <dev@example.com>",
          date: "Tue, 22 Apr 2026 09:00:00 +0900",
          snippet: "The nightly build passed.",
          body: "",
          body_truncated: false,
        },
      ],
    }),
  );
});

test("mcp tools/call read_gmail_message uses include_body=true and body_chars=5000 by default", async () => {
  const handler = createMcpProtocolHandler({
    ...configuredCredentialDependencies(),
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
      },
    }),
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        return {
          id: "msg-001",
          threadId: "thread-001",
          snippet: "The nightly build passed.",
          payload: {
            headers: [
              { name: "Subject", value: "Build report" },
              { name: "From", value: "Dev Team <dev@example.com>" },
              { name: "Date", value: "Tue, 22 Apr 2026 09:00:00 +0900" },
            ],
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Hello team,\n\nThe nightly build passed.", "utf-8").toString("base64url"),
            },
          },
        };
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "read_gmail_message",
      arguments: {
        message_id: "msg-001",
      },
    },
  });

  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    id: "msg-001",
    thread_id: "thread-001",
    subject: "Build report",
    sender: "Dev Team <dev@example.com>",
    date: "Tue, 22 Apr 2026 09:00:00 +0900",
    snippet: "The nightly build passed.",
    body: "Hello team,\n\nThe nightly build passed.",
    body_truncated: false,
  });
});

test("mcp tools/call list_gmail_attachments returns attachment metadata", async () => {
  const handler = createMcpProtocolHandler({
    ...configuredCredentialDependencies(),
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
      },
    }),
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getAttachment() {
        throw new Error("not needed");
      },
      async getMessage() {
        return {
          id: "msg-001",
          payload: {
            parts: [
              {
                filename: "report.csv",
                mimeType: "text/csv",
                partId: "1",
                body: {
                  attachmentId: "att-001",
                  size: 18,
                },
              },
              {
                filename: "scan.pdf",
                mimeType: "application/pdf",
                partId: "2",
                body: {
                  attachmentId: "att-002",
                  size: 1024,
                },
              },
            ],
          },
        };
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 25,
    method: "tools/call",
    params: {
      name: "list_gmail_attachments",
      arguments: {
        message_id: "msg-001",
      },
    },
  });

  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    count: 2,
    message_id: "msg-001",
    attachments: [
      {
        filename: "report.csv",
        mime_type: "text/csv",
        part_id: "1",
        size: 18,
        text_supported: true,
        text_format: "plain",
      },
      {
        filename: "scan.pdf",
        mime_type: "application/pdf",
        part_id: "2",
        size: 1024,
        text_supported: false,
        text_format: "",
      },
    ],
  });
});

test("mcp tools/call read_gmail_attachment_text returns decoded text", async () => {
  const handler = createMcpProtocolHandler({
    ...configuredCredentialDependencies(),
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
      },
    }),
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getAttachment() {
        return {
          data: Buffer.from("date,total\n2026-04-27,1000\n", "utf-8").toString("base64url"),
          size: 28,
        };
      },
      async getMessage() {
        return {
          id: "msg-001",
          payload: {
            parts: [
              {
                filename: "report.csv",
                mimeType: "text/csv",
                partId: "1",
                headers: [
                  { name: "Content-Type", value: "text/csv; charset=utf-8" },
                ],
                body: {
                  attachmentId: "att-001",
                  size: 28,
                },
              },
            ],
          },
        };
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 26,
    method: "tools/call",
    params: {
      name: "read_gmail_attachment_text",
      arguments: {
        message_id: "msg-001",
        part_id: "1",
        max_bytes: 1024,
        max_chars: 12,
      },
    },
  });

  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    filename: "report.csv",
    message_id: "msg-001",
    mime_type: "text/csv",
    part_id: "1",
    size: 28,
    text: "date,tota...",
    text_chars: 12,
    text_format: "plain",
    text_truncated: true,
  });
});

test("mcp tools/call download_gmail_attachment saves a local file and returns metadata only", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-tool-mcp-attachment-"));

  try {
    const handler = createMcpProtocolHandler({
      ...configuredCredentialDependencies(),
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getAttachment(_messageId: string, attachmentId: string) {
          assert.equal(attachmentId, "att-current");
          return {
            data: Buffer.from("PDF bytes", "utf-8").toString("base64url"),
            size: 9,
          };
        },
        async getMessage() {
          return {
            id: "msg-001",
            payload: {
              parts: [
                {
                  filename: "../report.pdf",
                  mimeType: "application/pdf",
                  partId: "1",
                  body: {
                    attachmentId: "att-current",
                    size: 9,
                  },
                },
              ],
            },
          };
        },
      }),
    });
    await initializeHandler(handler);

    const response = await handler.handleMessage({
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: {
        name: "download_gmail_attachment",
        arguments: {
          message_id: "msg-001",
          part_id: "1",
          download_dir: tempDir,
        },
      },
    });
    const structuredContent = (response as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    const savedPath = structuredContent.saved_path as string;

    assert.equal(readFileSync(savedPath, "utf-8"), "PDF bytes");
    assert.equal(savedPath, path.join(tempDir, "1-report.pdf"));
    assert.deepEqual(structuredContent, {
      content_returned: false,
      filename: "../report.pdf",
      message_id: "msg-001",
      mime_type: "application/pdf",
      part_id: "1",
      saved_path: savedPath,
      sha256: "662f0631667382600d18269aeb84b04987b60124d1371b34cd783ae06cbe656c",
      size: 9,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mcp tools/call get_drive_about returns structured content", async () => {
  const handler = createMcpProtocolHandler({
    ...configuredCredentialDependencies(),
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
      },
    }),
    createDriveClient: async () => ({
      async getAbout() {
        return {
          user: {
            displayName: "Alice Example",
            emailAddress: "alice@example.com",
            me: true,
            permissionId: "permission-123",
            photoLink: "https://example.com/photo.png",
          },
          storageQuota: {
            limit: "1000",
            usage: "250",
            usageInDrive: "200",
            usageInDriveTrash: "50",
          },
        };
      },
      async getFile() {
        throw new Error("not needed");
      },
      async listFiles() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 51,
    method: "tools/call",
    params: {
      name: "get_drive_about",
      arguments: {},
    },
  });

  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    user: {
      display_name: "Alice Example",
      email_address: "alice@example.com",
      me: true,
      permission_id: "permission-123",
      photo_link: "https://example.com/photo.png",
    },
    storage_quota: {
      limit: "1000",
      usage: "250",
      usage_in_drive: "200",
      usage_in_drive_trash: "50",
    },
  });
});

test("mcp tools/call list_drive_files uses Drive search defaults", async () => {
  let observedListFiles:
    | {
        corpora: "allDrives" | "domain" | "drive" | "user";
        driveId?: string;
        includeItemsFromAllDrives: boolean;
        includeTrashed: boolean;
        maxResults: number;
        orderBy: string;
        query: string;
      }
    | undefined;

  const handler = createMcpProtocolHandler({
    ...configuredCredentialDependencies(),
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
      },
    }),
    createDriveClient: async () => ({
      async getAbout() {
        throw new Error("not needed");
      },
      async getFile() {
        throw new Error("not needed");
      },
      async listFiles(options) {
        observedListFiles = options;
        return {
          files: [
            {
              id: "file-001",
              name: "Quarterly Plan",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2026-04-22T00:00:00.000Z",
              webViewLink: "https://drive.google.com/file/d/file-001/view",
            },
          ],
        };
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 52,
    method: "tools/call",
    params: {
      name: "list_drive_files",
      arguments: {
        query: "fullText contains 'quarterly plan'",
      },
    },
  });

  assert.deepEqual(observedListFiles, {
    corpora: "user",
    driveId: undefined,
    includeItemsFromAllDrives: false,
    includeTrashed: false,
    maxResults: 10,
    orderBy: "",
    query: "fullText contains 'quarterly plan'",
  });
  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    corpora: "user",
    count: 1,
    drive_id: "",
    files: [
      {
        created_time: "",
        description: "",
        drive_id: "",
        folder_color_rgb: "",
        icon_link: "",
        id: "file-001",
        mime_type: "application/vnd.google-apps.document",
        modified_time: "2026-04-22T00:00:00.000Z",
        name: "Quarterly Plan",
        owned_by_me: false,
        owners: [],
        parents: [],
        resource_key: "",
        shared: false,
        shortcut_details: null,
        size: "",
        starred: false,
        thumbnail_link: "",
        trashed: false,
        web_view_link: "https://drive.google.com/file/d/file-001/view",
      },
    ],
    include_items_from_all_drives: false,
    include_trashed: false,
    incomplete_search: false,
    max_results: 10,
    next_page_token: "",
    order_by: "",
    query: "fullText contains 'quarterly plan'",
  });
});

test("mcp tools/call read_drive_file returns metadata without content download", async () => {
  const handler = createMcpProtocolHandler({
    ...configuredCredentialDependencies(),
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
        scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
      },
    }),
    createDriveClient: async () => ({
      async getAbout() {
        throw new Error("not needed");
      },
      async getFile(fileId) {
        assert.equal(fileId, "file-001");
        return {
          id: "file-001",
          name: "Quarterly Plan",
          mimeType: "application/vnd.google-apps.document",
          description: "Planning doc",
          parents: ["folder-123"],
          owners: [
            {
              displayName: "Alice Example",
              emailAddress: "alice@example.com",
            },
          ],
          shortcutDetails: {
            targetId: "target-001",
            targetMimeType: "application/pdf",
          },
        };
      },
      async listFiles() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 53,
    method: "tools/call",
    params: {
      name: "read_drive_file",
      arguments: {
        file_id: "file-001",
      },
    },
  });

  assert.deepEqual((response as { result: { structuredContent: unknown } }).result.structuredContent, {
    created_time: "",
    description: "Planning doc",
    drive_id: "",
    folder_color_rgb: "",
    icon_link: "",
    id: "file-001",
    mime_type: "application/vnd.google-apps.document",
    modified_time: "",
    name: "Quarterly Plan",
    owned_by_me: false,
    owners: [
      {
        display_name: "Alice Example",
        email_address: "alice@example.com",
        me: false,
        permission_id: "",
        photo_link: "",
      },
    ],
    parents: ["folder-123"],
    resource_key: "",
    shared: false,
    shortcut_details: {
      target_id: "target-001",
      target_mime_type: "application/pdf",
      target_resource_key: "",
    },
    size: "",
    starred: false,
    thumbnail_link: "",
    trashed: false,
    web_view_link: "",
  });
});

test("mcp tools/call exposes unexpected auth failures as tool errors", async () => {
  const handler = createMcpProtocolHandler({
    homeDir: "/home/missing",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/missing/.config/google-tool/credentials.json",
    ensureAuthorizedToken: async () => {
      throw new Error("Authorization backend failed");
    },
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "list_gmail_messages",
      arguments: {},
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 6,
    result: {
      content: [
        {
          type: "text",
          text: "RuntimeError: Authorization backend failed",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/call reports missing credentials setup guidance before auth", async () => {
  const ensuredDirs: string[] = [];
  let ensureAuthorizedTokenCalled = false;
  const handler = createMcpProtocolHandler({
    homeDir: "/home/test",
    platform: "linux",
    ensureDir: async (dirPath) => {
      ensuredDirs.push(dirPath);
    },
    pathExists: async () => false,
    ensureAuthorizedToken: async () => {
      ensureAuthorizedTokenCalled = true;
      throw new Error("not needed");
    },
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "list_drive_files",
      arguments: {},
    },
  });

  assert.deepEqual(ensuredDirs, ["/home/test/.config/google-tool"]);
  assert.equal(ensureAuthorizedTokenCalled, false);
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 7,
    result: {
      content: [
        {
          type: "text",
          text:
            "RuntimeError: Google OAuth client credentials are not configured. User action required: place a Desktop app OAuth client JSON file at /home/test/.config/google-tool/credentials.json. To use another location, set GOOGLE_TOOL_CREDENTIALS to the full credentials.json path in the MCP server configuration. Then retry the same tool call; browser authorization will create /home/test/.config/google-tool/token.json. After presenting this setup guidance, wait for the user to configure credentials instead of running unrelated CLI commands.",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/list hides Gmail tools when gmail is disabled", async () => {
  const handler = createMcpProtocolHandler({
    gmailEnabled: false,
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 62,
    method: "tools/list",
  });

  assert.deepEqual((response as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name), [
    "whoami",
    "get_drive_about",
    "list_drive_files",
    "read_drive_file",
  ]);
});

test("mcp tools/list hides Drive tools when drive is disabled", async () => {
  const handler = createMcpProtocolHandler({
    driveEnabled: false,
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 63,
    method: "tools/list",
  });

  assert.deepEqual((response as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name), [
    "whoami",
    "list_gmail_messages",
    "list_gmail_labels",
    "read_gmail_message",
    "list_gmail_attachments",
    "read_gmail_attachment_text",
    "download_gmail_attachment",
  ]);
});

test("mcp tools/call rejects disabled tools explicitly", async () => {
  const handler = createMcpProtocolHandler({
    gmailEnabled: false,
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 64,
    method: "tools/call",
    params: {
      name: "list_gmail_messages",
      arguments: {},
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 64,
    result: {
      content: [
        {
          type: "text",
          text: "RuntimeError: Tool is disabled by server configuration: list_gmail_messages",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/call exposes unexpected Drive auth failures as tool errors", async () => {
  const handler = createMcpProtocolHandler({
    homeDir: "/home/missing",
    platform: "linux",
    ensureDir: async () => {},
    pathExists: async (filePath) =>
      filePath === "/home/missing/.config/google-tool/credentials.json",
    ensureAuthorizedToken: async () => {
      throw new Error("Drive authorization backend failed");
    },
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 61,
    method: "tools/call",
    params: {
      name: "list_drive_files",
      arguments: {},
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 61,
    result: {
      content: [
        {
          type: "text",
          text: "RuntimeError: Drive authorization backend failed",
        },
      ],
      isError: true,
    },
  });
});

test("mcp tools/call rejects negative body char limits", async () => {
  const handler = createMcpProtocolHandler({
    ensureAuthorizedToken: async () => ({
      source: "saved",
      token: {
        access_token: "access-token",
      },
    }),
    createGmailClient: async () => ({
      async listLabels() {
        return [];
      },
      async listMessageIds() {
        return [];
      },
      async getMessage() {
        throw new Error("not needed");
      },
    }),
  });
  await initializeHandler(handler);

  const response = await handler.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "list_gmail_messages",
      arguments: {
        body_chars: -1,
      },
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 7,
    result: {
      content: [
        {
          type: "text",
          text: "RuntimeError: Invalid body_chars.",
        },
      ],
      isError: true,
    },
  });
});

test("runMcpServer speaks newline-delimited JSON stdio", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.setEncoding("utf-8");
  stdout.on("data", (chunk) => {
    output += chunk;
  });

  const exitCodePromise = runMcpServer(
    {
      error() {},
    },
    {
      stdin,
      stdout,
    },
  );

  stdin.end(
    `${encodeMcpFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "framed-client",
          version: "1.0.0",
        },
      },
    })}${encodeMcpFrame({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })}${encodeMcpFrame({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })}`,
  );

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);

  const responses = decodeMcpFrames(output) as Array<{
    result: {
      protocolVersion?: string;
      serverInfo?: { name: string };
      tools?: Array<{ name: string }>;
    };
  }>;
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.protocolVersion, "2025-11-25");
  assert.equal(responses[0].result.serverInfo?.name, "google-tool");
  assert.deepEqual(
    responses[1].result.tools?.map((tool) => tool.name),
    [
      "whoami",
      "list_gmail_messages",
      "list_gmail_labels",
      "read_gmail_message",
      "list_gmail_attachments",
      "read_gmail_attachment_text",
      "download_gmail_attachment",
      "get_drive_about",
      "list_drive_files",
      "read_drive_file",
    ],
  );
});

test("runMcpServer emits OAuth guidance when a tool call starts browser auth", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.setEncoding("utf-8");
  stdout.on("data", (chunk) => {
    output += chunk;
  });
  const stderr: string[] = [];

  const exitCodePromise = runMcpServer(
    {
      error(message) {
        stderr.push(message);
      },
    },
    {
      homeDir: "/home/test",
      platform: "linux",
      ensureDir: async () => {},
      pathExists: async (filePath) =>
        filePath === "/home/test/.config/google-tool/credentials.json",
      stdin,
      stdout,
      ensureAuthorizedToken: async (options) => {
        if (!options.allowBrowserAuth) {
          throw new GmailAuthRequiredError("/home/test/.config/google-tool/token.json");
        }
        await options.onAuthorizationReady?.({
          authorizationUrl: "https://example.com/auth",
          browserOpened: false,
          manualInstructions:
            "Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth",
          redirectUri: "http://127.0.0.1:43123/callback",
        });
        return {
          source: "interactive",
          token: {
            access_token: "access-token",
            refresh_token: "refresh-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  stdin.end(
    `${encodeMcpFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "auth-client",
          version: "1.0.0",
        },
      },
    })}${encodeMcpFrame({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })}${encodeMcpFrame({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "list_gmail_labels",
        arguments: {},
      },
    })}`,
  );

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.deepEqual(decodeMcpFrames(output), [
    {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "google-tool",
          version: "0.1.0",
        },
        instructions:
          "Read Gmail messages, supported Gmail text attachments, and Google Drive file metadata from the authorized account. If OAuth is not initialized, configure credentials first: place credentials.json in the config directory or set GOOGLE_TOOL_CREDENTIALS. GOOGLE_TOOL_PROFILE selects a profile, GOOGLE_TOOL_TOKEN can point to an existing token, and the first tool call can launch browser auth after credentials are configured.",
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [
          {
            type: "text",
            text:
              "RuntimeError: Google authorization has started. Complete it in the browser. After completing Google authorization, retry the same request.",
          },
        ],
        isError: true,
      },
    },
  ]);
  assert.deepEqual(stderr, [
    "google-tool-mcp: starting stdio MCP server",
    "google-tool-mcp: config dir: /home/test/.config/google-tool",
    "google-tool-mcp: credentials: found at /home/test/.config/google-tool/credentials.json",
    "google-tool-mcp: token: missing at /home/test/.config/google-tool/token.json",
    "google-tool-mcp: features: gmail=enabled, drive=enabled",
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
    "google-tool-mcp: received initialize request",
    "google-tool-mcp: sent initialize response",
    "google-tool-mcp: received initialized notification",
    "Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth",
    "google-tool-mcp: stdin closed",
  ]);
});

test("runMcpServer emits startup diagnostics to stderr-compatible io", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr: string[] = [];

  const exitCodePromise = runMcpServer(
    {
      error(message) {
        stderr.push(message);
      },
    },
    {
      homeDir: "/home/test",
      platform: "linux",
      pathExists: async (filePath) =>
        filePath === "/home/test/.config/google-tool/credentials.json",
      stdin,
      stdout,
    },
  );

  stdin.end();

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, [
    "google-tool-mcp: starting stdio MCP server",
    "google-tool-mcp: config dir: /home/test/.config/google-tool",
    "google-tool-mcp: credentials: found at /home/test/.config/google-tool/credentials.json",
    "google-tool-mcp: token: missing at /home/test/.config/google-tool/token.json",
    "google-tool-mcp: features: gmail=enabled, drive=enabled",
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
    "google-tool-mcp: stdin closed",
  ]);
});

test("runMcpServer emits profiled startup diagnostics when GOOGLE_TOOL_PROFILE is set", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr: string[] = [];

  const exitCodePromise = runMcpServer(
    {
      error(message) {
        stderr.push(message);
      },
    },
    {
      env: {
        GOOGLE_TOOL_PROFILE: "work",
      },
      homeDir: "/home/test",
      platform: "linux",
      pathExists: async (filePath) =>
        filePath === "/home/test/.config/google-tool/profiles/work/token.json",
      stdin,
      stdout,
    },
  );

  stdin.end();

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, [
    "google-tool-mcp: starting stdio MCP server",
    "google-tool-mcp: config dir: /home/test/.config/google-tool/profiles/work",
    "google-tool-mcp: credentials: missing at /home/test/.config/google-tool/credentials.json",
    "google-tool-mcp: token: found at /home/test/.config/google-tool/profiles/work/token.json",
    "google-tool-mcp: features: gmail=enabled, drive=enabled",
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
    "google-tool-mcp: stdin closed",
  ]);
});

test("runMcpServer prefers explicit profileName over GOOGLE_TOOL_PROFILE", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr: string[] = [];

  const exitCodePromise = runMcpServer(
    {
      error(message) {
        stderr.push(message);
      },
    },
    {
      env: {
        GOOGLE_TOOL_PROFILE: "personal",
      },
      homeDir: "/home/test",
      platform: "linux",
      profileName: "work",
      pathExists: async (filePath) =>
        filePath === "/home/test/.config/google-tool/profiles/work/token.json",
      stdin,
      stdout,
    },
  );

  stdin.end();

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, [
    "google-tool-mcp: starting stdio MCP server",
    "google-tool-mcp: config dir: /home/test/.config/google-tool/profiles/work",
    "google-tool-mcp: credentials: missing at /home/test/.config/google-tool/credentials.json",
    "google-tool-mcp: token: found at /home/test/.config/google-tool/profiles/work/token.json",
    "google-tool-mcp: features: gmail=enabled, drive=enabled",
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
    "google-tool-mcp: stdin closed",
  ]);
});

test("runMcpServer prefers profiled credentials when they exist", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr: string[] = [];

  const exitCodePromise = runMcpServer(
    {
      error(message) {
        stderr.push(message);
      },
    },
    {
      env: {
        GOOGLE_TOOL_PROFILE: "work",
      },
      homeDir: "/home/test",
      platform: "linux",
      pathExists: async (filePath) =>
        filePath === "/home/test/.config/google-tool/profiles/work/credentials.json" ||
        filePath === "/home/test/.config/google-tool/profiles/work/token.json",
      stdin,
      stdout,
    },
  );

  stdin.end();

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, [
    "google-tool-mcp: starting stdio MCP server",
    "google-tool-mcp: config dir: /home/test/.config/google-tool/profiles/work",
    "google-tool-mcp: credentials: found at /home/test/.config/google-tool/profiles/work/credentials.json",
    "google-tool-mcp: token: found at /home/test/.config/google-tool/profiles/work/token.json",
    "google-tool-mcp: features: gmail=enabled, drive=enabled",
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
    "google-tool-mcp: stdin closed",
  ]);
});

test("runMcpServer emits feature diagnostics for disabled tool groups", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr: string[] = [];

  const exitCodePromise = runMcpServer(
    {
      error(message) {
        stderr.push(message);
      },
    },
    {
      gmailEnabled: false,
      driveEnabled: true,
      homeDir: "/home/test",
      platform: "linux",
      stdin,
      stdout,
    },
  );

  stdin.end();

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, [
    "google-tool-mcp: starting stdio MCP server",
    "google-tool-mcp: config dir: /home/test/.config/google-tool",
    "google-tool-mcp: credentials: missing at /home/test/.config/google-tool/credentials.json",
    "google-tool-mcp: token: missing at /home/test/.config/google-tool/token.json",
    "google-tool-mcp: features: gmail=disabled, drive=enabled",
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
    "google-tool-mcp: stdin closed",
  ]);
});

test("runMcpServer emits initialize handshake diagnostics", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr: string[] = [];

  const exitCodePromise = runMcpServer(
    {
      error(message) {
        stderr.push(message);
      },
    },
    {
      homeDir: "/home/diag",
      platform: "linux",
      stdin,
      stdout,
      pathExists: async () => false,
    },
  );

  stdin.end(
    `${encodeMcpFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "diag-client",
          version: "1.0.0",
        },
      },
    })}${encodeMcpFrame({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })}`,
  );

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, [
    "google-tool-mcp: starting stdio MCP server",
    "google-tool-mcp: config dir: /home/diag/.config/google-tool",
    "google-tool-mcp: credentials: missing at /home/diag/.config/google-tool/credentials.json",
    "google-tool-mcp: token: missing at /home/diag/.config/google-tool/token.json",
    "google-tool-mcp: features: gmail=enabled, drive=enabled",
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
    "google-tool-mcp: received initialize request",
    "google-tool-mcp: sent initialize response",
    "google-tool-mcp: received initialized notification",
    "google-tool-mcp: stdin closed",
  ]);
});
