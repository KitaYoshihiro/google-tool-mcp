import test from "node:test";
import assert from "node:assert/strict";

import {
  listGmailAttachments,
  readGmailAttachmentText,
} from "../src/gmail/attachments";

function encodeAttachment(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

test("listGmailAttachments extracts text support metadata", () => {
  const result = listGmailAttachments({
    id: "msg-001",
    payload: {
      parts: [
        {
          filename: "notes.txt",
          mimeType: "application/octet-stream",
          partId: "1",
          body: {
            attachmentId: "att-001",
            size: 12,
          },
        },
        {
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          partId: "2",
          body: {
            attachmentId: "att-002",
            size: 1024,
          },
        },
      ],
    },
  });

  assert.deepEqual(result, {
    count: 2,
    message_id: "msg-001",
    attachments: [
      {
        filename: "notes.txt",
        mime_type: "application/octet-stream",
        part_id: "1",
        size: 12,
        text_supported: true,
        text_format: "plain",
      },
      {
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        part_id: "2",
        size: 1024,
        text_supported: false,
        text_format: "",
      },
    ],
  });
});

test("readGmailAttachmentText decodes supported text attachments", () => {
  const message = {
    id: "msg-001",
    payload: {
      parts: [
        {
          filename: "summary.html",
          mimeType: "text/html",
          partId: "1",
          headers: [
            { name: "Content-Type", value: "text/html; charset=utf-8" },
          ],
          body: {
            attachmentId: "att-001",
            size: 32,
          },
        },
      ],
    },
  };

  const result = readGmailAttachmentText({
    message,
    maxBytes: 1024,
    maxChars: 100,
    partId: "1",
    attachment: {
      data: encodeAttachment("<p>Hello<br>Team &amp; Friends</p>"),
      size: 32,
    },
  });

  assert.deepEqual(result, {
    filename: "summary.html",
    message_id: "msg-001",
    mime_type: "text/html",
    part_id: "1",
    size: 32,
    text: "Hello\nTeam & Friends",
    text_chars: 20,
    text_format: "html",
    text_truncated: false,
  });
});

test("readGmailAttachmentText rejects unsupported attachment types", () => {
  assert.throws(
    () =>
      readGmailAttachmentText({
        message: {
          id: "msg-001",
          payload: {
            filename: "scan.pdf",
            mimeType: "application/pdf",
            partId: "1",
            body: {
              attachmentId: "att-001",
              size: 1024,
            },
          },
        },
        maxBytes: 1024,
        maxChars: 100,
        partId: "1",
        attachment: {
          data: encodeAttachment("%PDF"),
          size: 1024,
        },
      }),
    /Attachment is not a supported text type: application\/pdf\./u,
  );
});
