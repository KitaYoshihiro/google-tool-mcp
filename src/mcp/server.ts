import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
  applySavedToken,
  createOAuthClient,
  ensureAuthorizedToken,
  GoogleCredentialsRequiredError,
  GmailAuthRequiredError,
  GoogleScopeRequiredError,
  loadOAuthClientCredentials,
  type InteractiveAuthorizationNotice,
  type SavedToken,
} from "../auth/googleAuth";
import {
  DRIVE_METADATA_READONLY_SCOPE,
  ENV_CREDENTIALS_PATH,
  ENV_PROFILE,
  ENV_TOKEN_PATH,
  GMAIL_READONLY_SCOPE,
} from "../config/constants";
import {
  createDriveFileList,
  mapDriveAbout,
  mapDriveFile,
} from "../drive/files";
import {
  createDriveApiClient,
  type DriveApiClient,
} from "../drive/client";
import {
  getDefaultCacheDir,
  getSharedCredentialPaths,
  isPathInConfigDir,
  resolveConfiguredPaths,
  resolveProfileName,
  shouldUseSharedCredentialFallback,
  type PathContext,
} from "../config/paths";
import {
  createGmailApiClient,
  type GmailApiClient,
} from "../gmail/client";
import {
  findGmailAttachmentPart,
  listGmailAttachments,
  readGmailAttachmentText,
} from "../gmail/attachments";
import {
  normalizeLabelList,
  resolveLabelIds,
} from "../gmail/labels";
import {
  createMessageList,
  mapRawMessage,
} from "../gmail/messages";

export const MCP_NOT_IMPLEMENTED_EXIT_CODE = 1;
const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const MCP_PROTOCOL_VERSION =
  SUPPORTED_MCP_PROTOCOL_VERSIONS[0];
const MCP_SERVER_NAME = "google-tool";
const MCP_SERVER_VERSION = "0.1.0";
const DEFAULT_ATTACHMENT_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

type JsonRpcId = number | string;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error?: {
    code: number;
    message: string;
  };
  result?: unknown;
}

interface ToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
}

interface ToolCallSuccessResult {
  content: Array<{
    text: string;
    type: "text";
  }>;
  isError: false;
  structuredContent: unknown;
}

interface ToolCallErrorResult {
  content: Array<{
    text: string;
    type: "text";
  }>;
  isError: true;
}

interface ProtocolState {
  phase: "pre_init" | "awaiting_initialized" | "ready";
}

interface PendingAuthorizationState {
  failureMessage?: string;
  notices: InteractiveAuthorizationNotice[];
  startedAt: number;
  status: "failed" | "pending";
}

interface ServerFeatureFlags {
  driveEnabled: boolean;
  gmailEnabled: boolean;
}

interface McpCliOptions {
  driveEnabled: boolean;
  gmailEnabled: boolean;
  profileName?: string;
}

export interface CommandIO {
  error(message: string): void;
}

export interface McpServerDependencies extends PathContext {
  authorizationSessions?: Map<string, PendingAuthorizationState>;
  createDriveClient?: (options: {
    credentialsPath: string;
    token: SavedToken;
  }) => Promise<DriveApiClient> | DriveApiClient;
  createGmailClient?: (options: {
    credentialsPath: string;
    token: SavedToken;
  }) => Promise<GmailApiClient> | GmailApiClient;
  ensureDir?: (dirPath: string) => Promise<void>;
  ensureAuthorizedToken?: typeof ensureAuthorizedToken;
  driveEnabled?: boolean;
  gmailEnabled?: boolean;
  onAuthorizationReady?: (
    notice: InteractiveAuthorizationNotice,
  ) => void | Promise<void>;
  onBackgroundAuthorizationError?: (error: unknown) => void | Promise<void>;
  pathExists?: (filePath: string) => Promise<boolean> | boolean;
  stdin?: Readable;
  stdout?: Writable;
}

