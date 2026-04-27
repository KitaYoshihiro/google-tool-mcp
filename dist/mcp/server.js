"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_NOT_IMPLEMENTED_EXIT_CODE = void 0;
exports.parseMcpServerArgs = parseMcpServerArgs;
exports.createMcpProtocolHandler = createMcpProtocolHandler;
exports.runMcpServer = runMcpServer;
const promises_1 = require("node:fs/promises");
const node_readline_1 = require("node:readline");
const googleAuth_1 = require("../auth/googleAuth");
const constants_1 = require("../config/constants");
const files_1 = require("../drive/files");
const client_1 = require("../drive/client");
const paths_1 = require("../config/paths");
const client_2 = require("../gmail/client");
const attachments_1 = require("../gmail/attachments");
const labels_1 = require("../gmail/labels");
const messages_1 = require("../gmail/messages");
exports.MCP_NOT_IMPLEMENTED_EXIT_CODE = 1;
const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];
const MCP_PROTOCOL_VERSION = SUPPORTED_MCP_PROTOCOL_VERSIONS[0];
const MCP_SERVER_NAME = "google-tool";
const MCP_SERVER_VERSION = "0.1.0";
const GMAIL_TOOL_DEFINITIONS = [
    {
        name: "list_gmail_messages",
        description: "List Gmail messages for the authenticated account.",
        inputSchema: {
            type: "object",
            properties: {
                max_results: { type: "integer", default: 10 },
                query: { type: "string", default: "" },
                labels: {
                    type: "array",
                    items: { type: "string" },
                },
                include_body: { type: "boolean", default: false },
                body_chars: { type: "integer", default: 1500 },
            },
        },
    },
    {
        name: "list_gmail_labels",
        description: "List Gmail labels for the authenticated account.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "read_gmail_message",
        description: "Load one Gmail message by message ID.",
        inputSchema: {
            type: "object",
            properties: {
                message_id: { type: "string" },
                include_body: { type: "boolean", default: true },
                body_chars: { type: "integer", default: 5000 },
            },
            required: ["message_id"],
        },
    },
    {
        name: "list_gmail_attachments",
        description: "List attachments on one Gmail message.",
        inputSchema: {
            type: "object",
            properties: {
                message_id: { type: "string" },
            },
            required: ["message_id"],
        },
    },
    {
        name: "read_gmail_attachment_text",
        description: "Read a supported text attachment from one Gmail message.",
        inputSchema: {
            type: "object",
            properties: {
                message_id: { type: "string" },
                attachment_id: { type: "string" },
                max_bytes: { type: "integer", default: 1048576 },
                max_chars: { type: "integer", default: 5000 },
            },
            required: ["message_id", "attachment_id"],
        },
    },
];
const DRIVE_TOOL_DEFINITIONS = [
    {
        name: "get_drive_about",
        description: "Get Google Drive account profile and storage quota metadata.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "list_drive_files",
        description: [
            "Search Google Drive files and folders using Google Drive API files.list q syntax.",
            "Use name contains 'term' for filename search and fullText contains 'term' for indexed content search.",
            "Prefer adding trashed = false in q unless the user asks for trashed files.",
            "For file-type searches, combine fullText with mimeType filters such as application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document for DOCX, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet for XLSX, application/vnd.openxmlformats-officedocument.presentationml.presentation for PPTX, application/vnd.google-apps.document for Google Docs, and application/vnd.google-apps.spreadsheet for Google Sheets.",
            "This tool returns metadata only, not file contents.",
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                max_results: { type: "integer", default: 10 },
                query: {
                    type: "string",
                    default: "",
                    description: [
                        "Google Drive API files.list q expression.",
                        "Examples: name contains '議事録' and trashed = false; fullText contains '契約更新' and mimeType = 'application/pdf' and trashed = false; fullText contains '予算案' and mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and trashed = false; mimeType = 'application/vnd.google-apps.folder' and name contains '経理' and trashed = false.",
                    ].join(" "),
                },
                include_trashed: {
                    type: "boolean",
                    default: false,
                    description: "Whether to include trashed files in returned results. Also add trashed = false to query when the user wants normal non-trashed search semantics.",
                },
                corpora: {
                    type: "string",
                    enum: ["user", "domain", "drive", "allDrives"],
                    default: "user",
                    description: "Drive API corpora value. Use user for normal My Drive/shared-with-me searches; use drive with drive_id for a specific shared drive; use allDrives only when needed.",
                },
                drive_id: {
                    type: "string",
                    description: "Shared drive ID when corpora is drive.",
                },
                include_items_from_all_drives: {
                    type: "boolean",
                    default: false,
                    description: "Set true when searching shared drives or all drives.",
                },
                order_by: {
                    type: "string",
                    default: "",
                    description: "Drive API orderBy expression, for example modifiedTime desc or name.",
                },
            },
        },
    },
    {
        name: "read_drive_file",
        description: "Load Google Drive file metadata by file ID without downloading file contents.",
        inputSchema: {
            type: "object",
            properties: {
                file_id: { type: "string" },
            },
            required: ["file_id"],
        },
    },
];
const COMMON_TOOL_DEFINITIONS = [
    {
        name: "whoami",
        description: "Return the Google account identity and enabled server features for this MCP server.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
];
const COMMON_TOOL_NAMES = new Set(COMMON_TOOL_DEFINITIONS.map((tool) => tool.name));
const GMAIL_TOOL_NAMES = new Set(GMAIL_TOOL_DEFINITIONS.map((tool) => tool.name));
const DRIVE_TOOL_NAMES = new Set(DRIVE_TOOL_DEFINITIONS.map((tool) => tool.name));
function getInstructions(features) {
    const capabilitySentence = features.gmailEnabled && features.driveEnabled
        ? "Read Gmail messages, supported Gmail text attachments, and Google Drive file metadata from the authorized account. "
        : features.gmailEnabled
            ? "Read Gmail messages and supported Gmail text attachments from the authorized account. "
            : features.driveEnabled
                ? "Read Google Drive file metadata from the authorized account. "
                : "All Gmail and Drive tool groups are disabled by server configuration. ";
    return (capabilitySentence +
        `If OAuth is not initialized, configure credentials first: place credentials.json in the config directory or set ${constants_1.ENV_CREDENTIALS_PATH}. ` +
        `${constants_1.ENV_PROFILE} selects a profile, ${constants_1.ENV_TOKEN_PATH} can point to an existing token, and the first tool call can launch browser auth after credentials are configured.`);
}
function negotiateProtocolVersion(requestedVersion) {
    if (typeof requestedVersion === "string" &&
        SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requestedVersion)) {
        return requestedVersion;
    }
    return MCP_PROTOCOL_VERSION;
}
function getToolDefinitions(features) {
    return [
        ...((features.gmailEnabled || features.driveEnabled) ? COMMON_TOOL_DEFINITIONS : []),
        ...(features.gmailEnabled ? GMAIL_TOOL_DEFINITIONS : []),
        ...(features.driveEnabled ? DRIVE_TOOL_DEFINITIONS : []),
    ];
}
function parseToggleOptionValue(flagName, value) {
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing value for ${flagName}. Use on or off.`);
    }
    if (value === "on") {
        return true;
    }
    if (value === "off") {
        return false;
    }
    throw new Error(`Invalid value for ${flagName}: ${value}. Use on or off.`);
}
function resolveServerFeatures(options) {
    return {
        gmailEnabled: options.gmailEnabled ?? true,
        driveEnabled: options.driveEnabled ?? true,
    };
}
function isToolEnabled(toolName, features) {
    if (COMMON_TOOL_NAMES.has(toolName)) {
        return features.gmailEnabled || features.driveEnabled;
    }
    if (GMAIL_TOOL_NAMES.has(toolName)) {
        return features.gmailEnabled;
    }
    if (DRIVE_TOOL_NAMES.has(toolName)) {
        return features.driveEnabled;
    }
    return false;
}
function isKnownTool(toolName) {
    return COMMON_TOOL_NAMES.has(toolName) || GMAIL_TOOL_NAMES.has(toolName) || DRIVE_TOOL_NAMES.has(toolName);
}
function getAuthorizationScopes(features) {
    const scopes = [];
    if (features.gmailEnabled) {
        scopes.push(constants_1.GMAIL_READONLY_SCOPE);
    }
    if (features.driveEnabled) {
        scopes.push(constants_1.DRIVE_METADATA_READONLY_SCOPE);
    }
    return scopes;
}
async function buildWhoAmIResult(configuredPaths, pathContext, features, dependencies) {
    const profileName = (0, paths_1.resolveProfileName)(pathContext) ?? "";
    if (features.gmailEnabled) {
        const gmailClient = await createAuthorizedGmailClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
            scopes: [constants_1.GMAIL_READONLY_SCOPE],
        }), dependencies);
        const profile = await gmailClient.getProfile();
        return {
            account_email: profile.emailAddress ?? "",
            display_name: "",
            enabled_features: {
                gmail: features.gmailEnabled,
                drive: features.driveEnabled,
            },
            identity_source: "gmail",
            profile_name: profileName,
        };
    }
    const driveClient = await createAuthorizedDriveClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
        requireGrantedScopes: true,
        scopes: [constants_1.DRIVE_METADATA_READONLY_SCOPE],
    }), dependencies);
    const about = (0, files_1.mapDriveAbout)(await driveClient.getAbout());
    return {
        account_email: about.user.email_address,
        display_name: about.user.display_name,
        enabled_features: {
            gmail: features.gmailEnabled,
            drive: features.driveEnabled,
        },
        identity_source: "drive",
        profile_name: profileName,
    };
}
function parseMcpServerArgs(args) {
    const options = {
        gmailEnabled: true,
        driveEnabled: true,
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--profile") {
            index += 1;
            if (args[index] === undefined) {
                throw new Error("Missing value for --profile.");
            }
            options.profileName = args[index];
            continue;
        }
        if (arg.startsWith("--profile=")) {
            const profileName = arg.slice("--profile=".length);
            if (!profileName) {
                throw new Error("Missing value for --profile.");
            }
            options.profileName = profileName;
            continue;
        }
        if (arg === "--gmail") {
            index += 1;
            options.gmailEnabled = parseToggleOptionValue("--gmail", args[index]);
            continue;
        }
        if (arg.startsWith("--gmail=")) {
            options.gmailEnabled = parseToggleOptionValue("--gmail", arg.slice("--gmail=".length));
            continue;
        }
        if (arg === "--drive") {
            index += 1;
            options.driveEnabled = parseToggleOptionValue("--drive", args[index]);
            continue;
        }
        if (arg.startsWith("--drive=")) {
            options.driveEnabled = parseToggleOptionValue("--drive", arg.slice("--drive=".length));
            continue;
        }
        throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value;
}
function readString(value, fieldName, fallback) {
    if (value === undefined) {
        if (fallback !== undefined) {
            return fallback;
        }
        throw new Error(`Invalid ${fieldName}.`);
    }
    if (typeof value !== "string") {
        throw new Error(`Invalid ${fieldName}.`);
    }
    return value;
}
function readInteger(value, fieldName, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid ${fieldName}.`);
    }
    return value;
}
function readBoolean(value, fieldName, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== "boolean") {
        throw new Error(`Invalid ${fieldName}.`);
    }
    return value;
}
function readStringArray(value, fieldName) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`Invalid ${fieldName}.`);
    }
    return [...value];
}
function readCorpora(value, fieldName, fallback) {
    const corpora = readString(value, fieldName, fallback);
    if (corpora !== "allDrives" &&
        corpora !== "domain" &&
        corpora !== "drive" &&
        corpora !== "user") {
        throw new Error(`Invalid ${fieldName}.`);
    }
    return corpora;
}
async function createAuthorizedGmailClient(credentialsPath, token, dependencies) {
    if (dependencies.createGmailClient) {
        return dependencies.createGmailClient({
            credentialsPath,
            token,
        });
    }
    const credentials = await (0, googleAuth_1.loadOAuthClientCredentials)(credentialsPath);
    const authClient = (0, googleAuth_1.createOAuthClient)(credentials);
    (0, googleAuth_1.applySavedToken)(authClient, token);
    return (0, client_2.createGmailApiClient)({
        async getRequestHeaders(url) {
            return authClient.getRequestHeaders(url);
        },
    });
}
async function createAuthorizedDriveClient(credentialsPath, token, dependencies) {
    if (dependencies.createDriveClient) {
        return dependencies.createDriveClient({
            credentialsPath,
            token,
        });
    }
    const credentials = await (0, googleAuth_1.loadOAuthClientCredentials)(credentialsPath);
    const authClient = (0, googleAuth_1.createOAuthClient)(credentials);
    (0, googleAuth_1.applySavedToken)(authClient, token);
    return (0, client_1.createDriveApiClient)({
        async getRequestHeaders(url) {
            return authClient.getRequestHeaders(url);
        },
    });
}
function buildToolSuccessResult(value) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, null, 2),
            },
        ],
        structuredContent: value,
        isError: false,
    };
}
function buildToolErrorResult(error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [
            {
                type: "text",
                text: `RuntimeError: ${message}`,
            },
        ],
        isError: true,
    };
}
class McpAuthorizationPendingError extends Error {
    constructor(message) {
        super(message);
        this.name = "McpAuthorizationPendingError";
    }
}
function formatAuthorizationRetryMessage(suffix) {
    return `${suffix} After completing Google authorization, retry the same request.`;
}
function formatBackgroundAuthorizationFailure(error) {
    const message = (error instanceof Error ? error.message : String(error)).trim();
    const trailingPunctuation = /[.!?]$/u.test(message) ? "" : ".";
    return `The previous Google authorization attempt did not finish successfully: ${message}${trailingPunctuation} Retry the same request to start authorization again.`;
}
async function pathExists(filePath, dependencies) {
    if (dependencies.pathExists) {
        return dependencies.pathExists(filePath);
    }
    try {
        await (0, promises_1.access)(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function emitStartupDiagnostics(io, dependencies) {
    const pathContext = {
        env: dependencies.env,
        homeDir: dependencies.homeDir,
        platform: dependencies.platform,
        profileName: dependencies.profileName,
    };
    const configuredPaths = await resolveRuntimePaths(pathContext, dependencies);
    const credentialsPresent = await pathExists(configuredPaths.credentialsPath, dependencies);
    const tokenPresent = await pathExists(configuredPaths.tokenPath, dependencies);
    const features = resolveServerFeatures(dependencies);
    io.error("google-tool-mcp: starting stdio MCP server");
    io.error(`google-tool-mcp: config dir: ${configuredPaths.configDir}`);
    io.error(`google-tool-mcp: credentials: ${credentialsPresent ? "found" : "missing"} at ${configuredPaths.credentialsPath}`);
    io.error(`google-tool-mcp: token: ${tokenPresent ? "found" : "missing"} at ${configuredPaths.tokenPath}`);
    io.error(`google-tool-mcp: features: gmail=${features.gmailEnabled ? "enabled" : "disabled"}, drive=${features.driveEnabled ? "enabled" : "disabled"}`);
    io.error("google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.");
}
async function resolveRuntimePaths(pathContext, dependencies) {
    const configuredPaths = (0, paths_1.resolveConfiguredPaths)(pathContext);
    if (!(0, paths_1.shouldUseSharedCredentialFallback)(pathContext)) {
        return configuredPaths;
    }
    if (await pathExists(configuredPaths.credentialsPath, dependencies)) {
        return configuredPaths;
    }
    return {
        ...configuredPaths,
        credentialsPath: (0, paths_1.getSharedCredentialPaths)(pathContext).credentialsPath,
    };
}
async function authorizeForTool(configuredPaths, features, dependencies, options) {
    const credentialsExists = await pathExists(configuredPaths.credentialsPath, dependencies);
    const authorizationScopes = getAuthorizationScopes(features);
    const requireGrantedScopes = options.requireGrantedScopes ??
        authorizationScopes.length > options.scopes.length;
    const sessions = dependencies.authorizationSessions;
    const existingSession = sessions?.get(configuredPaths.tokenPath);
    if (existingSession?.status === "failed") {
        sessions?.delete(configuredPaths.tokenPath);
        throw new Error(existingSession.failureMessage ??
            "The previous Google authorization attempt did not finish successfully. Retry the same request to start authorization again.");
    }
    if (existingSession?.status === "pending") {
        const latestNotice = existingSession.notices.at(-1);
        const retryMessage = latestNotice?.manualInstructions
            ? formatAuthorizationRetryMessage(`${latestNotice.manualInstructions}\nThe MCP server is still waiting for Google authorization to finish.`)
            : formatAuthorizationRetryMessage("The MCP server is still waiting for Google authorization to finish.");
        throw new McpAuthorizationPendingError(retryMessage);
    }
    if (!credentialsExists) {
        throw new googleAuth_1.GoogleCredentialsRequiredError(configuredPaths.credentialsPath, configuredPaths.tokenPath);
    }
    try {
        const authResult = await (dependencies.ensureAuthorizedToken ?? googleAuth_1.ensureAuthorizedToken)({
            credentialsPath: configuredPaths.credentialsPath,
            tokenPath: configuredPaths.tokenPath,
            allowBrowserAuth: false,
            requireGrantedScopes,
            scopes: authorizationScopes,
            onAuthorizationReady: dependencies.onAuthorizationReady,
        });
        return authResult.token;
    }
    catch (error) {
        if (!credentialsExists ||
            (!(error instanceof googleAuth_1.GmailAuthRequiredError) &&
                !(error instanceof googleAuth_1.GoogleScopeRequiredError))) {
            throw error;
        }
        const nextSession = {
            status: "pending",
            notices: [],
            startedAt: Date.now(),
        };
        sessions?.set(configuredPaths.tokenPath, nextSession);
        void (async () => {
            try {
                await (dependencies.ensureAuthorizedToken ?? googleAuth_1.ensureAuthorizedToken)({
                    credentialsPath: configuredPaths.credentialsPath,
                    tokenPath: configuredPaths.tokenPath,
                    allowBrowserAuth: true,
                    requireGrantedScopes,
                    scopes: authorizationScopes,
                    onAuthorizationReady: async (notice) => {
                        nextSession.notices.push(notice);
                        await dependencies.onAuthorizationReady?.(notice);
                    },
                });
            }
            catch (error) {
                nextSession.status = "failed";
                nextSession.failureMessage = formatBackgroundAuthorizationFailure(error);
                await dependencies.onBackgroundAuthorizationError?.(error);
            }
            finally {
                if (nextSession.status === "pending") {
                    sessions?.delete(configuredPaths.tokenPath);
                }
            }
        })();
        throw new McpAuthorizationPendingError(formatAuthorizationRetryMessage("Google authorization has started. Complete it in the browser."));
    }
}
async function callTool(toolName, toolArguments, dependencies) {
    try {
        const features = resolveServerFeatures(dependencies);
        if (!isToolEnabled(toolName, features)) {
            if (isKnownTool(toolName)) {
                return buildToolErrorResult(new Error(`Tool is disabled by server configuration: ${toolName}`));
            }
            return buildToolErrorResult(new Error(`Unknown tool: ${toolName}`));
        }
        const pathContext = {
            env: dependencies.env,
            homeDir: dependencies.homeDir,
            platform: dependencies.platform,
            profileName: dependencies.profileName,
        };
        const configuredPaths = await resolveRuntimePaths(pathContext, dependencies);
        if ((0, paths_1.isPathInConfigDir)(configuredPaths.configDir, configuredPaths.credentialsPath, pathContext.platform) ||
            (0, paths_1.isPathInConfigDir)(configuredPaths.configDir, configuredPaths.tokenPath, pathContext.platform)) {
            await (dependencies.ensureDir ??
                ((dirPath) => (0, promises_1.mkdir)(dirPath, { recursive: true })))(configuredPaths.configDir);
        }
        if (toolName === "whoami") {
            return buildToolSuccessResult(await buildWhoAmIResult(configuredPaths, pathContext, features, dependencies));
        }
        if (toolName === "list_gmail_labels") {
            const gmailClient = await createAuthorizedGmailClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                scopes: [constants_1.GMAIL_READONLY_SCOPE],
            }), dependencies);
            const labels = (0, labels_1.normalizeLabelList)(await gmailClient.listLabels());
            return buildToolSuccessResult(labels);
        }
        if (toolName === "list_gmail_messages") {
            const maxResults = readInteger(toolArguments.max_results, "max_results", 10);
            const query = readString(toolArguments.query, "query", "");
            const labels = readStringArray(toolArguments.labels, "labels");
            const includeBody = readBoolean(toolArguments.include_body, "include_body", false);
            const bodyChars = readInteger(toolArguments.body_chars, "body_chars", 1500);
            const gmailClient = await createAuthorizedGmailClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                scopes: [constants_1.GMAIL_READONLY_SCOPE],
            }), dependencies);
            const availableLabels = labels.length > 0 ? await gmailClient.listLabels() : [];
            const resolvedLabelIds = (0, labels_1.resolveLabelIds)(labels, availableLabels);
            const messageIds = await gmailClient.listMessageIds({
                maxResults,
                query,
                labelIds: resolvedLabelIds,
            });
            const rawMessages = await Promise.all(messageIds.map((messageId) => gmailClient.getMessage(messageId)));
            return buildToolSuccessResult((0, messages_1.createMessageList)({
                query,
                labels,
                resolvedLabelIds,
                rawMessages,
                includeBody,
                bodyChars,
                maxResults,
            }));
        }
        if (toolName === "read_gmail_message") {
            const messageId = readString(toolArguments.message_id, "message_id");
            const includeBody = readBoolean(toolArguments.include_body, "include_body", true);
            const bodyChars = readInteger(toolArguments.body_chars, "body_chars", 5000);
            const gmailClient = await createAuthorizedGmailClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                scopes: [constants_1.GMAIL_READONLY_SCOPE],
            }), dependencies);
            const rawMessage = await gmailClient.getMessage(messageId);
            return buildToolSuccessResult((0, messages_1.mapRawMessage)(rawMessage, {
                includeBody,
                bodyChars,
            }));
        }
        if (toolName === "list_gmail_attachments") {
            const messageId = readString(toolArguments.message_id, "message_id");
            const gmailClient = await createAuthorizedGmailClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                scopes: [constants_1.GMAIL_READONLY_SCOPE],
            }), dependencies);
            return buildToolSuccessResult((0, attachments_1.listGmailAttachments)(await gmailClient.getMessage(messageId)));
        }
        if (toolName === "read_gmail_attachment_text") {
            const messageId = readString(toolArguments.message_id, "message_id");
            const attachmentId = readString(toolArguments.attachment_id, "attachment_id");
            const maxBytes = readInteger(toolArguments.max_bytes, "max_bytes", 1024 * 1024);
            const maxChars = readInteger(toolArguments.max_chars, "max_chars", 5000);
            const gmailClient = await createAuthorizedGmailClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                scopes: [constants_1.GMAIL_READONLY_SCOPE],
            }), dependencies);
            const message = await gmailClient.getMessage(messageId);
            const attachmentMetadata = (0, attachments_1.findGmailAttachment)(message, attachmentId);
            if (!attachmentMetadata) {
                throw new Error(`Attachment was not found in message: ${attachmentId}`);
            }
            if (attachmentMetadata.size > maxBytes) {
                throw new Error(`Attachment is too large to read as text: ${attachmentMetadata.size} bytes exceeds max_bytes ${maxBytes}.`);
            }
            const attachment = await gmailClient.getAttachment(messageId, attachmentId);
            return buildToolSuccessResult((0, attachments_1.readGmailAttachmentText)({
                attachment,
                attachmentId,
                maxBytes,
                maxChars,
                message,
            }));
        }
        if (toolName === "get_drive_about") {
            const driveClient = await createAuthorizedDriveClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                requireGrantedScopes: true,
                scopes: [constants_1.DRIVE_METADATA_READONLY_SCOPE],
            }), dependencies);
            return buildToolSuccessResult((0, files_1.mapDriveAbout)(await driveClient.getAbout()));
        }
        if (toolName === "list_drive_files") {
            const maxResults = readInteger(toolArguments.max_results, "max_results", 10);
            const query = readString(toolArguments.query, "query", "");
            const includeTrashed = readBoolean(toolArguments.include_trashed, "include_trashed", false);
            const corpora = readCorpora(toolArguments.corpora, "corpora", "user");
            const driveId = readString(toolArguments.drive_id, "drive_id", "");
            const includeItemsFromAllDrives = readBoolean(toolArguments.include_items_from_all_drives, "include_items_from_all_drives", false);
            const orderBy = readString(toolArguments.order_by, "order_by", "");
            const driveClient = await createAuthorizedDriveClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                requireGrantedScopes: true,
                scopes: [constants_1.DRIVE_METADATA_READONLY_SCOPE],
            }), dependencies);
            const response = await driveClient.listFiles({
                corpora,
                driveId: driveId || undefined,
                includeItemsFromAllDrives,
                includeTrashed,
                maxResults,
                orderBy,
                query,
            });
            return buildToolSuccessResult((0, files_1.createDriveFileList)({
                corpora,
                driveId: driveId || undefined,
                includeItemsFromAllDrives,
                includeTrashed,
                maxResults,
                orderBy,
                query,
                rawFiles: response.files ?? [],
                incompleteSearch: response.incompleteSearch,
                nextPageToken: response.nextPageToken,
            }));
        }
        if (toolName === "read_drive_file") {
            const fileId = readString(toolArguments.file_id, "file_id");
            const driveClient = await createAuthorizedDriveClient(configuredPaths.credentialsPath, await authorizeForTool(configuredPaths, features, dependencies, {
                requireGrantedScopes: true,
                scopes: [constants_1.DRIVE_METADATA_READONLY_SCOPE],
            }), dependencies);
            return buildToolSuccessResult((0, files_1.mapDriveFile)(await driveClient.getFile(fileId)));
        }
        return buildToolErrorResult(new Error(`Unknown tool: ${toolName}`));
    }
    catch (error) {
        if (error instanceof googleAuth_1.GoogleScopeRequiredError) {
            return buildToolErrorResult(error);
        }
        return buildToolErrorResult(error);
    }
}
function createErrorResponse(id, code, message) {
    return {
        jsonrpc: "2.0",
        id,
        error: {
            code,
            message,
        },
    };
}
function getMessageMethod(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
        return null;
    }
    const candidate = message;
    return typeof candidate.method === "string" ? candidate.method : null;
}
function createMcpProtocolHandler(dependencies = {}) {
    const runtimeDependencies = {
        ...dependencies,
        authorizationSessions: dependencies.authorizationSessions ??
            new Map(),
    };
    const features = resolveServerFeatures(runtimeDependencies);
    const state = {
        phase: "pre_init",
    };
    return {
        async handleMessage(message) {
            const request = asObject(message);
            const id = typeof request.id === "number" || typeof request.id === "string"
                ? request.id
                : null;
            const method = request.method;
            if (request.jsonrpc !== "2.0" || typeof method !== "string") {
                return createErrorResponse(id, -32600, "Invalid Request");
            }
            if (method === "initialize") {
                const params = asObject(request.params);
                const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
                state.phase = "awaiting_initialized";
                return {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        protocolVersion,
                        capabilities: {
                            tools: {},
                        },
                        serverInfo: {
                            name: MCP_SERVER_NAME,
                            version: MCP_SERVER_VERSION,
                        },
                        instructions: getInstructions(features),
                    },
                };
            }
            if (method === "notifications/initialized") {
                if (state.phase === "awaiting_initialized") {
                    state.phase = "ready";
                }
                return null;
            }
            if (state.phase !== "ready") {
                return createErrorResponse(id, -32002, "Server not initialized");
            }
            if (method === "tools/list") {
                return {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        tools: getToolDefinitions(features),
                    },
                };
            }
            if (method === "tools/call") {
                const params = asObject(request.params);
                if (typeof params.name !== "string") {
                    return createErrorResponse(id, -32602, "Invalid params");
                }
                return {
                    jsonrpc: "2.0",
                    id,
                    result: await callTool(params.name, asObject(params.arguments), runtimeDependencies),
                };
            }
            return createErrorResponse(id, -32601, "Method not found");
        },
    };
}
async function runMcpServer(io = { error: console.error }, dependencies = {}) {
    const runtimeDependencies = {
        ...dependencies,
        authorizationSessions: dependencies.authorizationSessions ??
            new Map(),
        onAuthorizationReady: dependencies.onAuthorizationReady ??
            ((notice) => {
                if (notice.manualInstructions) {
                    io.error(notice.manualInstructions);
                    return;
                }
                if (notice.browserOpened) {
                    io.error("google-tool-mcp: opened browser for Google authorization; waiting for completion.");
                }
            }),
        onBackgroundAuthorizationError: dependencies.onBackgroundAuthorizationError ??
            ((error) => {
                io.error(error instanceof Error ? error.message : String(error));
            }),
    };
    await emitStartupDiagnostics(io, runtimeDependencies);
    const handler = createMcpProtocolHandler(runtimeDependencies);
    const stdin = runtimeDependencies.stdin ?? process.stdin;
    const stdout = runtimeDependencies.stdout ?? process.stdout;
    const rl = (0, node_readline_1.createInterface)({ input: stdin, terminal: false });
    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            io.error("google-tool-mcp: received invalid JSON line");
            stdout.write(JSON.stringify(createErrorResponse(null, -32700, "Parse error")) + "\n");
            continue;
        }
        try {
            const method = getMessageMethod(parsed);
            if (method === "initialize") {
                io.error("google-tool-mcp: received initialize request");
            }
            else if (method === "notifications/initialized") {
                io.error("google-tool-mcp: received initialized notification");
            }
            const response = await handler.handleMessage(parsed);
            if (response) {
                stdout.write(JSON.stringify(response) + "\n");
                if (method === "initialize") {
                    io.error("google-tool-mcp: sent initialize response");
                }
            }
        }
        catch (error) {
            io.error(error instanceof Error ? error.message : String(error));
        }
    }
    io.error("google-tool-mcp: stdin closed");
    return 0;
}
if (require.main === module) {
    try {
        const options = parseMcpServerArgs(process.argv.slice(2));
        void runMcpServer({ error: console.error }, {
            profileName: options.profileName,
            gmailEnabled: options.gmailEnabled,
            driveEnabled: options.driveEnabled,
        }).then((code) => {
            process.exit(code);
        });
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(exports.MCP_NOT_IMPLEMENTED_EXIT_CODE);
    }
}
