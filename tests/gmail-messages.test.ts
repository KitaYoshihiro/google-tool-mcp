import test from "node:test";
import assert from "node:assert/strict";

import { createMessageList, mapRawMessage } from "../src/gmail/messages";

function encodePart(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

test("mapRawMessage omits body content when includeBody is false", () => {
  const message = mapRawMessage(
    {
      id: "msg-001",
      threadId: "thread-001",
      snippet: " Hello ",
      payload: {
        headers: [
          { name: "Subject", value: "Build report" },
          { name: "From", value: "Dev Team <dev@example.com>" },
          { name: "Date", value: "Tue, 22 Apr 2026 09:00:00 +0900" },
        ],
        mimeType: "text/plain",
        body: {
          data: encodePart("Hello team"),
        },
      },
    },
    {
      includeBody: false,
      bodyChars: 1500,
    },
  );

  assert.deepEqual(message, {
    id: "msg-001",
    thread_id: "thread-001",
    subject: "Build report",
    sender: "Dev Team <dev@example.com>",
    date: "Tue, 22 Apr 2026 09:00:00 +0900",
    snippet: "Hello",
    body: "",
    body_truncated: false,
  });
});

test("mapRawMessage applies fallback values for missing headers", () => {
  const message = mapRawMessage(
    {
      id: "msg-001",
      threadId: "thread-001",
      snippet: "",
      payload: {
        headers: [],
      },
    },
    {
      includeBody: true,
      bodyChars: 1500,
    },
  );

  assert.equal(message.subject, "(no subject)");
  assert.equal(message.sender, "(unknown sender)");
  assert.equal(message.date, "(unknown date)");
});

test("mapRawMessage prefers body content, then snippet, then a fallback marker", () => {
  const withBody = mapRawMessage(
    {
      id: "msg-001",
      threadId: "thread-001",
      snippet: "Snippet text",
      payload: {
        headers: [],
        mimeType: "text/plain",
        body: {
          data: encodePart("Body text"),
        },
      },
    },
    {
      includeBody: true,
      bodyChars: 1500,
    },
  );

  const withoutBody = mapRawMessage(
    {
      id: "msg-002",
      threadId: "thread-002",
      snippet: "Snippet text",
      payload: {
        headers: [],
      },
    },
    {
      includeBody: true,
      bodyChars: 1500,
    },
  );

  const withoutAnything = mapRawMessage(
    {
      id: "msg-003",
      threadId: "thread-003",
      snippet: "",
      payload: {
        headers: [],
      },
    },
    {
      includeBody: true,
      bodyChars: 1500,
    },
  );

  assert.equal(withBody.body, "Body text");
  assert.equal(withoutBody.body, "");
  assert.equal(withoutAnything.body, "");
});

test("mapRawMessage truncates long bodies using the shared truncate logic", () => {
  const message = mapRawMessage(
    {
      id: "msg-001",
      threadId: "thread-001",
      snippet: "Snippet text",
      payload: {
        headers: [],
        mimeType: "text/plain",
        body: {
          data: encodePart("Hello world"),
        },
      },
    },
    {
      includeBody: true,
      bodyChars: 8,
    },
  );

  assert.equal(message.body, "Hello...");
  assert.equal(message.body_truncated, true);
});

test("createMessageList preserves query and label metadata", () => {
  const result = createMessageList({
    query: "is:unread",
    labels: ["Projects"],
    resolvedLabelIds: ["Label_1"],
    rawMessages: [
      {
        id: "msg-001",
        threadId: "thread-001",
        snippet: " Hello ",
        payload: {
          headers: [
            { name: "Subject", value: "Build report" },
          ],
        },
      },
    ],
    includeBody: false,
    bodyChars: 1500,
  });

  assert.deepEqual(result, {
    count: 1,
    query: "is:unread",
    labels: ["Projects"],
    resolved_label_ids: ["Label_1"],
    messages: [
      {
        id: "msg-001",
        thread_id: "thread-001",
        subject: "Build report",
        sender: "(unknown sender)",
        date: "(unknown date)",
        snippet: "Hello",
        body: "",
        body_truncated: false,
      },
    ],
  });
});

test("createMessageList returns an empty list when maxResults is not positive", () => {
  const result = createMessageList({
    query: "is:unread",
    labels: ["INBOX"],
    resolvedLabelIds: ["INBOX"],
    rawMessages: [
      {
        id: "msg-001",
        threadId: "thread-001",
        snippet: "Hello",
        payload: {
          headers: [],
        },
      },
    ],
    includeBody: false,
    bodyChars: 1500,
    maxResults: 0,
  });

  assert.deepEqual(result, {
    count: 0,
    query: "is:unread",
    labels: ["INBOX"],
    resolved_label_ids: ["INBOX"],
    messages: [],
  });
});
