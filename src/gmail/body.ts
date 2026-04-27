export interface RawMessagePartBody {
  data?: string;
}

export interface RawMessagePart {
  body?: RawMessagePartBody;
  mimeType?: string;
  parts?: RawMessagePart[];
}

function decodeHtmlEntity(entity: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
  }

  if (entity.startsWith("#")) {
    return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
  }

  return namedEntities[entity] ?? `&${entity};`;
}

function unescapeHtml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity) =>
    decodeHtmlEntity(entity),
  );
}

export function decodePartData(data: string): string {
  if (!data) {
    return "";
  }

  return Buffer.from(data, "base64url").toString("utf-8");
}

function* iterateParts(payload: RawMessagePart): Generator<RawMessagePart> {
  if (!payload.parts || payload.parts.length === 0) {
    yield payload;
    return;
  }

  for (const part of payload.parts) {
    yield* iterateParts(part);
  }
}

export function htmlToText(value: string): string {
  let text = value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<[^>]+>/g, "");
  text = unescapeHtml(text);
  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export function extractMessageBody(payload: RawMessagePart): string {
  const plainTextParts: string[] = [];
  const htmlParts: string[] = [];

  for (const part of iterateParts(payload)) {
    const data = part.body?.data;
    if (!data) {
      continue;
    }

    const decoded = decodePartData(data).trim();
    if (!decoded) {
      continue;
    }

    if (part.mimeType === "text/plain") {
      plainTextParts.push(decoded);
      continue;
    }

    if (part.mimeType === "text/html") {
      htmlParts.push(htmlToText(decoded));
    }
  }

  if (plainTextParts.length > 0) {
    return plainTextParts.join("\n\n").trim();
  }

  if (htmlParts.length > 0) {
    return htmlParts.filter((part) => part.length > 0).join("\n\n").trim();
  }

  return "";
}

export function truncateText(
  value: string,
  limit: number,
): {
  value: string;
  truncated: boolean;
} {
  if (limit < 0) {
    throw new Error("Body character limit must be non-negative.");
  }

  if (limit === 0 || value.length <= limit) {
    return {
      value,
      truncated: false,
    };
  }

  if (limit <= 3) {
    return {
      value: value.slice(0, limit),
      truncated: true,
    };
  }

  return {
    value: `${value.slice(0, limit - 3).replace(/\s+$/u, "")}...`,
    truncated: true,
  };
}
