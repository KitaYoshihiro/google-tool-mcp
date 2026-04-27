import test from "node:test";
import assert from "node:assert/strict";

import { createDriveApiClient, DriveApiError } from "../src/drive/client";

test("drive client loads about metadata with auth headers", async () => {
  const requests: Array<{ url: string; headers: Record<string, string> | undefined }> = [];

  const client = createDriveApiClient({
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
            user: {
              displayName: "Alice",
            },
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const about = await client.getAbout();

  assert.deepEqual(about, {
    user: {
      displayName: "Alice",
    },
  });
  assert.deepEqual(requests, [
    {
      url:
        "https://www.googleapis.com/drive/v3/about?fields=storageQuota%28limit%2Cusage%2CusageInDrive%2CusageInDriveTrash%29%2Cuser%28displayName%2CemailAddress%2Cme%2CpermissionId%2CphotoLink%29",
      headers: {
        authorization: "Bearer access-token",
      },
    },
  ]);
});

test("drive client forwards list query parameters", async () => {
  const requests: string[] = [];

  const client = createDriveApiClient({
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
            files: [{ id: "file-001", name: "Quarterly Plan" }],
            nextPageToken: "page-2",
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const result = await client.listFiles({
    corpora: "drive",
    driveId: "drive-123",
    includeItemsFromAllDrives: true,
    includeTrashed: false,
    maxResults: 25,
    orderBy: "modifiedTime desc",
    query: "name contains 'Plan'",
  });

  assert.deepEqual(result, {
    files: [{ id: "file-001", name: "Quarterly Plan" }],
    nextPageToken: "page-2",
  });
  assert.deepEqual(requests, [
    "https://www.googleapis.com/drive/v3/files?corpora=drive&fields=files%28createdTime%2Cdescription%2CdriveId%2CfolderColorRgb%2CiconLink%2Cid%2CmimeType%2CmodifiedTime%2Cname%2CownedByMe%2Cowners%28displayName%2CemailAddress%2Cme%2CpermissionId%2CphotoLink%29%2Cparents%2CresourceKey%2Cshared%2CshortcutDetails%28targetId%2CtargetMimeType%2CtargetResourceKey%29%2Csize%2Cstarred%2CthumbnailLink%2Ctrashed%2CwebViewLink%29%2CincompleteSearch%2CnextPageToken&pageSize=25&supportsAllDrives=true&q=%28name+contains+%27Plan%27%29+and+trashed+%3D+false&driveId=drive-123&includeItemsFromAllDrives=true&orderBy=modifiedTime+desc",
  ]);
});

test("drive client loads file metadata by id", async () => {
  const requests: string[] = [];

  const client = createDriveApiClient({
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
            id: "file-001",
            name: "Quarterly Plan",
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const file = await client.getFile("file-001");

  assert.deepEqual(file, {
    id: "file-001",
    name: "Quarterly Plan",
  });
  assert.deepEqual(requests, [
    "https://www.googleapis.com/drive/v3/files/file-001?fields=createdTime%2Cdescription%2CdriveId%2CfolderColorRgb%2CiconLink%2Cid%2CmimeType%2CmodifiedTime%2Cname%2CownedByMe%2Cowners%28displayName%2CemailAddress%2Cme%2CpermissionId%2CphotoLink%29%2Cparents%2CresourceKey%2Cshared%2CshortcutDetails%28targetId%2CtargetMimeType%2CtargetResourceKey%29%2Csize%2Cstarred%2CthumbnailLink%2Ctrashed%2CwebViewLink&supportsAllDrives=true",
  ]);
});

test("drive client surfaces non-2xx responses as DriveApiError", async () => {
  const client = createDriveApiClient({
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
    client.getAbout(),
    (error: unknown) =>
      error instanceof DriveApiError &&
      error.status === 403 &&
      error.message === "forbidden",
  );
});
