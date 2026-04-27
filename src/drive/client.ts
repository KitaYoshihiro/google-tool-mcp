export class DriveApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

export interface RawDriveUser {
  displayName?: string;
  emailAddress?: string;
  me?: boolean;
  permissionId?: string;
  photoLink?: string;
}

export interface RawDriveStorageQuota {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
  usageInDriveTrash?: string;
}

export interface RawDriveShortcutDetails {
  targetId?: string;
  targetMimeType?: string;
  targetResourceKey?: string;
}

export interface RawDriveFile {
  createdTime?: string;
  description?: string;
  driveId?: string;
  folderColorRgb?: string;
  iconLink?: string;
  id?: string;
  mimeType?: string;
  modifiedTime?: string;
  name?: string;
  ownedByMe?: boolean;
  owners?: RawDriveUser[];
  parents?: string[];
  resourceKey?: string;
  shared?: boolean;
  shortcutDetails?: RawDriveShortcutDetails;
  size?: string;
  starred?: boolean;
  thumbnailLink?: string;
  trashed?: boolean;
  webViewLink?: string;
}

export interface RawDriveFileList {
  files?: RawDriveFile[];
  incompleteSearch?: boolean;
  nextPageToken?: string;
}

export interface RawDriveAbout {
  storageQuota?: RawDriveStorageQuota;
  user?: RawDriveUser;
}

export interface DriveApiClient {
  getAbout(): Promise<RawDriveAbout>;
  getFile(fileId: string): Promise<RawDriveFile>;
  listFiles(options: {
    corpora: "allDrives" | "domain" | "drive" | "user";
    driveId?: string;
    includeItemsFromAllDrives: boolean;
    includeTrashed: boolean;
    maxResults: number;
    orderBy: string;
    query: string;
  }): Promise<RawDriveFileList>;
}

interface FetchLikeResponse {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
    method?: string;
  },
) => Promise<FetchLikeResponse>;

const DRIVE_FILE_FIELDS = [
  "createdTime",
  "description",
  "driveId",
  "folderColorRgb",
  "iconLink",
  "id",
  "mimeType",
  "modifiedTime",
  "name",
  "ownedByMe",
  "owners(displayName,emailAddress,me,permissionId,photoLink)",
  "parents",
  "resourceKey",
  "shared",
  "shortcutDetails(targetId,targetMimeType,targetResourceKey)",
  "size",
  "starred",
  "thumbnailLink",
  "trashed",
  "webViewLink",
] as const;

const DRIVE_FILE_LIST_FIELDS = `files(${DRIVE_FILE_FIELDS.join(",")}),incompleteSearch,nextPageToken`;
const DRIVE_ABOUT_FIELDS =
  "storageQuota(limit,usage,usageInDrive,usageInDriveTrash),user(displayName,emailAddress,me,permissionId,photoLink)";

function normalizeHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return headers;
}

async function requestJson(
  fetchLike: FetchLike,
  getRequestHeaders: (url: string) => Promise<Headers | Record<string, string>>,
  url: string,
): Promise<unknown> {
  const headers = normalizeHeaders(await getRequestHeaders(url));
  const response = await fetchLike(url, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new DriveApiError(response.status, message || `HTTP ${response.status}`);
  }

  return response.json();
}

function buildDriveQuery(query: string, includeTrashed: boolean): string {
  const trimmedQuery = query.trim();
  if (includeTrashed) {
    return trimmedQuery;
  }

  if (!trimmedQuery) {
    return "trashed = false";
  }

  return `(${trimmedQuery}) and trashed = false`;
}

export function createDriveApiClient(options: {
  baseUrl?: string;
  fetch?: FetchLike;
  getRequestHeaders: (url: string) => Promise<Headers | Record<string, string>>;
}): DriveApiClient {
  const baseUrl = options.baseUrl ?? "https://www.googleapis.com/drive/v3";
  const fetchLike = options.fetch ?? (globalThis.fetch as FetchLike);

  return {
    async getAbout(): Promise<RawDriveAbout> {
      const url = new URL(`${baseUrl}/about`);
      url.searchParams.set("fields", DRIVE_ABOUT_FIELDS);

      return (await requestJson(
        fetchLike,
        options.getRequestHeaders,
        url.toString(),
      )) as RawDriveAbout;
    },

    async listFiles({
      corpora,
      driveId,
      includeItemsFromAllDrives,
      includeTrashed,
      maxResults,
      orderBy,
      query,
    }: {
      corpora: "allDrives" | "domain" | "drive" | "user";
      driveId?: string;
      includeItemsFromAllDrives: boolean;
      includeTrashed: boolean;
      maxResults: number;
      orderBy: string;
      query: string;
    }): Promise<RawDriveFileList> {
      if (maxResults <= 0) {
        return {
          files: [],
          incompleteSearch: false,
        };
      }

      const url = new URL(`${baseUrl}/files`);
      url.searchParams.set("corpora", corpora);
      url.searchParams.set("fields", DRIVE_FILE_LIST_FIELDS);
      url.searchParams.set("pageSize", String(maxResults));
      url.searchParams.set("supportsAllDrives", "true");

      const effectiveQuery = buildDriveQuery(query, includeTrashed);
      if (effectiveQuery) {
        url.searchParams.set("q", effectiveQuery);
      }

      if (driveId) {
        url.searchParams.set("driveId", driveId);
      }

      if (
        includeItemsFromAllDrives ||
        corpora === "allDrives" ||
        corpora === "drive" ||
        driveId
      ) {
        url.searchParams.set("includeItemsFromAllDrives", "true");
      }

      if (orderBy) {
        url.searchParams.set("orderBy", orderBy);
      }

      return (await requestJson(
        fetchLike,
        options.getRequestHeaders,
        url.toString(),
      )) as RawDriveFileList;
    },

    async getFile(fileId: string): Promise<RawDriveFile> {
      const url = new URL(`${baseUrl}/files/${encodeURIComponent(fileId)}`);
      url.searchParams.set("fields", DRIVE_FILE_FIELDS.join(","));
      url.searchParams.set("supportsAllDrives", "true");

      return (await requestJson(
        fetchLike,
        options.getRequestHeaders,
        url.toString(),
      )) as RawDriveFile;
    },
  };
}
