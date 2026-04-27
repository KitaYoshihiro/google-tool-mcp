import path from "node:path";
import {
  APP_NAME,
  ENV_CREDENTIALS_PATH,
  ENV_PROFILE,
  ENV_TOKEN_PATH,
} from "./constants";

export interface PathContext {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  profileName?: string;
}

export interface CredentialPaths {
  configDir: string;
  credentialsPath: string;
  tokenPath: string;
}

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/u;

function getPathModule(
  platform: NodeJS.Platform,
  homeDir: string,
): typeof path.posix | typeof path.win32 {
  return platform === "win32" || homeDir.includes("\\") ? path.win32 : path.posix;
}

function getPathModuleForFilePath(
  filePath: string,
  platform?: NodeJS.Platform,
): typeof path.posix | typeof path.win32 {
  return platform === "win32" || filePath.includes("\\") ? path.win32 : path.posix;
}

function getHomeDir(homeDir: string | undefined, env: NodeJS.ProcessEnv): string {
  return homeDir ?? env.HOME ?? env.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function getEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env ?? process.env;
}

function getPlatform(platform?: NodeJS.Platform): NodeJS.Platform {
  return platform ?? process.platform;
}

function getConfigDirForProfile(
  homeDir: string,
  platform: NodeJS.Platform,
  profileName: string | undefined,
): string {
  const pathModule = getPathModule(platform, homeDir);
  const configDir = pathModule.join(homeDir, ".config", APP_NAME);

  if (!profileName) {
    return configDir;
  }

  return pathModule.join(configDir, "profiles", profileName);
}

function normalizeProfileName(
  profileName: string | undefined,
  sourceName: string,
): string | undefined {
  const trimmed = profileName?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!PROFILE_NAME_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid ${sourceName} value: ${profileName}. Use only letters, numbers, dot, underscore, plus, at sign, and hyphen.`,
    );
  }

  return trimmed;
}

export function resolveProfileName(context: PathContext = {}): string | undefined {
  if (context.profileName !== undefined) {
    return normalizeProfileName(context.profileName, "--profile");
  }

  const env = getEnv(context.env);
  return normalizeProfileName(env[ENV_PROFILE], ENV_PROFILE);
}

export function getDefaultConfigDir(context: PathContext = {}): string {
  const env = getEnv(context.env);
  const homeDir = getHomeDir(context.homeDir, env);
  const platform = getPlatform(context.platform);
  const profileName = resolveProfileName(context);
  return getConfigDirForProfile(homeDir, platform, profileName);
}

export function getSharedConfigDir(context: PathContext = {}): string {
  const env = getEnv(context.env);
  const homeDir = getHomeDir(context.homeDir, env);
  const platform = getPlatform(context.platform);
  return getConfigDirForProfile(homeDir, platform, undefined);
}

export function getDefaultCredentialPaths(context: PathContext = {}): CredentialPaths {
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

export function getSharedCredentialPaths(context: PathContext = {}): CredentialPaths {
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

export function resolveConfiguredPaths(context: PathContext = {}): CredentialPaths {
  const env = getEnv(context.env);
  const defaults = getDefaultCredentialPaths(context);

  return {
    configDir: defaults.configDir,
    credentialsPath: env[ENV_CREDENTIALS_PATH] || defaults.credentialsPath,
    tokenPath: env[ENV_TOKEN_PATH] || defaults.tokenPath,
  };
}

export function shouldUseSharedCredentialFallback(context: PathContext = {}): boolean {
  const env = getEnv(context.env);
  return resolveProfileName(context) !== undefined && !env[ENV_CREDENTIALS_PATH];
}

export function getDefaultConfigDirHint(): string {
  return APP_NAME;
}

export function isPathInConfigDir(
  configDir: string,
  filePath: string,
  platform?: NodeJS.Platform,
): boolean {
  const pathModule = getPathModuleForFilePath(filePath, platform);
  return pathModule.dirname(filePath) === configDir;
}
