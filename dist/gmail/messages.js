"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapRawMessage = mapRawMessage;
exports.createMessageList = createMessageList;
const body_1 = require("./body");
function getHeaderValue(headers, headerName) {
    const target = headerName.toLocaleLowerCase();
    const header = headers.find((candidate) => candidate.name?.toLocaleLowerCase() === target);
    return header?.value ?? "";
}
function mapRawMessage(message, options) {
    const headers = message.payload?.headers ?? [];
    const extractedBody = options.includeBody && message.payload
        ? (0, body_1.extractMessageBody)(message.payload)
        : "";
    const truncatedBody = options.includeBody
        ? (0, body_1.truncateText)(extractedBody, options.bodyChars)
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
function createMessageList(options) {
    if (options.maxResults !== undefined && options.maxResults <= 0) {
        return {
            count: 0,
            query: options.query ?? "",
            labels: [...(options.labels ?? [])],
            resolved_label_ids: [...(options.resolvedLabelIds ?? [])],
            messages: [],
        };
    }
    const limitedMessages = options.maxResults === undefined
        ? options.rawMessages
        : options.rawMessages.slice(0, options.maxResults);
    const messages = limitedMessages.map((message) => mapRawMessage(message, {
        includeBody: options.includeBody,
        bodyChars: options.bodyChars,
    }));
    return {
        count: messages.length,
        query: options.query ?? "",
        labels: [...(options.labels ?? [])],
        resolved_label_ids: [...(options.resolvedLabelIds ?? [])],
        messages,
    };
}
