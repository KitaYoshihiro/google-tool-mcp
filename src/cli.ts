import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import {
  applySavedToken,
  createOAuthClient,
  ensureAuthorizedToken,
  GmailAuthRequiredError,
  GoogleScopeRequiredError,
  loadOAuthClientCredentials,
  type SavedToken,
} from "./auth/googleAuth";
import {
  CLI_COMMAND,
  DRIVE_METADATA_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
} from "./config/constants";
import {
  getDefaultConfigDir,
  getSharedCredentialPaths,
  isPathInConfigDir,
  resolveConfiguredPaths,
  shouldUseSharedCredentialFallback,
  type PathContext,
} from "./config/paths";
import {
  createDriveApiClient,
  DriveApiError,
  type DriveApiClient,
} from "./drive/client";
import {
  mapDriveAbout,
  mapDriveFile,
} from "./drive/files";
import { createGmailApiClient, GmailApiError, type GmailApiClient } from "./gmail/client";
import { normalizeLabelList, resolveLabelIds, GmailLabelLookupError } from "./gmail/labels";
import { createMessageList, type GmailMessage } from "./gmail/messages";

export const CLI_NOT_IMPLEMENTED_EXIT_CODE = 1;

interface CliOptions {
  bodyChars: number;
  credentials: string;
  driveAbout: boolean;
  driveCorpora: "allDrives" | "domain" | "drive" | "user";
  driveFileId: string;
  driveId: string;
  driveOrderBy: string;
  driveQuery: string;
  includeAllDrives: boolean;
  includeTrashed: boolean;
  labels: string[];
  listLabels: boolean;
  maxResults: number;
  noBody: boolean;
  printConfigDir: boolean;
  profile: string;
  query: string;
  token: string;
}

export interface CommandIO {
  out(message: string): void;
  error(message: string): void;
}

export interface CliDependencies extends PathContext {
  createDriveClient?: (options: {
    credentialsPath: string;
    token: SavedToken;
  }) => Promise<DriveApiClient> | DriveApiClient;
  createGmailClient?: (options: {
    credentialsPath: string;
    token: SavedToken;
  }) => Promise<GmailApiClient> | GmailApiClient;
  cwd?: string;
  ensureDir?: (dirPath: string) => Promise<void>;
  ensureAuthorizedToken?: typeof ensureAuthorizedToken;
  pathExists?: (filePath: string) => Promise<boolean> | boolean;
}

function parseIntegerOption(flag: string, value: string | undefined): number {
  if (value === undefined) {
    throw new Error(`Missing value for ${flag}.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer for ${flag}: ${value}`);
  }

  return parsed;
}

function parseProfileArg(arg: string, nextArg: string | undefined): string | undefined {
  if (arg === "--profile") {
    if (nextArg === undefined) {
      throw new Error("Missing value for --profile.");
    }
    return nextArg;
  }

  if (arg.startsWith("--profile=")) {
    const value = arg.slice("--profile=".length);
    if (!value) {
      throw new Error("Missing value for --profile.");
    }
    return value;
  }

  return undefined;
}

function parseCliArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    bodyChars: 1500,
    credentials: "credentials.json",
    driveAbout: false,
    driveCorpora: "user",
    driveFileId: "",
    driveId: "",
    driveOrderBy: "",
    driveQuery: "",
    includeAllDrives: false,
    includeTrashed: false,
    labels: [],
    listLabels: false,
    maxResults: 10,
    noBody: false,
    printConfigDir: false,
    profile: "",
    query: "",
    token: "token.json",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const inlineProfile = parseProfileArg(arg, args[index + 1]);

    if (inlineProfile !== undefined) {
      options.profile = inlineProfile;
      if (arg === "--profile") {
        index += 1;
      }
      continue;
    }

    switch (arg) {
      case "--credentials":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --credentials.");
        }
        options.credentials = args[index];
        break;
      case "--token":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --token.");
        }
        options.token = args[index];
        break;
      case "--print-config-dir":
        options.printConfigDir = true;
        break;
      case "--max-results":
        index += 1;
        options.maxResults = parseIntegerOption("--max-results", args[index]);
        break;
      case "--query":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --query.");
        }
        options.query = args[index];
        break;
      case "--drive-query":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --drive-query.");
        }
        options.driveQuery = args[index];
        break;
      case "--drive-file-id":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --drive-file-id.");
        }
        options.driveFileId = args[index];
        break;
      case "--drive-about":
        options.driveAbout = true;
        break;
      case "--drive-corpora":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --drive-corpora.");
        }
        {
          const corporaValue = args[index];
          if (
            corporaValue !== "allDrives" &&
            corporaValue !== "domain" &&
            corporaValue !== "drive" &&
            corporaValue !== "user"
          ) {
            throw new Error(`Invalid value for --drive-corpora: ${corporaValue}`);
          }
          options.driveCorpora = corporaValue;
        }
        break;
      case "--drive-id":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --drive-id.");
        }
        options.driveId = args[index];
        break;
      case "--drive-order-by":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --drive-order-by.");
        }
        options.driveOrderBy = args[index];
        break;
      case "--include-all-drives":
        options.includeAllDrives = true;
        break;
      case "--include-trashed":
        options.includeTrashed = true;
        break;
      case "--label":
        index += 1;
        if (args[index] === undefined) {
          throw new Error("Missing value for --label.");
        }
        options.labels.push(args[index]);
        break;
      case "--list-labels":
        options.listLabels = true;
        break;
      case "--body-chars":
        index += 1;
        options.bodyChars = parseIntegerOption("--body-chars", args[index]);
        break;
      case "--no-body":
        options.noBody = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function getCliMode(
  options: CliOptions,
): "drive_about" | "drive_file" | "drive_query" | "gmail" {
  const driveActionCount =
    Number(options.driveAbout) +
    Number(options.driveFileId.length > 0) +
    Number(options.driveQuery.length > 0);

  if (driveActionCount > 1) {
    throw new Error(
      "Choose only one of --drive-about, --drive-query, or --drive-file-id.",
    );
  }

  if (driveActionCount === 0) {
    if (
      options.driveCorpora !== "user" ||
      options.driveId ||
      options.driveOrderBy ||
      options.includeAllDrives ||
      options.includeTrashed
    ) {
      throw new Error(
        "Drive-specific options require one of --drive-about, --drive-query, or --drive-file-id.",
      );
    }

    return "gmail";
  }

  if (
    options.listLabels ||
    options.labels.length > 0 ||
    options.query ||
    options.noBody ||
    options.bodyChars !== 1500
  ) {
    throw new Error(
      "Drive options cannot be combined with Gmail-specific flags.",
    );
  }

  if (options.driveAbout) {
    if (
      options.driveCorpora !== "user" ||
      options.driveId ||
      options.driveOrderBy ||
      options.includeAllDrives ||
      options.includeTrashed
    ) {
      throw new Error(
        "--drive-about does not accept Drive search/filter flags.",
      );
    }

    return "drive_about";
  }

  if (options.driveFileId) {
    if (
      options.driveCorpora !== "user" ||
      options.driveId ||
      options.driveOrderBy ||
      options.includeAllDrives ||
      options.includeTrashed
    ) {
      throw new Error(
        "--drive-file-id does not accept Drive search/filter flags.",
      );
    }

    return "drive_file";
  }

  if (options.driveCorpora === "drive" && !options.driveId) {
    throw new Error(
      "--drive-corpora drive requires --drive-id.",
    );
  }

  return "drive_query";
}

function getCliPathModule(pathContext: PathContext): typeof path.posix | typeof path.win32 {
  const homeDir =
    pathContext.homeDir ??
    pathContext.env?.HOME ??
    pathContext.env?.USERPROFILE ??
    process.env.HOME ??
    process.env.USERPROFILE ??
    "";

  return pathContext.platform === "win32" || homeDir.includes("\\")
    ? path.win32
    : path.posix;
}

function resolveCliPath(value: string, cwd: string, pathContext: PathContext): string {
  const pathModule = getCliPathModule(pathContext);
  if (/^~[\\/]/u.test(value)) {
    const homeDir =
      pathContext.homeDir ??
      pathContext.env?.HOME ??
      pathContext.env?.USERPROFILE ??
      process.env.HOME ??
      process.env.USERPROFILE ??
      "";
    return pathModule.join(homeDir, value.slice(2));
  }

  return path.resolve(cwd, value);
}

