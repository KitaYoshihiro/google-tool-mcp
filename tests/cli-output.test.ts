import test from "node:test";
import assert from "node:assert/strict";

import { DriveApiError } from "../src/drive/client";
import { GmailApiError } from "../src/gmail/client";
import { runCli } from "../src/cli";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      out(message: string) {
        stdout.push(message);
      },
      error(message: string) {
        stderr.push(message);
      },
    },
    stdout,
    stderr,
  };
}

test("cli prints labels as tab-separated rows", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--list-labels"],
    io,
    {
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
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    "INBOX\tINBOX\tsystem",
    "Projects\tLabel_1\tuser",
    "Receipts\tLabel_2\tuser",
  ]);
  assert.deepEqual(stderr, []);
});

test("cli prints a no-messages notice when the filtered result is empty", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--query", "label:missing"],
    io,
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createGmailClient: async () => ({
        async listLabels() {
          return [
            { id: "INBOX", name: "INBOX", type: "system" },
          ];
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

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["No messages matched the request."]);
  assert.deepEqual(stderr, []);
});

test("cli prints snippets when --no-body is requested", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--no-body", "--max-results", "1"],
    io,
    {
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
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    "[1] Build report",
    "From: Dev Team <dev@example.com>",
    "Date: Tue, 22 Apr 2026 09:00:00 +0900",
    "Message ID: msg-001",
    "Snippet: The nightly build passed.",
    "",
    "--------------------------------------------------------------------------------",
  ]);
  assert.deepEqual(stderr, []);
});

test("cli prints message bodies when available and falls back to snippet/body unavailable", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--max-results", "3"],
    io,
    {
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
          return ["msg-001", "msg-002", "msg-003"];
        },
        async getMessage(messageId: string) {
          if (messageId === "msg-001") {
            return {
              id: "msg-001",
              threadId: "thread-001",
              snippet: "Snippet 1",
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
          }

          if (messageId === "msg-002") {
            return {
              id: "msg-002",
              threadId: "thread-002",
              snippet: "Your invoice is ready.",
              payload: {
                headers: [
                  { name: "Subject", value: "Invoice reminder" },
                  { name: "From", value: "Billing <billing@example.com>" },
                  { name: "Date", value: "Tue, 22 Apr 2026 08:30:00 +0900" },
                ],
              },
            };
          }

          return {
            id: "msg-003",
            threadId: "thread-003",
            snippet: "",
            payload: {
              headers: [
                { name: "Subject", value: "Empty body" },
                { name: "From", value: "System <system@example.com>" },
                { name: "Date", value: "Tue, 22 Apr 2026 08:00:00 +0900" },
              ],
            },
          };
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    "[1] Build report",
    "From: Dev Team <dev@example.com>",
    "Date: Tue, 22 Apr 2026 09:00:00 +0900",
    "Message ID: msg-001",
    "",
    "Hello team,\n\nThe nightly build passed.",
    "",
    "--------------------------------------------------------------------------------",
    "[2] Invoice reminder",
    "From: Billing <billing@example.com>",
    "Date: Tue, 22 Apr 2026 08:30:00 +0900",
    "Message ID: msg-002",
    "",
    "Your invoice is ready.",
    "",
    "--------------------------------------------------------------------------------",
    "[3] Empty body",
    "From: System <system@example.com>",
    "Date: Tue, 22 Apr 2026 08:00:00 +0900",
    "Message ID: msg-003",
    "",
    "(body unavailable)",
    "",
    "--------------------------------------------------------------------------------",
  ]);
  assert.deepEqual(stderr, []);
});

test("cli prints label lookup errors as plain messages", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--label", "Missing"],
    io,
    {
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
            { id: "Label_2", name: "Receipts", type: "user" },
          ];
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

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    "Label lookup failed; not found: Missing; available user labels: Projects, Receipts",
  ]);
});

