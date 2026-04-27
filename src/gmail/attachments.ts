import { TextDecoder } from "node:util";

import { htmlToText, truncateText, type RawMessagePart, type RawMessagePartBody } from "./body";
import type { RawGmailMessage } from "./messages";

export interface GmailAttachment {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  text_supported: boolean;
  text_format: string;
}

export interface GmailAttachmentList {
  count: number;
  message_id: string;
  attachments: GmailAttachment[];
}

export interface GmailAttachmentText {
  attachment_id: string;
  filename: string;
  message_id: string;
  mime_type: string;
  size: number;
  text: string;
  text_chars: number;
  text_format: string;
  text_truncated: boolean;
}

type AttachmentTextFormat = "html" | "json" | "plain";

const PLAIN_TEXT_MIME_TYPES = new Set([
  "application/xml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml",
]);

const PLAIN_TEXT_EXTENSIONS = new Set([
  "csv",
  "md",
  "text",
  "tsv",
  "txt",
  "xml",
]);

function* iterateParts(payload: RawMessagePart): Generator<RawMessagePart> {
  if (!payload.parts || payload.parts.length === 0) {
    yield payload;
    return;
  }

  for (const part of payload.parts) {
    yield* iterateParts(part);
  }
}

function normalizeMimeType(mimeType: string | undefined): string {
  return (mimeType ?? "").split(";", 1)[0].trim().toLocaleLowerCase();
}

function getFileExtension(filename: string): string {
  const basename = filename.trim().toLocaleLowerCase();
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex >= 0 ? basename.slice(dotIndex + 1) : "";
}

function getHeaderValue(part: RawMessagePart, headerName: string): string {
  const target = headerName.toLocaleLowerCase();
  const header = (part.headers ?? []).find(
    (candidate) => candidate.name?.toLocaleLowerCase() === target,
  );
  return header?.value ?? "";
}

function parseCharset(contentType: string): string {
  const match = /(?:^|;)\s*charset=(?:"([^"]+)"|([^;\s]+))/iu.exec(contentType);
  return (match?.[1] ?? match?.[2] ?? "").trim().toLocaleLowerCase();
}

function getTextFormat(mimeType: string, filename: string): AttachmentTextFormat | null {
  if (mimeType === "text/html") {
    return "html";
  }

  if (mimeType === "application/json" || mimeType.endsWith("+json")) {
    return "json";
  }

  if (PLAIN_TEXT_MIME_TYPES.has(mimeType)) {
    return "plain";
  }

  const extension = getFileExtension(filename);
  if (extension === "html" || extension === "htm") {
    return "html";
  }

  if (extension === "json") {
    return "json";
  }

  if (PLAIN_TEXT_EXTENSIONS.has(extension)) {
    return "plain";
  }

  return null;
}

function mapAttachmentPart(part: RawMessagePart): GmailAttachment | null {
  const attachmentId = part.body?.attachmentId;
  if (!attachmentId) {
    return null;
  }

  const filename = part.filename ?? "";
  const mimeType = normalizeMimeType(part.mimeType);
  const textFormat = getTextFormat(mimeType, filename);

  return {
    attachment_id: attachmentId,
    filename,
    mime_type: mimeType,
    size: part.body?.size ?? 0,
    text_supported: textFormat !== null,
    text_format: textFormat ?? "",
  };
}

export function listGmailAttachments(message: RawGmailMessage): GmailAttachmentList {
  const attachments = message.payload
    ? [...iterateParts(message.payload)]
        .map(mapAttachmentPart)
        .filter((attachment): attachment is GmailAttachment => attachment !== null)
    : [];

  return {
    count: attachments.length,
    message_id: message.id ?? "",
    attachments,
  };
}

export function findGmailAttachment(
  message: RawGmailMessage,
  attachmentId: string,
): GmailAttachment | null {
  return listGmailAttachments(message).attachments.find(
    (attachment) => attachment.attachment_id === attachmentId,
  ) ?? null;
}

function findAttachmentPart(
  message: RawGmailMessage,
  attachmentId: string,
): RawMessagePart | null {
  if (!message.payload) {
    return null;
  }

  for (const part of iterateParts(message.payload)) {
    if (part.body?.attachmentId === attachmentId) {
      return part;
    }
  }

  return null;
}

function decodeText(buffer: Buffer, charset: string): string {
  const normalizedCharset = charset || "utf-8";
  if (
    normalizedCharset === "utf-8" ||
    normalizedCharset === "utf8" ||
    normalizedCharset === "us-ascii" ||
    normalizedCharset === "ascii"
  ) {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  }

  if (
    normalizedCharset === "utf-16le" ||
    normalizedCharset === "utf16le" ||
    normalizedCharset === "utf-16"
  ) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(buffer);
  }

  throw new Error(`Unsupported attachment charset: ${charset}.`);
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function convertAttachmentText(
  rawText: string,
  format: AttachmentTextFormat,
): string {
  if (format === "html") {
    return htmlToText(rawText);
  }

  if (format === "json") {
    try {
      return JSON.stringify(JSON.parse(rawText), null, 2);
    } catch {
      throw new Error("Attachment JSON could not be parsed.");
    }
  }

  return normalizeText(rawText);
}

export function readGmailAttachmentText(options: {
  attachment: RawMessagePartBody;
  attachmentId: string;
  maxBytes: number;
  maxChars: number;
  message: RawGmailMessage;
}): GmailAttachmentText {
  const part = findAttachmentPart(options.message, options.attachmentId);
  if (!part) {
    throw new Error(`Attachment was not found in message: ${options.attachmentId}`);
  }

  const metadata = mapAttachmentPart(part);
  if (!metadata) {
    throw new Error(`Attachment was not found in message: ${options.attachmentId}`);
  }

  const mimeType = metadata.mime_type;
  const format = getTextFormat(mimeType, metadata.filename);
  if (!format) {
    throw new Error(
      `Attachment is not a supported text type: ${mimeType || "(unknown)"}.`,
    );
  }

  if (!options.attachment.data) {
    throw new Error(`Attachment data was not returned for: ${options.attachmentId}`);
  }

  const buffer = Buffer.from(options.attachment.data, "base64url");
  if (buffer.byteLength > options.maxBytes) {
    throw new Error(
      `Attachment is too large to read as text: ${buffer.byteLength} bytes exceeds max_bytes ${options.maxBytes}.`,
    );
  }

  const contentType = getHeaderValue(part, "Content-Type");
  const charset = parseCharset(contentType);
  const decoded = decodeText(buffer, charset);
  const converted = convertAttachmentText(decoded, format);
  const truncated = truncateText(converted, options.maxChars);

  return {
    attachment_id: options.attachmentId,
    filename: metadata.filename,
    message_id: options.message.id ?? "",
    mime_type: mimeType,
    size: options.attachment.size ?? metadata.size,
    text: truncated.value,
    text_chars: truncated.value.length,
    text_format: format,
    text_truncated: truncated.truncated,
  };
}
