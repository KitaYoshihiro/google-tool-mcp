"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProfileName = resolveProfileName;
exports.getDefaultConfigDir = getDefaultConfigDir;
exports.getSharedConfigDir = getSharedConfigDir;
exports.getDefaultCredentialPaths = getDefaultCredentialPaths;
exports.getSharedCredentialPaths = getSharedCredentialPaths;
exports.resolveConfiguredPaths = resolveConfiguredPaths;
exports.shouldUseSharedCredentialFallback = shouldUseSharedCredentialFallback;
exports.getDefaultConfigDirHint = getDefaultConfigDirHint;
exports.isPathInConfigDir = isPathInConfigDir;
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("./constants");
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/u;
function getPathModule(platform, homeDir) {
    return platform === "win32" || homeDir.includes("\\") ? node_path_1.default.win32 : node_path_1.default.posix;
}
function getPathModuleForFilePath(filePath, platform) {
    return platform === "win32" || filePath.includes("\\") ? node_path_1.default.win32 : node_path_1.default.posix;
}
function getHomeDir(homeDir, env) {
    return homeDir ?? env.HOME ?? env.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
}
function getEnv(env) {
    return env ?? process.env;
}
function getPlatform(platform) {
    return platform ?? process.platform;
}
function getConfigDirForProfile(homeDir, platform, profileName) {
    const pathModule = getPathModule(platform, homeDir);
    const configDir = pathModule.join(homeDir, ".config", constants_1.APP_NAME);
    if (!profileName) {
        return configDir;
    }
    return pathModule.join(configDir, "profiles", profileName);
}
function normalizeProfileName(profileName, sourceName) {
    const trimmed = profileName?.trim();
    if (!trimmed) {
        return undefined;
    }
    if (!PROFILE_NAME_PATTERN.test(trimmed)) {
        throw new Error(`Invalid ${sourceName} value: ${profileName}. Use only letters, numbers, dot, underscore, plus, at sign, and hyphen.`);
    }
    return trimmed;
}
function resolveProfileName(context = {}) {
    if (context.profileName !== undefined) {
        return normalizeProfileName(context.profileName, "--profile");
    }
    const env = getEnv(context.env);
    return normalizeProfileName(env[constants_1.ENV_PROFILE], constants_1.ENV_PROFILE);
}
function getDefaultConfigDir(context = {}) {
    const env = getEnv(context.env);
    const homeDir = getHomeDir(context.homeDir, env);
    const platform = getPlatform(context.platform);
    const profileName = resolveProfileName(context);
    return getConfigDirForProfile(homeDir, platform, profileName);
}
function getSharedConfigDir(context = {}) {
    const env = getEnv(context.env);
    const homeDir = getHomeDir(context.homeDir, env);
    const platform = getPlatform(context.platform);
    return getConfigDirForProfile(homeDir, platform, undefined);
}
function getDefaultCredentialPaths(context = {}) {
    const configDir = getDefaultConfigDir(context);
    const env = getEnv(context.env);
    const homeDir = getHomeDir(context.homeDir, env);
    const platform = getPlatform(context.platform);
    const pathModule = getPathModule(platform, homeDir);
    return {
        configDir,
        credentialsPath: pathModule.join(configDir, "credentials.json"),
        tokenPath: pathModule.join(configDir, "token.json"),
    };
}
function getSharedCredentialPaths(context = {}) {
    const configDir = getSharedConfigDir(context);
    const env = getEnv(context.env);
    const homeDir = getHomeDir(context.homeDir, env);
    const platform = getPlatform(context.platform);
    const pathModule = getPathModule(platform, homeDir);
    return {
        configDir,
        credentialsPath: pathModule.join(configDir, "credentials.json"),
        tokenPath: pathModule.join(configDir, "token.json"),
    };
}
function resolveConfiguredPaths(context = {}) {
    const env = getEnv(context.env);
    const defaults = getDefaultCredentialPaths(context);
    return {
        configDir: defaults.configDir,
        credentialsPath: env[constants_1.ENV_CREDENTIALS_PATH] || defaults.credentialsPath,
        tokenPath: env[constants_1.ENV_TOKEN_PATH] || defaults.tokenPath,
    };
}
function shouldUseSharedCredentialFallback(context = {}) {
    const env = getEnv(context.env);
    return resolveProfileName(context) !== undefined && !env[constants_1.ENV_CREDENTIALS_PATH];
}
function getDefaultConfigDirHint() {
    return constants_1.APP_NAME;
}
function isPathInConfigDir(configDir, filePath, platform) {
    const pathModule = getPathModuleForFilePath(filePath, platform);
    return pathModule.dirname(filePath) === configDir;
}
