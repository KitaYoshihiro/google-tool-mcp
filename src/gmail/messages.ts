import { extractMessageBody, truncateText, type RawMessagePart } from "./body";

export interface RawMessageHeader {
  name?: string;
  value?: string;
}

export interface RawGmailMessage {
  id?: string;
  payload?: RawMessagePart & {
    headers?: RawMessageHeader[];
  };
  snippet?: string;
  threadId?: string;
}

export interface GmailMessage {
  id: string;
  thread_id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  body: string;
  body_truncated: boolean;
}

export interface GmailMessageList {
  count: number;
  query: string;
  labels: string[];
  resolved_label_ids: string[];
  messages: GmailMessage[];
}

function getHeaderValue(
  headers: readonly RawMessageHeader[],
  headerName: string,
): string {
  const target = headerName.toLocaleLowerCase();
  const header = headers.find(
    (candidate) => candidate.name?.toLocaleLowerCase() === target,
  );
  return header?.value ?? "";
}

export function mapRawMessage(
  message: RawGmailMessage,
  options: {
    includeBody: boolean;
    bodyChars: number;
  },
): GmailMessage {
  const headers = message.payload?.headers ?? [];
  const extractedBody =
    options.includeBody && message.payload
      ? extractMessageBody(message.payload)
      : "";
  const truncatedBody = options.includeBody
    ? truncateText(extractedBody, options.bodyChars)
    : {
        value: "",
        truncated: false,
      };

  return {
    id: message.id ?? "",
    thread_id: message.threadId ?? "",
    subject: getHeaderValue(headers, "Subject") || "(no subject)",
    sender: getHeaderValue(headers, "From") || "(unknown sender)",
    date: getHeaderValue(headers, "Date") || "(unknown date)",
    snippet: message.snippet?.trim() ?? "",
    body: truncatedBody.value,
    body_truncated: truncatedBody.truncated,
  };
}

export function createMessageList(options: {
  query?: string;
  labels?: readonly string[];
  resolvedLabelIds?: readonly string[];
  rawMessages: readonly RawGmailMessage[];
  includeBody: boolean;
  bodyChars: number;
  maxResults?: number;
}): GmailMessageList {
  if (options.maxResults !== undefined && options.maxResults <= 0) {
    return {
      count: 0,
      query: options.query ?? "",
      labels: [...(options.labels ?? [])],
      resolved_label_ids: [...(options.resolvedLabelIds ?? [])],
      messages: [],
    };
  }

  const limitedMessages =
    options.maxResults === undefined
      ? options.rawMessages
      : options.rawMessages.slice(0, options.maxResults);
  const messages = limitedMessages.map((message) =>
    mapRawMessage(message, {
      includeBody: options.includeBody,
      bodyChars: options.bodyChars,
    }),
  );

  return {
    count: messages.length,
    query: options.query ?? "",
    labels: [...(options.labels ?? [])],
    resolved_label_ids: [...(options.resolvedLabelIds ?? [])],
    messages,
  };
}