async function pathExists(
  filePath: string,
  dependencies: CliDependencies,
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

async function createCliGmailClient(
  credentialsPath: string,
  token: SavedToken,
  dependencies: CliDependencies,
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

async function createCliDriveClient(
  credentialsPath: string,
  token: SavedToken,
  dependencies: CliDependencies,
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

function printMessage(io: CommandIO, index: number, message: GmailMessage, showBody: boolean): void {
  io.out(`[${index}] ${message.subject}`);
  io.out(`From: ${message.sender}`);
  io.out(`Date: ${message.date}`);
  io.out(`Message ID: ${message.id}`);

  if (showBody) {
    io.out("");
    io.out(message.body || message.snippet || "(body unavailable)");
  } else {
    io.out(`Snippet: ${message.snippet || "(empty)"}`);
  }

  io.out("");
  io.out("-".repeat(80));
}

function printDriveAbout(
  io: CommandIO,
  about: ReturnType<typeof mapDriveAbout>,
): void {
  const displayName = about.user.display_name || "(unknown)";
  const email =
    about.user.email_address ? ` <${about.user.email_address}>` : "";

  io.out(`User: ${displayName}${email}`);
  io.out(`Permission ID: ${about.user.permission_id || "(unknown)"}`);
  io.out(
    `Storage Usage: ${about.storage_quota.usage || "0"} / ${about.storage_quota.limit || "(unknown)"}`,
  );
  io.out(`In Drive: ${about.storage_quota.usage_in_drive || "0"}`);
  io.out(`In Trash: ${about.storage_quota.usage_in_drive_trash || "0"}`);
}

function printDriveFile(
  io: CommandIO,
  index: number | null,
  file: ReturnType<typeof mapDriveFile>,
): void {
  if (index !== null) {
    io.out(`[${index}] ${file.name || "(unnamed file)"}`);
  } else {
    io.out(file.name || "(unnamed file)");
  }

  io.out(`File ID: ${file.id}`);
  io.out(`MIME Type: ${file.mime_type || "(unknown)"}`);
  io.out(`Modified: ${file.modified_time || "(unknown)"}`);
  io.out(`Trashed: ${file.trashed ? "yes" : "no"}`);

  if (file.web_view_link) {
    io.out(`Web View: ${file.web_view_link}`);
  }

  if (file.owners.length > 0) {
    io.out(
      `Owners: ${file.owners
        .map((owner) =>
          owner.email_address
            ? `${owner.display_name || "(unknown)"} <${owner.email_address}>`
            : owner.display_name || "(unknown)")
        .join(", ")}`,
    );
  }

  if (file.parents.length > 0) {
    io.out(`Parents: ${file.parents.join(", ")}`);
  }

  io.out("");
  io.out("-".repeat(80));
}

export async function runCli(
  args: readonly string[],
  io: CommandIO = {
    out: console.log,
    error: console.error,
  },
  dependencies: CliDependencies = {},
): Promise<number> {
  try {
    const options = parseCliArgs(args);
    const mode = getCliMode(options);
    const pathContext: PathContext = {
      env: dependencies.env,
      homeDir: dependencies.homeDir,
      platform: dependencies.platform,
      profileName: options.profile || undefined,
    };

    if (options.printConfigDir) {
      io.out(getDefaultConfigDir(pathContext));
      return 0;
    }

    const configuredPaths = resolveConfiguredPaths(pathContext);
    const sharedPaths = getSharedCredentialPaths(pathContext);
    const cwd = dependencies.cwd ?? process.cwd();
    let credentialsPath =
      options.credentials === "credentials.json"
        ? configuredPaths.credentialsPath
        : resolveCliPath(options.credentials, cwd, pathContext);
    const tokenPath =
      options.token === "token.json"
        ? configuredPaths.tokenPath
        : resolveCliPath(options.token, cwd, pathContext);

    if (
      options.credentials === "credentials.json" &&
      shouldUseSharedCredentialFallback(pathContext) &&
      !(await pathExists(credentialsPath, dependencies))
    ) {
      credentialsPath = sharedPaths.credentialsPath;
    }

    if (
      isPathInConfigDir(configuredPaths.configDir, credentialsPath, pathContext.platform) ||
      isPathInConfigDir(configuredPaths.configDir, tokenPath, pathContext.platform)
    ) {
      await (dependencies.ensureDir ??
        ((dirPath: string) => mkdir(dirPath, { recursive: true })))(configuredPaths.configDir);
    }

    const authResult = await (dependencies.ensureAuthorizedToken ?? ensureAuthorizedToken)({
      credentialsPath,
      tokenPath,
      allowBrowserAuth: true,
      requireGrantedScopes: true,
      scopes: [GMAIL_READONLY_SCOPE, DRIVE_METADATA_READONLY_SCOPE],
      onAuthorizationReady(notice) {
        if (notice.manualInstructions) {
          io.error(notice.manualInstructions);
        }
      },
    });

    if (mode === "drive_about") {
      const driveClient = await createCliDriveClient(
        credentialsPath,
        authResult.token,
        dependencies,
      );
      printDriveAbout(io, mapDriveAbout(await driveClient.getAbout()));
      return 0;
    }

    if (mode === "drive_file") {
      const driveClient = await createCliDriveClient(
        credentialsPath,
        authResult.token,
        dependencies,
      );
      printDriveFile(
        io,
        null,
        mapDriveFile(await driveClient.getFile(options.driveFileId)),
      );
      return 0;
    }

    if (mode === "drive_query") {
      const driveClient = await createCliDriveClient(
        credentialsPath,
        authResult.token,
        dependencies,
      );
      const response = await driveClient.listFiles({
        corpora: options.driveCorpora,
        driveId: options.driveId || undefined,
        includeItemsFromAllDrives: options.includeAllDrives,
        includeTrashed: options.includeTrashed,
        maxResults: options.maxResults,
        orderBy: options.driveOrderBy,
        query: options.driveQuery,
      });
      const files = (response.files ?? []).map((file) => mapDriveFile(file));

      if (files.length === 0) {
        io.out("No Drive files matched the request.");
        return 0;
      }

      for (const [index, file] of files.entries()) {
        printDriveFile(io, index + 1, file);
      }

      return 0;
    }

    const gmailClient = await createCliGmailClient(
      credentialsPath,
      authResult.token,
      dependencies,
    );

    if (options.listLabels) {
      const labels = normalizeLabelList(await gmailClient.listLabels());
      for (const label of labels.labels) {
        io.out(`${label.name}\t${label.id}\t${label.type}`);
      }
      return 0;
    }

    const availableLabels =
      options.labels.length > 0 ? await gmailClient.listLabels() : [];
    const resolvedLabelIds = resolveLabelIds(options.labels, availableLabels);
    const messageIds = await gmailClient.listMessageIds({
      maxResults: options.maxResults,
      query: options.query,
      labelIds: resolvedLabelIds,
    });
    const rawMessages = await Promise.all(
      messageIds.map((messageId) => gmailClient.getMessage(messageId)),
    );
    const messageList = createMessageList({
      query: options.query,
      labels: options.labels,
      resolvedLabelIds,
      rawMessages,
      includeBody: !options.noBody,
      bodyChars: options.bodyChars,
      maxResults: options.maxResults,
    });

    if (messageList.messages.length === 0) {
      io.out("No messages matched the request.");
      return 0;
    }

    for (const [index, message] of messageList.messages.entries()) {
      printMessage(io, index + 1, message, !options.noBody);
    }

    return 0;
  } catch (error) {
    if (error instanceof GmailApiError) {
      io.error(`Gmail API error: ${error.message}`);
      return CLI_NOT_IMPLEMENTED_EXIT_CODE;
    }

    if (error instanceof DriveApiError) {
      io.error(`Drive API error: ${error.message}`);
      return CLI_NOT_IMPLEMENTED_EXIT_CODE;
    }

    if (
      error instanceof GmailAuthRequiredError ||
      error instanceof GoogleScopeRequiredError ||
      error instanceof GmailLabelLookupError ||
      error instanceof Error
    ) {
      io.error(error.message);
      return CLI_NOT_IMPLEMENTED_EXIT_CODE;
    }

    io.error(String(error));
    return CLI_NOT_IMPLEMENTED_EXIT_CODE;
  }
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
