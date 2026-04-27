"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriveApiError = void 0;
exports.createDriveApiClient = createDriveApiClient;
class DriveApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = "DriveApiError";
        this.status = status;
    }
}
exports.DriveApiError = DriveApiError;
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
];
const DRIVE_FILE_LIST_FIELDS = `files(${DRIVE_FILE_FIELDS.join(",")}),incompleteSearch,nextPageToken`;
const DRIVE_ABOUT_FIELDS = "storageQuota(limit,usage,usageInDrive,usageInDriveTrash),user(displayName,emailAddress,me,permissionId,photoLink)";
function normalizeHeaders(headers) {
    if (headers instanceof Headers) {
        return Object.fromEntries(headers.entries());
    }
    return headers;
}
async function requestJson(fetchLike, getRequestHeaders, url) {
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
function buildDriveQuery(query, includeTrashed) {
    const trimmedQuery = query.trim();
    if (includeTrashed) {
        return trimmedQuery;
    }
    if (!trimmedQuery) {
        return "trashed = false";
    }
    return `(${trimmedQuery}) and trashed = false`;
}
function createDriveApiClient(options) {
    const baseUrl = options.baseUrl ?? "https://www.googleapis.com/drive/v3";
    const fetchLike = options.fetch ?? globalThis.fetch;
    return {
        async getAbout() {
            const url = new URL(`${baseUrl}/about`);
            url.searchParams.set("fields", DRIVE_ABOUT_FIELDS);
            return (await requestJson(fetchLike, options.getRequestHeaders, url.toString()));
        },
        async listFiles({ corpora, driveId, includeItemsFromAllDrives, includeTrashed, maxResults, orderBy, query, }) {
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
            if (includeItemsFromAllDrives ||
                corpora === "allDrives" ||
                corpora === "drive" ||
                driveId) {
                url.searchParams.set("includeItemsFromAllDrives", "true");
            }
            if (orderBy) {
                url.searchParams.set("orderBy", orderBy);
            }
            return (await requestJson(fetchLike, options.getRequestHeaders, url.toString()));
        },
        async getFile(fileId) {
            const url = new URL(`${baseUrl}/files/${encodeURIComponent(fileId)}`);
            url.searchParams.set("fields", DRIVE_FILE_FIELDS.join(","));
            url.searchParams.set("supportsAllDrives", "true");
            return (await requestJson(fetchLike, options.getRequestHeaders, url.toString()));
        },
    };
}