const GMAIL_TOOL_DEFINITIONS: ToolDefinition[] = [
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
    description: "List attachments on one Gmail message. Use the returned part_id, not Gmail's internal attachmentId, when reading or downloading an attachment.",
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
    description: "Read a supported text attachment from one Gmail message using the immutable part_id returned by list_gmail_attachments.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string" },
        part_id: {
          type: "string",
          description: "Immutable Gmail message part ID returned by list_gmail_attachments.",
        },
        max_bytes: { type: "integer", default: 1048576 },
        max_chars: { type: "integer", default: 5000 },
      },
      required: ["message_id", "part_id"],
    },
  },
  {
    name: "download_gmail_attachment",
    description: "Download one Gmail attachment, selected by the immutable part_id returned by list_gmail_attachments, to a local file and return metadata only. The attachment content is not returned in the MCP response.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string" },
        part_id: {
          type: "string",
          description: "Immutable Gmail message part ID returned by list_gmail_attachments.",
        },
        download_dir: {
          type: "string",
          description: "Optional target directory. Defaults to a profile-specific cache directory under ~/.cache/google-tool/attachments/.",
        },
        max_bytes: {
          type: "integer",
          default: DEFAULT_ATTACHMENT_DOWNLOAD_MAX_BYTES,
        },
        overwrite: {
          type: "boolean",
          default: false,
        },
      },
      required: ["message_id", "part_id"],
    },
  },
];

