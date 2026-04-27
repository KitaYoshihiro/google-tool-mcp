"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailApiError = void 0;
exports.createGmailApiClient = createGmailApiClient;
class GmailApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = "GmailApiError";
        this.status = status;
    }
}
exports.GmailApiError = GmailApiError;
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
        throw new GmailApiError(response.status, message || `HTTP ${response.status}`);
    }
    return response.json();
}
function createGmailApiClient(options) {
    const baseUrl = options.baseUrl ?? "https://gmail.googleapis.com/gmail/v1";
    const fetchLike = options.fetch ?? globalThis.fetch;
    return {
        async getProfile() {
            const url = `${baseUrl}/users/me/profile`;
            return (await requestJson(fetchLike, options.getRequestHeaders, url));
        },
        async listLabels() {
            const url = `${baseUrl}/users/me/labels`;
            const response = (await requestJson(fetchLike, options.getRequestHeaders, url));
            return (response.labels ?? []).map((label) => ({
                id: label.id ?? "",
                name: label.name ?? "",
                type: label.type ?? "",
            }));
        },
        async listMessageIds({ maxResults, query, labelIds, }) {
            if (maxResults <= 0) {
                return [];
            }
            const messageIds = [];
            let pageToken;
            while (messageIds.length < maxResults) {
                const url = new URL(`${baseUrl}/users/me/messages`);
                url.searchParams.set("maxResults", String(Math.min(500, maxResults - messageIds.length)));
                if (query) {
                    url.searchParams.set("q", query);
                }
                for (const labelId of labelIds) {
                    url.searchParams.append("labelIds", labelId);
                }
                if (pageToken) {
                    url.searchParams.set("pageToken", pageToken);
                }
                const response = (await requestJson(fetchLike, options.getRequestHeaders, url.toString()));
                for (const message of response.messages ?? []) {
                    if (message.id) {
                        messageIds.push(message.id);
                    }
                }
                if (!response.nextPageToken) {
                    break;
                }
                pageToken = response.nextPageToken;
            }
            return messageIds;
        },
        async getMessage(messageId) {
            const url = new URL(`${baseUrl}/users/me/messages/${encodeURIComponent(messageId)}`);
            url.searchParams.set("format", "full");
            return (await requestJson(fetchLike, options.getRequestHeaders, url.toString()));
        },
        async getAttachment(messageId, attachmentId) {
            const url = `${baseUrl}/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
            return (await requestJson(fetchLike, options.getRequestHeaders, url));
        },
    };
}
