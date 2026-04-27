import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const contractsRoot = path.join(__dirname, "contracts");

function readContract(relativePath: string): string {
  return readFileSync(path.join(contractsRoot, relativePath), "utf-8");
}

test("cli contract samples match the documented baselines", () => {
  assert.equal(
    readContract("cli/list-labels.stdout"),
    "INBOX\tINBOX\tsystem\nProjects\tLabel_1\tuser\nReceipts\tLabel_2\tuser\n",
  );
  assert.equal(
    readContract("cli/query-is-unread.stdout"),
    [
      "[1] Build report",
      "From: Dev Team <dev@example.com>",
      "Date: Tue, 22 Apr 2026 09:00:00 +0900",
      "Message ID: msg-001",
      "",
      "Hello team,",
      "",
      "The nightly build passed.",
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
      "",
    ].join("\n"),
  );
  assert.equal(
    readContract("cli/query-label-missing.stdout"),
    "No messages matched the request.\n",
  );
  assert.equal(
    readContract("cli/no-body-max-results-1.stdout"),
    [
      "[1] Build report",
      "From: Dev Team <dev@example.com>",
      "Date: Tue, 22 Apr 2026 09:00:00 +0900",
      "Message ID: msg-001",
      "Snippet: The nightly build passed.",
      "",
      "--------------------------------------------------------------------------------",
      "",
    ].join("\n"),
  );
  assert.equal(
    readContract("cli/auth-error.stdout"),
    "OAuth token was not ready at /home/user/.config/google-tool/token.json. Complete Google authorization, or point GOOGLE_TOOL_TOKEN to an existing token.json file.\n",
  );
  assert.equal(
    readContract("cli/label-missing-error.stdout"),
    "Label lookup failed; not found: Missing; available user labels: Projects, Receipts\n",
  );
  assert.equal(
    readContract("cli/drive-about.stdout"),
    [
      "User: Alice Example <alice@example.com>",
      "Permission ID: permission-123",
      "Storage Usage: 250 / 1000",
      "In Drive: 200",
      "In Trash: 50",
      "",
    ].join("\n"),
  );
  assert.equal(
    readContract("cli/drive-query.stdout"),
    [
      "[1] Quarterly Plan",
      "File ID: file-001",
      "MIME Type: application/vnd.google-apps.document",
      "Modified: 2026-04-22T00:00:00.000Z",
      "Trashed: no",
      "Web View: https://drive.google.com/file/d/file-001/view",
      "Owners: Alice Example <alice@example.com>",
      "",
      "--------------------------------------------------------------------------------",
      "",
    ].join("\n"),
  );
  assert.equal(
    readContract("cli/drive-file.stdout"),
    [
      "Quarterly Plan",
      "File ID: file-001",
      "MIME Type: application/vnd.google-apps.document",
      "Modified: 2026-04-22T00:00:00.000Z",
      "Trashed: no",
      "Parents: folder-123",
      "",
      "--------------------------------------------------------------------------------",
      "",
    ].join("\n"),
  );
});

test("mcp contract samples match the documented baselines", () => {
  assert.deepEqual(
    JSON.parse(readContract("mcp/list-gmail-labels.success.json")),
    {
      count: 3,
      labels: [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "Label_1", name: "Projects", type: "user" },
        { id: "Label_2", name: "Receipts", type: "user" },
      ],
    },
  );
  assert.deepEqual(
    JSON.parse(readContract("mcp/list-gmail-messages.success.json")),
    {
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
    },
  );
  assert.deepEqual(
    JSON.parse(readContract("mcp/read-gmail-message.success.json")),
    {
      id: "msg-001",
      thread_id: "thread-001",
      subject: "Build report",
      sender: "Dev Team <dev@example.com>",
      date: "Tue, 22 Apr 2026 09:00:00 +0900",
      snippet: "The nightly build passed.",
      body: "Hello team,\n\nThe nightly build passed.",
      body_truncated: false,
    },
  );
  assert.equal(
    readContract("mcp/list-gmail-messages.auth-error.txt"),
    "RuntimeError: OAuth token was not ready at /home/user/.config/google-tool/token.json. Complete Google authorization, or point GOOGLE_TOOL_TOKEN to an existing token.json file.\n",
  );
  assert.equal(
    readContract("mcp/list-gmail-messages.label-lookup-error.txt"),
    "RuntimeError: Label lookup failed; not found: Missing; available user labels: Projects, Receipts\n",
  );
  assert.deepEqual(
    JSON.parse(readContract("mcp/get-drive-about.success.json")),
    {
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
    },
  );
  assert.deepEqual(
    JSON.parse(readContract("mcp/list-drive-files.success.json")),
    {
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
    },
  );
  assert.deepEqual(
    JSON.parse(readContract("mcp/read-drive-file.success.json")),
    {
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
    },
  );
  assert.equal(
    readContract("mcp/list-drive-files.scope-error.txt"),
    "RuntimeError: OAuth token at /home/user/.config/google-tool/token.json does not include the required Google API scopes. Reauthorize with the required scopes, or point GOOGLE_TOOL_TOKEN to a token.json file that includes them. Missing scopes: https://www.googleapis.com/auth/drive.metadata.readonly\n",
  );
});