test("cli prefixes Gmail API errors", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--list-labels"],
    io,
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createGmailClient: async () => {
        throw new GmailApiError(503, "Gmail API failed upstream");
      },
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Gmail API error: Gmail API failed upstream"]);
});

test("cli prints Drive about metadata", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--drive-about"],
    io,
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createDriveClient: async () => ({
        async getAbout() {
          return {
            user: {
              displayName: "Alice Example",
              emailAddress: "alice@example.com",
              permissionId: "permission-123",
            },
            storageQuota: {
              usage: "250",
              limit: "1000",
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
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    "User: Alice Example <alice@example.com>",
    "Permission ID: permission-123",
    "Storage Usage: 250 / 1000",
    "In Drive: 200",
    "In Trash: 50",
  ]);
  assert.deepEqual(stderr, []);
});

test("cli prints Drive search results", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--drive-query", "name contains 'Plan'", "--max-results", "1"],
    io,
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createDriveClient: async () => ({
        async getAbout() {
          throw new Error("not needed");
        },
        async getFile() {
          throw new Error("not needed");
        },
        async listFiles() {
          return {
            files: [
              {
                id: "file-001",
                name: "Quarterly Plan",
                mimeType: "application/vnd.google-apps.document",
                modifiedTime: "2026-04-22T00:00:00.000Z",
                webViewLink: "https://drive.google.com/file/d/file-001/view",
                owners: [
                  {
                    displayName: "Alice Example",
                    emailAddress: "alice@example.com",
                  },
                ],
              },
            ],
          };
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    "[1] Quarterly Plan",
    "File ID: file-001",
    "MIME Type: application/vnd.google-apps.document",
    "Modified: 2026-04-22T00:00:00.000Z",
    "Trashed: no",
    "Web View: https://drive.google.com/file/d/file-001/view",
    "Owners: Alice Example <alice@example.com>",
    "",
    "--------------------------------------------------------------------------------",
  ]);
  assert.deepEqual(stderr, []);
});

test("cli prints a no-files notice when the Drive result is empty", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--drive-query", "name contains 'Missing'"],
    io,
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createDriveClient: async () => ({
        async getAbout() {
          throw new Error("not needed");
        },
        async getFile() {
          throw new Error("not needed");
        },
        async listFiles() {
          return {
            files: [],
          };
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["No Drive files matched the request."]);
  assert.deepEqual(stderr, []);
});

test("cli prints a Drive file metadata record", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--drive-file-id", "file-001"],
    io,
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createDriveClient: async () => ({
        async getAbout() {
          throw new Error("not needed");
        },
        async getFile(fileId: string) {
          assert.equal(fileId, "file-001");
          return {
            id: "file-001",
            name: "Quarterly Plan",
            mimeType: "application/vnd.google-apps.document",
            modifiedTime: "2026-04-22T00:00:00.000Z",
            parents: ["folder-123"],
          };
        },
        async listFiles() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    "Quarterly Plan",
    "File ID: file-001",
    "MIME Type: application/vnd.google-apps.document",
    "Modified: 2026-04-22T00:00:00.000Z",
    "Trashed: no",
    "Parents: folder-123",
    "",
    "--------------------------------------------------------------------------------",
  ]);
  assert.deepEqual(stderr, []);
});

test("cli prefixes Drive API errors", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--drive-about"],
    io,
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createDriveClient: async () => {
        throw new DriveApiError(503, "Drive API failed upstream");
      },
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Drive API error: Drive API failed upstream"]);
});

test("cli rejects mixing Drive and Gmail flags", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(
    ["--drive-query", "name contains 'Plan'", "--label", "Projects"],
    io,
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    "Drive options cannot be combined with Gmail-specific flags.",
  ]);
});

test("cli rejects negative body char limits", async () => {
  const { io, stdout, stderr } = createIo();

  const exitCode = await runCli(["--body-chars", "-1"], io);

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Invalid non-negative integer for --body-chars: -1"]);
});
