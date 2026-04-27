import test from "node:test";
import assert from "node:assert/strict";

import { extractMessageBody, htmlToText, truncateText } from "../src/gmail/body";

function encodePart(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

test("extractMessageBody returns the plain text body from a single-part payload", () => {
  const body = extractMessageBody({
    mimeType: "text/plain",
    body: {
      data: encodePart("Hello from Gmail"),
    },
  });

  assert.equal(body, "Hello from Gmail");
});

test("extractMessageBody prefers plain text over html", () => {
  const body = extractMessageBody({
    parts: [
      {
        mimeType: "text/html",
        body: {
          data: encodePart("<p>Hello <strong>HTML</strong></p>"),
        },
      },
      {
        mimeType: "text/plain",
        body: {
          data: encodePart("Hello plain text"),
        },
      },
    ],
  });

  assert.equal(body, "Hello plain text");
});

test("extractMessageBody falls back to html text extraction", () => {
  const body = extractMessageBody({
    mimeType: "text/html",
    body: {
      data: encodePart("<p>Hello<br>Team &amp; Friends</p>"),
    },
  });

  assert.equal(body, "Hello\nTeam & Friends");
});

test("extractMessageBody walks nested multipart structures", () => {
  const body = extractMessageBody({
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: encodePart("Nested plain text"),
            },
          },
        ],
      },
    ],
  });

  assert.equal(body, "Nested plain text");
});

test("extractMessageBody returns an empty string when part data is missing", () => {
  const body = extractMessageBody({
    mimeType: "text/plain",
    body: {},
  });

  assert.equal(body, "");
});

test("htmlToText removes scripts/styles, preserves paragraphs, and decodes entities", () => {
  const text = htmlToText(
    "<style>p{color:red}</style><script>alert('x')</script><p>Hello&nbsp;team</p><p>Line &lt;two&gt;<br>break</p>",
  );

  assert.equal(text, "Hello team\n\nLine <two>\nbreak");
});

test("extractMessageBody joins multiple plain text parts with blank lines", () => {
  const body = extractMessageBody({
    parts: [
      {
        mimeType: "text/plain",
        body: {
          data: encodePart("First part"),
        },
      },
      {
        mimeType: "text/plain",
        body: {
          data: encodePart("Second part"),
        },
      },
    ],
  });

  assert.equal(body, "First part\n\nSecond part");
});

test("truncateText keeps the original value when limit is zero", () => {
  assert.deepEqual(truncateText("Hello", 0), {
    value: "Hello",
    truncated: false,
  });
});

test("truncateText returns the original value when it already fits", () => {
  assert.deepEqual(truncateText("Hello", 5), {
    value: "Hello",
    truncated: false,
  });
});

test("truncateText hard-cuts when the limit is three characters or fewer", () => {
  assert.deepEqual(truncateText("Hello", 3), {
    value: "Hel",
    truncated: true,
  });
});

test("truncateText appends an ellipsis when truncating longer output", () => {
  assert.deepEqual(truncateText("Hello world", 8), {
    value: "Hello...",
    truncated: true,
  });
});
