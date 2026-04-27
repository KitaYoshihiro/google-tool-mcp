import type { RawGmailMessage } from "./messages";
import type { GmailLabel } from "./labels";

export class GmailApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
  }
}

export interface GmailApiClient {
  getProfile(): Promise<{
    emailAddress?: string;
  }>;
  getMessage(messageId: string): Promise<RawGmailMessage>;
  listLabels(): Promise<GmailLabel[]>;
  listMessageIds(options: {
    labelIds: readonly string[];
    maxResults: number;
    query: string;
  }): Promise<string[]>;
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
    throw new GmailApiError(response.status, message || `HTTP ${response.status}`);
  }

  return response.json();
}

export function createGmailApiClient(options: {
  baseUrl?: string;
  fetch?: FetchLike;
  getRequestHeaders: (url: string) => Promise<Headers | Record<string, string>>;
}): GmailApiClient {
  const baseUrl = options.baseUrl ?? "https://gmail.googleapis.com/gmail/v1";
  const fetchLike = options.fetch ?? (globalThis.fetch as FetchLike);

  return {
    async getProfile(): Promise<{
      emailAddress?: string;
    }> {
      const url = `${baseUrl}/users/me/profile`;
      return (await requestJson(
        fetchLike,
        options.getRequestHeaders,
        url,
      )) as {
        emailAddress?: string;
      };
    },

    async listLabels(): Promise<GmailLabel[]> {
      const url = `${baseUrl}/users/me/labels`;
      const response = (await requestJson(
        fetchLike,
        options.getRequestHeaders,
        url,
      )) as {
        labels?: Array<Partial<GmailLabel>>;
      };

      return (response.labels ?? []).map((label) => ({
        id: label.id ?? "",
        name: label.name ?? "",
        type: label.type ?? "",
      }));
    },

    async listMessageIds({
      maxResults,
      query,
      labelIds,
    }: {
      labelIds: readonly string[];
      maxResults: number;
      query: string;
    }): Promise<string[]> {
      if (maxResults <= 0) {
        return [];
      }

      const messageIds: string[] = [];
      let pageToken: string | undefined;

      while (messageIds.length < maxResults) {
        const url = new URL(`${baseUrl}/users/me/messages`);
        url.searchParams.set(
          "maxResults",
          String(Math.min(500, maxResults - messageIds.length)),
        );

        if (query) {
          url.searchParams.set("q", query);
        }

        for (const labelId of labelIds) {
          url.searchParams.append("labelIds", labelId);
        }

        if (pageToken) {
          url.searchParams.set("pageToken", pageToken);
        }

        const response = (await requestJson(
          fetchLike,
          options.getRequestHeaders,
          url.toString(),
        )) as {
          messages?: Array<{ id?: string }>;
          nextPageToken?: string;
        };

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

    async getMessage(messageId: string): Promise<RawGmailMessage> {
      const url = new URL(`${baseUrl}/users/me/messages/${encodeURIComponent(messageId)}`);
      url.searchParams.set("format", "full");
      return (await requestJson(
        fetchLike,
        options.getRequestHeaders,
        url.toString(),
      )) as RawGmailMessage;
    },
  };
}
