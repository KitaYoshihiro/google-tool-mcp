import test from "node:test";
import assert from "node:assert/strict";

import {
  GmailLabelLookupError,
  normalizeLabelList,
  resolveLabelIds,
} from "../src/gmail/labels";

test("normalizeLabelList sorts system labels first, then by name and id", () => {
  const result = normalizeLabelList([
    { id: "Label_2", name: "Receipts", type: "user" },
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "Label_1", name: "Projects", type: "user" },
  ]);

  assert.equal(result.count, 3);
  assert.deepEqual(result.labels, [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "Label_1", name: "Projects", type: "user" },
    { id: "Label_2", name: "Receipts", type: "user" },
  ]);
});

test("resolveLabelIds returns an empty list when no labels are requested", () => {
  assert.deepEqual(
    resolveLabelIds([], [
      { id: "INBOX", name: "INBOX", type: "system" },
    ]),
    [],
  );
});

test("resolveLabelIds matches labels by exact id", () => {
  assert.deepEqual(
    resolveLabelIds(["INBOX"], [
      { id: "INBOX", name: "INBOX", type: "system" },
    ]),
    ["INBOX"],
  );
});

test("resolveLabelIds matches labels by exact display name", () => {
  assert.deepEqual(
    resolveLabelIds(["Projects"], [
      { id: "Label_1", name: "Projects", type: "user" },
    ]),
    ["Label_1"],
  );
});

test("resolveLabelIds matches labels by case-insensitive unique name", () => {
  assert.deepEqual(
    resolveLabelIds(["projects"], [
      { id: "Label_1", name: "Projects", type: "user" },
    ]),
    ["Label_1"],
  );
});

test("resolveLabelIds reports missing labels with available user labels", () => {
  assert.throws(
    () =>
      resolveLabelIds(["Missing"], [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "Label_1", name: "Projects", type: "user" },
        { id: "Label_2", name: "Receipts", type: "user" },
      ]),
    (error: unknown) =>
      error instanceof GmailLabelLookupError &&
      /not found: Missing/.test(error.message) &&
      /available user labels: Projects, Receipts/.test(error.message),
  );
});

test("resolveLabelIds reports ambiguous case-insensitive matches", () => {
  assert.throws(
    () =>
      resolveLabelIds(["projects"], [
        { id: "Label_1", name: "Projects", type: "user" },
        { id: "Label_2", name: "PROJECTS", type: "user" },
      ]),
    (error: unknown) =>
      error instanceof GmailLabelLookupError &&
      /ambiguous: projects/.test(error.message),
  );
});

test("resolveLabelIds reports missing and ambiguous labels in one error", () => {
  assert.throws(
    () =>
      resolveLabelIds(["Missing", "projects"], [
        { id: "Label_1", name: "Projects", type: "user" },
        { id: "Label_2", name: "PROJECTS", type: "user" },
      ]),
    (error: unknown) =>
      error instanceof GmailLabelLookupError &&
      /not found: Missing/.test(error.message) &&
      /ambiguous: projects/.test(error.message),
  );
});
