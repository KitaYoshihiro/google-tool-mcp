import test from "node:test";
import assert from "node:assert/strict";

import { createGmailApiClient, GmailApiError } from "../src/gmail/client";

test("gmail client loads the authorized profile", async () => {
  const requests: Array<{ url: string; headers: Record<string, string> | undefined }> = [];

  const client = createGmailApiClient({
    getRequestHeaders: async () => ({
      authorization: "Bearer access-token",
    }),
    fetch: async (url, init) => {
      requests.push({
        url,
        headers: init?.headers as Record<string, string> | undefined,
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            emailAddress: "work@example.com",
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const profile = await client.getProfile();

  assert.deepEqual(profile, {
    emailAddress: "work@example.com",
  });
  assert.deepEqual(requests, [
    {
      url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      headers: {
        authorization: "Bearer access-token",
      },
    },
  ]);
});

test("gmail client loads labels with auth headers", async () => {
  const requests: Array<{ url: string; headers: Record<string, string> | undefined }> = [];

  const client = createGmailApiClient({
    getRequestHeaders: async () => ({
      authorization: "Bearer access-token",
    }),
    fetch: async (url, init) => {
      requests.push({
        url,
        headers: init?.headers as Record<string, string> | undefined,
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            labels: [
              { id: "INBOX", name: "INBOX", type: "system" },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const labels = await client.listLabels();

  assert.deepEqual(labels, [
    { id: "INBOX", name: "INBOX", type: "system" },
  ]);
  assert.deepEqual(requests, [
    {
      url: "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      headers: {
        authorization: "Bearer access-token",
      },
    },
  ]);
});

test("gmail client paginates message ids and forwards query parameters", async () => {
  const requests: string[] = [];

  const client = createGmailApiClient({
    getRequestHeaders: async () => ({
      authorization: "Bearer access-token",
    }),
    fetch: async (url) => {
      requests.push(url);
      const parsed = new URL(url);
      const pageToken = parsed.searchParams.get("pageToken");

      return {
        ok: true,
        status: 200,
        async json() {
          if (!pageToken) {
            return {
              messages: [{ id: "msg-001" }, { id: "msg-002" }],
              nextPageToken: "page-2",
            };
          }

          return {
            messages: [{ id: "msg-003" }],
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const messageIds = await client.listMessageIds({
    maxResults: 3,
    query: "is:unread",
    labelIds: ["INBOX", "Label_1"],
  });

  assert.deepEqual(messageIds, ["msg-001", "msg-002", "msg-003"]);
  assert.deepEqual(requests, [
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=3&q=is%3Aunread&labelIds=INBOX&labelIds=Label_1",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=is%3Aunread&labelIds=INBOX&labelIds=Label_1&pageToken=page-2",
  ]);
});

test("gmail client skips message listing when maxResults is not positive", async () => {
  let fetchCalled = false;

  const client = createGmailApiClient({
    getRequestHeaders: async () => ({
      authorization: "Bearer access-token",
    }),
    fetch: async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    },
  });

  const messageIds = await client.listMessageIds({
    maxResults: 0,
    query: "",
    labelIds: [],
  });

  assert.deepEqual(messageIds, []);
  assert.equal(fetchCalled, false);
});

test("gmail client loads a full message by id", async () => {
  const requests: string[] = [];

  const client = createGmailApiClient({
    getRequestHeaders: async () => ({
      authorization: "Bearer access-token",
    }),
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: "msg-001",
            threadId: "thread-001",
            snippet: "Hello",
            payload: {
              headers: [],
            },
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const message = await client.getMessage("msg-001");

  assert.equal(message.id, "msg-001");
  assert.deepEqual(requests, [
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-001?format=full",
  ]);
});

test("gmail client loads an attachment by id", async () => {
  const requests: string[] = [];

  const client = createGmailApiClient({
    getRequestHeaders: async () => ({
      authorization: "Bearer access-token",
    }),
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            attachmentId: "att-001",
            data: "aGVsbG8",
            size: 5,
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const attachment = await client.getAttachment("msg-001", "att-001");

  assert.deepEqual(attachment, {
    attachmentId: "att-001",
    data: "aGVsbG8",
    size: 5,
  });
  assert.deepEqual(requests, [
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-001/attachments/att-001",
  ]);
});

test("gmail client surfaces non-2xx responses as GmailApiError", async () => {
  const client = createGmailApiClient({
    getRequestHeaders: async () => ({
      authorization: "Bearer access-token",
    }),
    fetch: async () => ({
      ok: false,
      status: 403,
      async json() {
        return {};
      },
      async text() {
        return "forbidden";
      },
    }),
  });

  await assert.rejects(
    client.listLabels(),
    (error: unknown) =>
      error instanceof GmailApiError &&
      error.status === 403 &&
      error.message === "forbidden",
  );
});
