"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLI_NOT_IMPLEMENTED_EXIT_CODE = void 0;
exports.runCli = runCli;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const googleAuth_1 = require("./auth/googleAuth");
const constants_1 = require("./config/constants");
const paths_1 = require("./config/paths");
const client_1 = require("./drive/client");
const files_1 = require("./drive/files");
const client_2 = require("./gmail/client");
const labels_1 = require("./gmail/labels");
const messages_1 = require("./gmail/messages");
exports.CLI_NOT_IMPLEMENTED_EXIT_CODE = 1;
function parseIntegerOption(flag, value) {
    if (value === undefined) {
        throw new Error(`Missing value for ${flag}.`);
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error(`Invalid non-negative integer for ${flag}: ${value}`);
    }
    return parsed;
}
function parseProfileArg(arg, nextArg) {
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
function parseCliArgs(args) {
    const options = {
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
                    if (corporaValue !== "allDrives" &&
                        corporaValue !== "domain" &&
                        corporaValue !== "drive" &&
                        corporaValue !== "user") {
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
function getCliMode(options) {
    const driveActionCount = Number(options.driveAbout) +
        Number(options.driveFileId.length > 0) +
        Number(options.driveQuery.length > 0);
    if (driveActionCount > 1) {
        throw new Error("Choose only one of --drive-about, --drive-query, or --drive-file-id.");
    }
    if (driveActionCount === 0) {
        if (options.driveCorpora !== "user" ||
            options.driveId ||
            options.driveOrderBy ||
            options.includeAllDrives ||
            options.includeTrashed) {
            throw new Error("Drive-specific options require one of --drive-about, --drive-query, or --drive-file-id.");
        }
        return "gmail";
    }
    if (options.listLabels ||
        options.labels.length > 0 ||
        options.query ||
        options.noBody ||
        options.bodyChars !== 1500) {
        throw new Error("Drive options cannot be combined with Gmail-specific flags.");
    }
    if (options.driveAbout) {
        if (options.driveCorpora !== "user" ||
            options.driveId ||
            options.driveOrderBy ||
            options.includeAllDrives ||
            options.includeTrashed) {
            throw new Error("--drive-about does not accept Drive search/filter flags.");
        }
        return "drive_about";
    }
    if (options.driveFileId) {
        if (options.driveCorpora !== "user" ||
            options.driveId ||
            options.driveOrderBy ||
            options.includeAllDrives ||
            options.includeTrashed) {
            throw new Error("--drive-file-id does not accept Drive search/filter flags.");
        }
        return "drive_file";
    }
    if (options.driveCorpora === "drive" && !options.driveId) {
        throw new Error("--drive-corpora drive requires --drive-id.");
    }
    return "drive_query";
}
function getCliPathModule(pathContext) {
    const homeDir = pathContext.homeDir ??
        pathContext.env?.HOME ??
        pathContext.env?.USERPROFILE ??
        process.env.HOME ??
        process.env.USERPROFILE ??
        "";
    return pathContext.platform === "win32" || homeDir.includes("\\")
        ? node_path_1.default.win32
        : node_path_1.default.posix;
}
function resolveCliPath(value, cwd, pathContext) {
    const pathModule = getCliPathModule(pathContext);
    if (/^~[\\/]/u.test(value)) {
        const homeDir = pathContext.homeDir ??
            pathContext.env?.HOME ??
            pathContext.env?.USERPROFILE ??
            process.env.HOME ??
            process.env.USERPROFILE ??
            "";
        return pathModule.join(homeDir, value.slice(2));
    }
    return node_path_1.default.resolve(cwd, value);
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
async function createCliGmailClient(credentialsPath, token, dependencies) {
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
async function createCliDriveClient(credentialsPath, token, dependencies) {
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
function printMessage(io, index, message, showBody) {
    io.out(`[${index}] ${message.subject}`);
    io.out(`From: ${message.sender}`);
    io.out(`Date: ${message.date}`);
    io.out(`Message ID: ${message.id}`);
    if (showBody) {
        io.out("");
        io.out(message.body || message.snippet || "(body unavailable)");
    }
    else {
        io.out(`Snippet: ${message.snippet || "(empty)"}`);
    }
    io.out("");
    io.out("-".repeat(80));
}
function printDriveAbout(io, about) {
    const displayName = about.user.display_name || "(unknown)";
    const email = about.user.email_address ? ` <${about.user.email_address}>` : "";
    io.out(`User: ${displayName}${email}`);
    io.out(`Permission ID: ${about.user.permission_id || "(unknown)"}`);
    io.out(`Storage Usage: ${about.storage_quota.usage || "0"} / ${about.storage_quota.limit || "(unknown)"}`);
    io.out(`In Drive: ${about.storage_quota.usage_in_drive || "0"}`);
    io.out(`In Trash: ${about.storage_quota.usage_in_drive_trash || "0"}`);
}
function printDriveFile(io, index, file) {
    if (index !== null) {
        io.out(`[${index}] ${file.name || "(unnamed file)"}`);
    }
    else {
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
        io.out(`Owners: ${file.owners
            .map((owner) => owner.email_address
            ? `${owner.display_name || "(unknown)"} <${owner.email_address}>`
            : owner.display_name || "(unknown)")
            .join(", ")}`);
    }
    if (file.parents.length > 0) {
        io.out(`Parents: ${file.parents.join(", ")}`);
    }
    io.out("");
    io.out("-".repeat(80));
}
async function runCli(args, io = {
    out: console.log,
    error: console.error,
}, dependencies = {}) {
    try {
        const options = parseCliArgs(args);
        const mode = getCliMode(options);
        const pathContext = {
            env: dependencies.env,
            homeDir: dependencies.homeDir,
            platform: dependencies.platform,
            profileName: options.profile || undefined,
        };
        if (options.printConfigDir) {
            io.out((0, paths_1.getDefaultConfigDir)(pathContext));
            return 0;
        }
        const configuredPaths = (0, paths_1.resolveConfiguredPaths)(pathContext);
        const sharedPaths = (0, paths_1.getSharedCredentialPaths)(pathContext);
        const cwd = dependencies.cwd ?? process.cwd();
        let credentialsPath = options.credentials === "credentials.json"
            ? configuredPaths.credentialsPath
            : resolveCliPath(options.credentials, cwd, pathContext);
        const tokenPath = options.token === "token.json"
            ? configuredPaths.tokenPath
            : resolveCliPath(options.token, cwd, pathContext);
        if (options.credentials === "credentials.json" &&
            (0, paths_1.shouldUseSharedCredentialFallback)(pathContext) &&
            !(await pathExists(credentialsPath, dependencies))) {
            credentialsPath = sharedPaths.credentialsPath;
        }
        if ((0, paths_1.isPathInConfigDir)(configuredPaths.configDir, credentialsPath, pathContext.platform) ||
            (0, paths_1.isPathInConfigDir)(configuredPaths.configDir, tokenPath, pathContext.platform)) {
            await (dependencies.ensureDir ??
                ((dirPath) => (0, promises_1.mkdir)(dirPath, { recursive: true })))(configuredPaths.configDir);
        }
        const authResult = await (dependencies.ensureAuthorizedToken ?? googleAuth_1.ensureAuthorizedToken)({
            credentialsPath,
            tokenPath,
            allowBrowserAuth: true,
            requireGrantedScopes: true,
            scopes: [constants_1.GMAIL_READONLY_SCOPE, constants_1.DRIVE_METADATA_READONLY_SCOPE],
            onAuthorizationReady(notice) {
                if (notice.manualInstructions) {
                    io.error(notice.manualInstructions);
                }
            },
        });
        if (mode === "drive_about") {
            const driveClient = await createCliDriveClient(credentialsPath, authResult.token, dependencies);
            printDriveAbout(io, (0, files_1.mapDriveAbout)(await driveClient.getAbout()));
            return 0;
        }
        if (mode === "drive_file") {
            const driveClient = await createCliDriveClient(credentialsPath, authResult.token, dependencies);
            printDriveFile(io, null, (0, files_1.mapDriveFile)(await driveClient.getFile(options.driveFileId)));
            return 0;
        }
        if (mode === "drive_query") {
            const driveClient = await createCliDriveClient(credentialsPath, authResult.token, dependencies);
            const response = await driveClient.listFiles({
                corpora: options.driveCorpora,
                driveId: options.driveId || undefined,
                includeItemsFromAllDrives: options.includeAllDrives,
                includeTrashed: options.includeTrashed,
                maxResults: options.maxResults,
                orderBy: options.driveOrderBy,
                query: options.driveQuery,
            });
            const files = (response.files ?? []).map((file) => (0, files_1.mapDriveFile)(file));
            if (files.length === 0) {
                io.out("No Drive files matched the request.");
                return 0;
            }
            for (const [index, file] of files.entries()) {
                printDriveFile(io, index + 1, file);
            }
            return 0;
        }
        const gmailClient = await createCliGmailClient(credentialsPath, authResult.token, dependencies);
        if (options.listLabels) {
            const labels = (0, labels_1.normalizeLabelList)(await gmailClient.listLabels());
            for (const label of labels.labels) {
                io.out(`${label.name}\t${label.id}\t${label.type}`);
            }
            return 0;
        }
        const availableLabels = options.labels.length > 0 ? await gmailClient.listLabels() : [];
        const resolvedLabelIds = (0, labels_1.resolveLabelIds)(options.labels, availableLabels);
        const messageIds = await gmailClient.listMessageIds({
            maxResults: options.maxResults,
            query: options.query,
            labelIds: resolvedLabelIds,
        });
        const rawMessages = await Promise.all(messageIds.map((messageId) => gmailClient.getMessage(messageId)));
        const messageList = (0, messages_1.createMessageList)({
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
    }
    catch (error) {
        if (error instanceof client_2.GmailApiError) {
            io.error(`Gmail API error: ${error.message}`);
            return exports.CLI_NOT_IMPLEMENTED_EXIT_CODE;
        }
        if (error instanceof client_1.DriveApiError) {
            io.error(`Drive API error: ${error.message}`);
            return exports.CLI_NOT_IMPLEMENTED_EXIT_CODE;
        }
        if (error instanceof googleAuth_1.GmailAuthRequiredError ||
            error instanceof googleAuth_1.GoogleScopeRequiredError ||
            error instanceof labels_1.GmailLabelLookupError ||
            error instanceof Error) {
            io.error(error.message);
            return exports.CLI_NOT_IMPLEMENTED_EXIT_CODE;
        }
        io.error(String(error));
        return exports.CLI_NOT_IMPLEMENTED_EXIT_CODE;
    }
}
if (require.main === module) {
    void runCli(process.argv.slice(2)).then((code) => {
        process.exit(code);
    });
}