const DRIVE_TOOL_DEFINITIONS: ToolDefinition[] = [
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

const COMMON_TOOL_DEFINITIONS: ToolDefinition[] = [
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

function getInstructions(features: ServerFeatureFlags): string {
  const capabilitySentence =
    features.gmailEnabled && features.driveEnabled
      ? "Read Gmail messages, supported Gmail text attachments, and Google Drive file metadata from the authorized account. "
      : features.gmailEnabled
        ? "Read Gmail messages and supported Gmail text attachments from the authorized account. "
        : features.driveEnabled
          ? "Read Google Drive file metadata from the authorized account. "
          : "All Gmail and Drive tool groups are disabled by server configuration. ";

  return (
    capabilitySentence +
    `If OAuth is not initialized, configure credentials first: place credentials.json in the config directory or set ${ENV_CREDENTIALS_PATH}. ` +
    `${ENV_PROFILE} selects a profile, ${ENV_TOKEN_PATH} can point to an existing token, and the first tool call can launch browser auth after credentials are configured.`
  );
}

function negotiateProtocolVersion(requestedVersion: unknown): string {
  if (
    typeof requestedVersion === "string" &&
    SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(
      requestedVersion as (typeof SUPPORTED_MCP_PROTOCOL_VERSIONS)[number],
    )
  ) {
    return requestedVersion;
  }

  return MCP_PROTOCOL_VERSION;
}

function getToolDefinitions(features: ServerFeatureFlags): ToolDefinition[] {
  return [
    ...((features.gmailEnabled || features.driveEnabled) ? COMMON_TOOL_DEFINITIONS : []),
    ...(features.gmailEnabled ? GMAIL_TOOL_DEFINITIONS : []),
    ...(features.driveEnabled ? DRIVE_TOOL_DEFINITIONS : []),
  ];
}

function parseToggleOptionValue(flagName: string, value: string | undefined): boolean {
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

function resolveServerFeatures(
  options: Partial<ServerFeatureFlags>,
): ServerFeatureFlags {
  return {
    gmailEnabled: options.gmailEnabled ?? true,
    driveEnabled: options.driveEnabled ?? true,
  };
}

function isToolEnabled(
  toolName: string,
  features: ServerFeatureFlags,
): boolean {
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

function isKnownTool(toolName: string): boolean {
  return COMMON_TOOL_NAMES.has(toolName) || GMAIL_TOOL_NAMES.has(toolName) || DRIVE_TOOL_NAMES.has(toolName);
}

function getAuthorizationScopes(features: ServerFeatureFlags): string[] {
  const scopes: string[] = [];

  if (features.gmailEnabled) {
    scopes.push(GMAIL_READONLY_SCOPE);
  }

  if (features.driveEnabled) {
    scopes.push(DRIVE_METADATA_READONLY_SCOPE);
  }

  return scopes;
}

async function buildWhoAmIResult(
  configuredPaths: {
    credentialsPath: string;
    tokenPath: string;
  },
  pathContext: PathContext,
  features: ServerFeatureFlags,
  dependencies: McpServerDependencies,
): Promise<{
  account_email: string;
  display_name: string;
  enabled_features: {
    drive: boolean;
    gmail: boolean;
  };
  identity_source: "drive" | "gmail";
  profile_name: string;
}> {
  const profileName = resolveProfileName(pathContext) ?? "";

  if (features.gmailEnabled) {
    const gmailClient = await createAuthorizedGmailClient(
      configuredPaths.credentialsPath,
      await authorizeForTool(configuredPaths, features, dependencies, {
        scopes: [GMAIL_READONLY_SCOPE],
      }),
      dependencies,
    );
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

  const driveClient = await createAuthorizedDriveClient(
    configuredPaths.credentialsPath,
    await authorizeForTool(configuredPaths, features, dependencies, {
      requireGrantedScopes: true,
      scopes: [DRIVE_METADATA_READONLY_SCOPE],
    }),
    dependencies,
  );
  const about = mapDriveAbout(await driveClient.getAbout());

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

export function parseMcpServerArgs(args: readonly string[]): McpCliOptions {
  const options: McpCliOptions = {
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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(
  value: unknown,
  fieldName: string,
  fallback?: string,
): string {
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

function readInteger(
  value: unknown,
  fieldName: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function readBoolean(
  value: unknown,
  fieldName: string,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value;
}

function readStringArray(
  value: unknown,
  fieldName: string,
): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return [...value];
}

function readCorpora(
  value: unknown,
  fieldName: string,
  fallback: "allDrives" | "domain" | "drive" | "user",
): "allDrives" | "domain" | "drive" | "user" {
  const corpora = readString(value, fieldName, fallback);
  if (
    corpora !== "allDrives" &&
    corpora !== "domain" &&
    corpora !== "drive" &&
    corpora !== "user"
  ) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return corpora;
}

function getPathModuleForTarget(
  targetPath: string,
  platform?: NodeJS.Platform,
): typeof path.posix | typeof path.win32 {
  return platform === "win32" || targetPath.includes("\\") ? path.win32 : path.posix;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[\u0000-\u001f\u007f/\\:<>|?*]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .slice(0, 128);

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return fallback;
  }

  return sanitized;
}

function sanitizeFileName(filename: string): string {
  const normalizedFileName = filename.trim().replace(/\\/gu, "/");
  const segments = normalizedFileName.split("/").filter(Boolean);
  return sanitizePathSegment(segments[segments.length - 1] ?? filename, "attachment");
}

function buildAttachmentDownloadDir(
  pathContext: PathContext,
  downloadDir: string,
  messageId: string,
): string {
  if (downloadDir.trim()) {
    return downloadDir;
  }

  const cacheDir = getDefaultCacheDir(pathContext);
  const pathModule = getPathModuleForTarget(cacheDir, pathContext.platform);
  const profileName = resolveProfileName(pathContext) ?? "default";

  return pathModule.join(
    cacheDir,
    "attachments",
    sanitizePathSegment(profileName, "default"),
    sanitizePathSegment(messageId, "message"),
  );
}

function buildAttachmentFileName(partId: string, filename: string): string {
  return `${sanitizePathSegment(partId, "attachment")}-${sanitizeFileName(filename)}`;
}

function appendFileNameSuffix(
  pathModule: typeof path.posix | typeof path.win32,
  filePath: string,
  suffix: number,
): string {
  const parsed = pathModule.parse(filePath);
  return pathModule.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
}

async function writeAttachmentFile(options: {
  buffer: Buffer;
  overwrite: boolean;
  targetDir: string;
  targetFileName: string;
  platform?: NodeJS.Platform;
}): Promise<string> {
  await mkdir(options.targetDir, { recursive: true, mode: 0o700 });

  const pathModule = getPathModuleForTarget(options.targetDir, options.platform);
  const targetPath = pathModule.join(options.targetDir, options.targetFileName);
  if (options.overwrite) {
    await writeFile(targetPath, options.buffer, { mode: 0o600 });
    return targetPath;
  }

  for (let index = 0; index < 1000; index += 1) {
    const candidatePath =
      index === 0 ? targetPath : appendFileNameSuffix(pathModule, targetPath, index);
    try {
      await writeFile(candidatePath, options.buffer, {
        flag: "wx",
        mode: 0o600,
      });
      return candidatePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  throw new Error("Could not choose a unique attachment download path.");
}

async function createAuthorizedGmailClient(
  credentialsPath: string,
  token: SavedToken,
  dependencies: McpServerDependencies,
): Promise<GmailApiClient> {
  if (dependencies.createGmailClient) {
    return dependencies.createGmailClient({
      credentialsPath,
      token,
    });
  }

  const credentials = await loadOAuthClientCredentials(credentialsPath);
  const authClient = createOAuthClient(credentials);
  applySavedToken(authClient, token);

  return createGmailApiClient({
    async getRequestHeaders(url) {
      return authClient.getRequestHeaders(url);
    },
  });
}

async function createAuthorizedDriveClient(
  credentialsPath: string,
  token: SavedToken,
  dependencies: McpServerDependencies,
): Promise<DriveApiClient> {
  if (dependencies.createDriveClient) {
    return dependencies.createDriveClient({
      credentialsPath,
      token,
    });
  }

  const credentials = await loadOAuthClientCredentials(credentialsPath);
  const authClient = createOAuthClient(credentials);
  applySavedToken(authClient, token);

  return createDriveApiClient({
    async getRequestHeaders(url) {
      return authClient.getRequestHeaders(url);
    },
  });
}

function buildToolSuccessResult(value: unknown): ToolCallSuccessResult {
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

function buildToolErrorResult(error: unknown): ToolCallErrorResult {
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
  constructor(message: string) {
    super(message);
    this.name = "McpAuthorizationPendingError";
  }
}

function formatAuthorizationRetryMessage(suffix: string): string {
  return `${suffix} After completing Google authorization, retry the same request.`;
}

function formatBackgroundAuthorizationFailure(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const trailingPunctuation = /[.!?]$/u.test(message) ? "" : ".";
  return `The previous Google authorization attempt did not finish successfully: ${message}${trailingPunctuation} Retry the same request to start authorization again.`;
}

async function pathExists(
  filePath: string,
  dependencies: McpServerDependencies,
): Promise<boolean> {
  if (dependencies.pathExists) {
    return dependencies.pathExists(filePath);
  }

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function emitStartupDiagnostics(
  io: CommandIO,
  dependencies: McpServerDependencies,
): Promise<void> {
  const pathContext: PathContext = {
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
  io.error(
    `google-tool-mcp: credentials: ${credentialsPresent ? "found" : "missing"} at ${configuredPaths.credentialsPath}`,
  );
  io.error(
    `google-tool-mcp: token: ${tokenPresent ? "found" : "missing"} at ${configuredPaths.tokenPath}`,
  );
  io.error(
    `google-tool-mcp: features: gmail=${features.gmailEnabled ? "enabled" : "disabled"}, drive=${features.driveEnabled ? "enabled" : "disabled"}`,
  );
  io.error(
    "google-tool-mcp: startup defers OAuth until tool calls. If credentials are present and the token is missing, the first tool call can launch browser auth.",
  );
}

async function resolveRuntimePaths(
  pathContext: PathContext,
  dependencies: Pick<McpServerDependencies, "pathExists">,
) {
  const configuredPaths = resolveConfiguredPaths(pathContext);
  if (!shouldUseSharedCredentialFallback(pathContext)) {
    return configuredPaths;
  }

  if (await pathExists(configuredPaths.credentialsPath, dependencies)) {
    return configuredPaths;
  }

  return {
    ...configuredPaths,
    credentialsPath: getSharedCredentialPaths(pathContext).credentialsPath,
  };
}

async function authorizeForTool(
  configuredPaths: {
    credentialsPath: string;
    tokenPath: string;
  },
  features: ServerFeatureFlags,
  dependencies: McpServerDependencies,
  options: {
    requireGrantedScopes?: boolean;
    scopes: readonly string[];
  },
): Promise<SavedToken> {
  const credentialsExists = await pathExists(configuredPaths.credentialsPath, dependencies);
  const authorizationScopes = getAuthorizationScopes(features);
  const requireGrantedScopes =
    options.requireGrantedScopes ??
    authorizationScopes.length > options.scopes.length;
  const sessions = dependencies.authorizationSessions;
  const existingSession = sessions?.get(configuredPaths.tokenPath);

  if (existingSession?.status === "failed") {
    sessions?.delete(configuredPaths.tokenPath);
    throw new Error(
      existingSession.failureMessage ??
        "The previous Google authorization attempt did not finish successfully. Retry the same request to start authorization again.",
    );
  }

  if (existingSession?.status === "pending") {
    const latestNotice = existingSession.notices.at(-1);
    const retryMessage = latestNotice?.manualInstructions
      ? formatAuthorizationRetryMessage(
          `${latestNotice.manualInstructions}\nThe MCP server is still waiting for Google authorization to finish.`,
        )
      : formatAuthorizationRetryMessage(
          "The MCP server is still waiting for Google authorization to finish.",
        );
    throw new McpAuthorizationPendingError(retryMessage);
  }

  if (!credentialsExists) {
    throw new GoogleCredentialsRequiredError(
      configuredPaths.credentialsPath,
      configuredPaths.tokenPath,
    );
  }

  try {
    const authResult = await (dependencies.ensureAuthorizedToken ?? ensureAuthorizedToken)({
      credentialsPath: configuredPaths.credentialsPath,
      tokenPath: configuredPaths.tokenPath,
      allowBrowserAuth: false,
      requireGrantedScopes,
      scopes: authorizationScopes,
      onAuthorizationReady: dependencies.onAuthorizationReady,
    });

    return authResult.token;
  } catch (error) {
    if (
      !credentialsExists ||
      (!(error instanceof GmailAuthRequiredError) &&
        !(error instanceof GoogleScopeRequiredError))
    ) {
      throw error;
    }

    const nextSession: PendingAuthorizationState = {
      status: "pending",
      notices: [],
      startedAt: Date.now(),
    };
    sessions?.set(configuredPaths.tokenPath, nextSession);

    void (async () => {
      try {
        await (dependencies.ensureAuthorizedToken ?? ensureAuthorizedToken)({
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
      } catch (error) {
        nextSession.status = "failed";
        nextSession.failureMessage = formatBackgroundAuthorizationFailure(error);
        await dependencies.onBackgroundAuthorizationError?.(error);
      } finally {
        if (nextSession.status === "pending") {
          sessions?.delete(configuredPaths.tokenPath);
        }
      }
    })();

    throw new McpAuthorizationPendingError(
      formatAuthorizationRetryMessage(
        "Google authorization has started. Complete it in the browser.",
      ),
    );
  }
}

async function callTool(
  toolName: string,
  toolArguments: Record<string, unknown>,
  dependencies: McpServerDependencies,
): Promise<ToolCallSuccessResult | ToolCallErrorResult> {
  try {
    const features = resolveServerFeatures(dependencies);
    if (!isToolEnabled(toolName, features)) {
      if (isKnownTool(toolName)) {
        return buildToolErrorResult(new Error(`Tool is disabled by server configuration: ${toolName}`));
      }
      return buildToolErrorResult(new Error(`Unknown tool: ${toolName}`));
    }

    const pathContext: PathContext = {
      env: dependencies.env,
      homeDir: dependencies.homeDir,
      platform: dependencies.platform,
      profileName: dependencies.profileName,
    };
    const configuredPaths = await resolveRuntimePaths(pathContext, dependencies);
    if (
      isPathInConfigDir(configuredPaths.configDir, configuredPaths.credentialsPath, pathContext.platform) ||
      isPathInConfigDir(configuredPaths.configDir, configuredPaths.tokenPath, pathContext.platform)
    ) {
      await (dependencies.ensureDir ??
        ((dirPath: string) => mkdir(dirPath, { recursive: true })))(configuredPaths.configDir);
    }

    if (toolName === "whoami") {
      return buildToolSuccessResult(
        await buildWhoAmIResult(configuredPaths, pathContext, features, dependencies),
      );
    }

    if (toolName === "list_gmail_labels") {
      const gmailClient = await createAuthorizedGmailClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          scopes: [GMAIL_READONLY_SCOPE],
        }),
        dependencies,
      );
      const labels = normalizeLabelList(await gmailClient.listLabels());
      return buildToolSuccessResult(labels);
    }

    if (toolName === "list_gmail_messages") {
      const maxResults = readInteger(toolArguments.max_results, "max_results", 10);
      const query = readString(toolArguments.query, "query", "");
      const labels = readStringArray(toolArguments.labels, "labels");
      const includeBody = readBoolean(toolArguments.include_body, "include_body", false);
      const bodyChars = readInteger(toolArguments.body_chars, "body_chars", 1500);
      const gmailClient = await createAuthorizedGmailClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          scopes: [GMAIL_READONLY_SCOPE],
        }),
        dependencies,
      );
      const availableLabels =
        labels.length > 0 ? await gmailClient.listLabels() : [];
      const resolvedLabelIds = resolveLabelIds(labels, availableLabels);
      const messageIds = await gmailClient.listMessageIds({
        maxResults,
        query,
        labelIds: resolvedLabelIds,
      });
      const rawMessages = await Promise.all(
        messageIds.map((messageId) => gmailClient.getMessage(messageId)),
      );
      return buildToolSuccessResult(
        createMessageList({
          query,
          labels,
          resolvedLabelIds,
          rawMessages,
          includeBody,
          bodyChars,
          maxResults,
        }),
      );
    }

    if (toolName === "read_gmail_message") {
      const messageId = readString(toolArguments.message_id, "message_id");
      const includeBody = readBoolean(toolArguments.include_body, "include_body", true);
      const bodyChars = readInteger(toolArguments.body_chars, "body_chars", 5000);
      const gmailClient = await createAuthorizedGmailClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          scopes: [GMAIL_READONLY_SCOPE],
        }),
        dependencies,
      );
      const rawMessage = await gmailClient.getMessage(messageId);
      return buildToolSuccessResult(
        mapRawMessage(rawMessage, {
          includeBody,
          bodyChars,
        }),
      );
    }

    if (toolName === "list_gmail_attachments") {
      const messageId = readString(toolArguments.message_id, "message_id");
      const gmailClient = await createAuthorizedGmailClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          scopes: [GMAIL_READONLY_SCOPE],
        }),
        dependencies,
      );
      return buildToolSuccessResult(
        listGmailAttachments(await gmailClient.getMessage(messageId)),
      );
    }

    if (toolName === "read_gmail_attachment_text") {
      const messageId = readString(toolArguments.message_id, "message_id");
      const partId = readString(toolArguments.part_id, "part_id");
      const maxBytes = readInteger(toolArguments.max_bytes, "max_bytes", 1024 * 1024);
      const maxChars = readInteger(toolArguments.max_chars, "max_chars", 5000);
      const gmailClient = await createAuthorizedGmailClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          scopes: [GMAIL_READONLY_SCOPE],
        }),
        dependencies,
      );
      const message = await gmailClient.getMessage(messageId);
      const attachmentPart = findGmailAttachmentPart(message, partId);
      if (!attachmentPart) {
        throw new Error(`Attachment part was not found in message: ${partId}`);
      }
      if (attachmentPart.metadata.size > maxBytes) {
        throw new Error(
          `Attachment is too large to read as text: ${attachmentPart.metadata.size} bytes exceeds max_bytes ${maxBytes}.`,
        );
      }
      const attachment = await gmailClient.getAttachment(
        messageId,
        attachmentPart.attachmentId,
      );
      return buildToolSuccessResult(
        readGmailAttachmentText({
          attachment,
          maxBytes,
          maxChars,
          message,
          partId,
        }),
      );
    }

    if (toolName === "download_gmail_attachment") {
      const messageId = readString(toolArguments.message_id, "message_id");
      const partId = readString(toolArguments.part_id, "part_id");
      const downloadDir = readString(toolArguments.download_dir, "download_dir", "");
      const maxBytes = readInteger(
        toolArguments.max_bytes,
        "max_bytes",
        DEFAULT_ATTACHMENT_DOWNLOAD_MAX_BYTES,
      );
      const overwrite = readBoolean(toolArguments.overwrite, "overwrite", false);
      const gmailClient = await createAuthorizedGmailClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          scopes: [GMAIL_READONLY_SCOPE],
        }),
        dependencies,
      );
      const message = await gmailClient.getMessage(messageId);
      const attachmentPart = findGmailAttachmentPart(message, partId);
      if (!attachmentPart) {
        throw new Error(`Attachment part was not found in message: ${partId}`);
      }
      if (attachmentPart.metadata.size > maxBytes) {
        throw new Error(
          `Attachment is too large to download: ${attachmentPart.metadata.size} bytes exceeds max_bytes ${maxBytes}.`,
        );
      }

      const attachment = await gmailClient.getAttachment(
        messageId,
        attachmentPart.attachmentId,
      );
      if (!attachment.data) {
        throw new Error(`Attachment data was not returned for part: ${partId}`);
      }

      const buffer = Buffer.from(attachment.data, "base64url");
      if (buffer.byteLength > maxBytes) {
        throw new Error(
          `Attachment is too large to download: ${buffer.byteLength} bytes exceeds max_bytes ${maxBytes}.`,
        );
      }

      const targetDir = buildAttachmentDownloadDir(pathContext, downloadDir, messageId);
      const savedPath = await writeAttachmentFile({
        buffer,
        overwrite,
        platform: pathContext.platform,
        targetDir,
        targetFileName: buildAttachmentFileName(
          partId,
          attachmentPart.metadata.filename,
        ),
      });

      return buildToolSuccessResult({
        content_returned: false,
        filename: attachmentPart.metadata.filename,
        message_id: messageId,
        mime_type: attachmentPart.metadata.mime_type,
        part_id: partId,
        saved_path: savedPath,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        size: buffer.byteLength,
      });
    }

    if (toolName === "get_drive_about") {
      const driveClient = await createAuthorizedDriveClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          requireGrantedScopes: true,
          scopes: [DRIVE_METADATA_READONLY_SCOPE],
        }),
        dependencies,
      );

      return buildToolSuccessResult(mapDriveAbout(await driveClient.getAbout()));
    }

    if (toolName === "list_drive_files") {
      const maxResults = readInteger(toolArguments.max_results, "max_results", 10);
      const query = readString(toolArguments.query, "query", "");
      const includeTrashed = readBoolean(
        toolArguments.include_trashed,
        "include_trashed",
        false,
      );
      const corpora = readCorpora(toolArguments.corpora, "corpora", "user");
      const driveId = readString(toolArguments.drive_id, "drive_id", "");
      const includeItemsFromAllDrives = readBoolean(
        toolArguments.include_items_from_all_drives,
        "include_items_from_all_drives",
        false,
      );
      const orderBy = readString(toolArguments.order_by, "order_by", "");
      const driveClient = await createAuthorizedDriveClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          requireGrantedScopes: true,
          scopes: [DRIVE_METADATA_READONLY_SCOPE],
        }),
        dependencies,
      );
      const response = await driveClient.listFiles({
        corpora,
        driveId: driveId || undefined,
        includeItemsFromAllDrives,
        includeTrashed,
        maxResults,
        orderBy,
        query,
      });

      return buildToolSuccessResult(
        createDriveFileList({
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
        }),
      );
    }

    if (toolName === "read_drive_file") {
      const fileId = readString(toolArguments.file_id, "file_id");
      const driveClient = await createAuthorizedDriveClient(
        configuredPaths.credentialsPath,
        await authorizeForTool(configuredPaths, features, dependencies, {
          requireGrantedScopes: true,
          scopes: [DRIVE_METADATA_READONLY_SCOPE],
        }),
        dependencies,
      );

      return buildToolSuccessResult(mapDriveFile(await driveClient.getFile(fileId)));
    }

    return buildToolErrorResult(new Error(`Unknown tool: ${toolName}`));
  } catch (error) {
    if (error instanceof GoogleScopeRequiredError) {
      return buildToolErrorResult(error);
    }

    return buildToolErrorResult(error);
  }
}

function createErrorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function getMessageMethod(message: unknown): string | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }

  const candidate = message as Record<string, unknown>;
  return typeof candidate.method === "string" ? candidate.method : null;
}

export function createMcpProtocolHandler(
  dependencies: McpServerDependencies = {},
): {
  handleMessage(message: unknown): Promise<JsonRpcResponse | null>;
} {
  const runtimeDependencies: McpServerDependencies = {
    ...dependencies,
    authorizationSessions:
      dependencies.authorizationSessions ??
      new Map<string, PendingAuthorizationState>(),
  };
  const features = resolveServerFeatures(runtimeDependencies);
  const state: ProtocolState = {
    phase: "pre_init",
  };

  return {
    async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
      const request = asObject(message);
      const id =
        typeof request.id === "number" || typeof request.id === "string"
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
          result: await callTool(
            params.name,
            asObject(params.arguments),
            runtimeDependencies,
          ),
        };
      }

      return createErrorResponse(id, -32601, "Method not found");
    },
  };
}

export async function runMcpServer(
  io: CommandIO = { error: console.error },
  dependencies: McpServerDependencies = {},
): Promise<number> {
  const runtimeDependencies: McpServerDependencies = {
    ...dependencies,
    authorizationSessions:
      dependencies.authorizationSessions ??
      new Map<string, PendingAuthorizationState>(),
    onAuthorizationReady:
      dependencies.onAuthorizationReady ??
      ((notice) => {
        if (notice.manualInstructions) {
          io.error(notice.manualInstructions);
          return;
        }

        if (notice.browserOpened) {
          io.error("google-tool-mcp: opened browser for Google authorization; waiting for completion.");
        }
      }),
    onBackgroundAuthorizationError:
      dependencies.onBackgroundAuthorizationError ??
      ((error) => {
        io.error(error instanceof Error ? error.message : String(error));
      }),
  };

  await emitStartupDiagnostics(io, runtimeDependencies);
  const handler = createMcpProtocolHandler(runtimeDependencies);
  const stdin = runtimeDependencies.stdin ?? process.stdin;
  const stdout = runtimeDependencies.stdout ?? process.stdout;
  const rl = createInterface({ input: stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      io.error("google-tool-mcp: received invalid JSON line");
      stdout.write(JSON.stringify(createErrorResponse(null, -32700, "Parse error")) + "\n");
      continue;
    }

    try {
      const method = getMessageMethod(parsed);
      if (method === "initialize") {
        io.error("google-tool-mcp: received initialize request");
      } else if (method === "notifications/initialized") {
        io.error("google-tool-mcp: received initialized notification");
      }

      const response = await handler.handleMessage(parsed);
      if (response) {
        stdout.write(JSON.stringify(response) + "\n");
        if (method === "initialize") {
          io.error("google-tool-mcp: sent initialize response");
        }
      }
    } catch (error) {
      io.error(error instanceof Error ? error.message : String(error));
    }
  }

  io.error("google-tool-mcp: stdin closed");

  return 0;
}

if (require.main === module) {
  try {
    const options = parseMcpServerArgs(process.argv.slice(2));
    void runMcpServer(
      { error: console.error },
      {
        profileName: options.profileName,
        gmailEnabled: options.gmailEnabled,
        driveEnabled: options.driveEnabled,
      },
    ).then((code) => {
      process.exit(code);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(MCP_NOT_IMPLEMENTED_EXIT_CODE);
  }
}
