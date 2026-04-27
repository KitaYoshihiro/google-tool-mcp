import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CodeChallengeMethod,
  OAuth2Client,
  type GetTokenOptions,
} from "google-auth-library";

import { ENV_CREDENTIALS_PATH, ENV_TOKEN_PATH } from "../config/constants";

export interface DesktopClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
}

export interface SavedToken {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

interface OAuthTokenResponseShape {
  tokens?: unknown;
}

export interface CredentialClientLike {
  credentials?: unknown;
  setCredentials(credentials: SavedToken): void;
}

export interface RefreshableClientLike extends CredentialClientLike {
  refreshAccessToken(): Promise<{ credentials: unknown }>;
}

export interface AuthorizationCodeClientLike extends CredentialClientLike {
  getToken(code: string | GetTokenOptions): Promise<OAuthTokenResponseShape>;
}

export interface BrowserRunnerResult {
  error?: Error;
  status: number | null;
}

export type BrowserRunner = (
  command: string,
  args: string[],
) => BrowserRunnerResult;

export interface AuthorizationUrlOptions {
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: CodeChallengeMethod;
}

export interface ExchangeCodeOptions {
  codeVerifier?: string;
  requireRefreshToken?: boolean;
  scopes?: readonly string[];
}

export interface LoopbackAuthorizationResult {
  code: string;
}

export interface LoopbackAuthorizationListener {
  redirectUri: string;
  waitForCode(): Promise<LoopbackAuthorizationResult>;
  close(): Promise<void>;
}

export interface LoopbackAuthorizationListenerOptions {
  expectedState: string;
  timeoutMs?: number;
}

export interface InteractiveAuthorizationClientLike extends AuthorizationCodeClientLike {
  generateAuthUrl(options: Parameters<OAuth2Client["generateAuthUrl"]>[0]): string;
  generateCodeVerifierAsync(): Promise<{
    codeVerifier: string;
    codeChallenge?: string;
  }>;
}

export interface InteractiveAuthorizationResult {
  token: SavedToken;
  authorizationUrl: string;
  browserOpened: boolean;
  manualInstructions?: string;
  redirectUri: string;
}

export interface InteractiveAuthorizationNotice {
  authorizationUrl: string;
  browserOpened: boolean;
  manualInstructions?: string;
  redirectUri: string;
}

export interface InteractiveAuthorizationOptions {
  credentials: DesktopClientCredentials;
  scopes: readonly string[];
  stateFactory?: () => string;
  clientFactory?: (redirectUri: string) => InteractiveAuthorizationClientLike;
  listenerFactory?: (
    baseRedirectUri: string,
    options: LoopbackAuthorizationListenerOptions,
  ) => Promise<LoopbackAuthorizationListener>;
  browserOpener?: (authorizationUrl: string) => boolean;
  onAuthorizationReady?: (
    notice: InteractiveAuthorizationNotice,
  ) => void | Promise<void>;
}

export interface AuthorizedTokenResult {
  source: "saved" | "refreshed" | "interactive";
  token: SavedToken;
}

export interface EnsureAuthorizedTokenOptions {
  credentialsPath: string;
  tokenPath: string;
  scopes: readonly string[];
  allowBrowserAuth: boolean;
  requireGrantedScopes?: boolean;
  now?: number;
  eagerRefreshThresholdMs?: number;
  loadSavedToken?: (tokenPath: string) => Promise<SavedToken | null>;
  saveToken?: (tokenPath: string, token: SavedToken) => Promise<void>;
  readTextFile?: (path: string) => Promise<string>;
  clientFactory?: (credentials: DesktopClientCredentials) => RefreshableClientLike;
  interactiveAuthorizationRunner?: (
    options: InteractiveAuthorizationOptions,
  ) => Promise<InteractiveAuthorizationResult>;
  onAuthorizationReady?: (
    notice: InteractiveAuthorizationNotice,
  ) => void | Promise<void>;
}

interface DesktopClientFileShape {
  installed?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
}

export class GmailAuthRequiredError extends Error {
  constructor(tokenPath: string) {
    super(
      `OAuth token was not ready at ${tokenPath}. Complete Google authorization, or point ${ENV_TOKEN_PATH} to an existing token.json file.`,
    );
    this.name = "GmailAuthRequiredError";
  }
}

export class GoogleScopeRequiredError extends Error {
  constructor(tokenPath: string, scopes: readonly string[]) {
    super(
      `OAuth token at ${tokenPath} does not include the required Google API scopes. Reauthorize with the required scopes, or point ${ENV_TOKEN_PATH} to a token.json file that includes them. Missing scopes: ${normalizeScopes(scopes).join(", ")}`,
    );
    this.name = "GoogleScopeRequiredError";
  }
}

export class GoogleCredentialsRequiredError extends Error {
  constructor(credentialsPath: string, tokenPath: string) {
    super(
      `Google OAuth client credentials are not configured. User action required: place a Desktop app OAuth client JSON file at ${credentialsPath}. To use another location, set ${ENV_CREDENTIALS_PATH} to the full credentials.json path in the MCP server configuration. Then retry the same tool call; browser authorization will create ${tokenPath}. After presenting this setup guidance, wait for the user to configure credentials instead of running unrelated CLI commands.`,
    );
    this.name = "GoogleCredentialsRequiredError";
  }
}

function isLoopbackRedirectUri(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function hasValidTokenShape(token: unknown): token is SavedToken {
  if (!token || typeof token !== "object") {
    return false;
  }

  const candidate = token as Record<string, unknown>;
  const hasUsableCredential =
    typeof candidate.access_token === "string" || typeof candidate.refresh_token === "string";

  if (!hasUsableCredential) {
    return false;
  }

  if (
    candidate.access_token !== undefined &&
    typeof candidate.access_token !== "string"
  ) {
    return false;
  }

  if (
    candidate.refresh_token !== undefined &&
    typeof candidate.refresh_token !== "string"
  ) {
    return false;
  }

  if (candidate.scope !== undefined && typeof candidate.scope !== "string") {
    return false;
  }

  if (candidate.token_type !== undefined && typeof candidate.token_type !== "string") {
    return false;
  }

  if (
    candidate.expiry_date !== undefined &&
    (typeof candidate.expiry_date !== "number" || !Number.isFinite(candidate.expiry_date))
  ) {
    return false;
  }

  return true;
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [
    ...new Set(
      scopes
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0),
    ),
  ];
}

function parseGrantedScopes(scopeValue: string | undefined): Set<string> | null {
  if (scopeValue === undefined) {
    return null;
  }

  return new Set(
    scopeValue
      .split(/\s+/u)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0),
  );
}

function tokenHasRequiredScopes(
  token: SavedToken,
  requiredScopes: readonly string[],
  requireGrantedScopes: boolean,
): boolean {
  const normalizedRequiredScopes = normalizeScopes(requiredScopes);
  if (normalizedRequiredScopes.length === 0) {
    return true;
  }

  const grantedScopes = parseGrantedScopes(token.scope);
  if (!grantedScopes) {
    return !requireGrantedScopes;
  }

  return normalizedRequiredScopes.every((scope) => grantedScopes.has(scope));
}

function withRequiredScopes(
  token: SavedToken,
  requiredScopes: readonly string[],
): SavedToken {
  const normalizedRequiredScopes = normalizeScopes(requiredScopes);
  if (normalizedRequiredScopes.length === 0) {
    return token;
  }

  const grantedScopes = parseGrantedScopes(token.scope);
  if (!grantedScopes) {
    return {
      ...token,
      scope: normalizedRequiredScopes.join(" "),
    };
  }

  for (const scope of normalizedRequiredScopes) {
    grantedScopes.add(scope);
  }

  return {
    ...token,
    scope: [...grantedScopes].join(" "),
  };
}

function withOptionalScope(
  token: SavedToken,
  scope: string | undefined,
): SavedToken {
  if (scope === undefined) {
    return token;
  }

  return {
    ...token,
    scope,
  };
}

export function getPreferredRedirectUri(credentials: DesktopClientCredentials): string {
  const preferred =
    credentials.redirectUris.find(
      (uri) => isLoopbackRedirectUri(uri) && new URL(uri).hostname === "127.0.0.1",
    ) ??
    credentials.redirectUris.find(
      (uri) => isLoopbackRedirectUri(uri) && new URL(uri).hostname === "localhost",
    );

  if (!preferred) {
    throw new Error("Desktop app OAuth client JSON must contain a loopback redirect URI.");
  }

  return preferred;
}

export function parseOAuthClientFile(fileContent: string): DesktopClientCredentials {
  const parsed = JSON.parse(fileContent) as DesktopClientFileShape;
  const installed = parsed.installed;

  if (!installed?.client_id || !installed.client_secret) {
    throw new Error("Desktop app OAuth client JSON is required.");
  }

  const redirectUris = (installed.redirect_uris ?? [])
    .filter((uri): uri is string => typeof uri === "string")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);

  if (redirectUris.length === 0) {
    throw new Error("Desktop app OAuth client JSON must contain at least one redirect URI.");
  }

  if (!redirectUris.some(isLoopbackRedirectUri)) {
    throw new Error("Desktop app OAuth client JSON must contain a loopback redirect URI.");
  }

  return {
    clientId: installed.client_id,
    clientSecret: installed.client_secret,
    redirectUris,
  };
}

export function createOAuthClient(credentials: DesktopClientCredentials): OAuth2Client {
  return new OAuth2Client({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    redirectUri: getPreferredRedirectUri(credentials),
  });
}

export function createOAuthClientForRedirectUri(
  credentials: DesktopClientCredentials,
  redirectUri: string,
): OAuth2Client {
  return new OAuth2Client({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    redirectUri,
  });
}

export function buildAuthorizationUrl(
  client: Pick<OAuth2Client, "generateAuthUrl">,
  scopes: readonly string[],
  options: AuthorizationUrlOptions = {},
): string {
  const authOptions: Parameters<typeof client.generateAuthUrl>[0] = {
    access_type: "offline",
    prompt: "consent",
    scope: [...scopes],
  };

  if (options.state) {
    authOptions.state = options.state;
  }

  if (options.codeChallenge) {
    authOptions.code_challenge = options.codeChallenge;
    authOptions.code_challenge_method =
      options.codeChallengeMethod ?? CodeChallengeMethod.S256;
  }

  return client.generateAuthUrl(authOptions);
}

export function applySavedToken(
  client: CredentialClientLike,
  token: SavedToken,
): SavedToken {
  if (!hasValidTokenShape(token)) {
    throw new Error("Saved token JSON has an invalid shape.");
  }

  client.setCredentials(token);
  return token;
}

export async function refreshSavedToken(
  client: RefreshableClientLike,
): Promise<SavedToken> {
  const existingToken = hasValidTokenShape(client.credentials)
    ? client.credentials
    : undefined;
  const result = await client.refreshAccessToken();
  if (!hasValidTokenShape(result.credentials)) {
    throw new Error("Saved token JSON has an invalid shape.");
  }

  const mergedToken =
    !result.credentials.refresh_token && existingToken?.refresh_token
      ? {
          ...result.credentials,
          refresh_token: existingToken.refresh_token,
        }
      : { ...result.credentials };
  const normalizedToken = withOptionalScope(
    mergedToken,
    result.credentials.scope ?? existingToken?.scope,
  );

  client.setCredentials(normalizedToken);
  return normalizedToken;
}

export async function exchangeCodeForToken(
  client: AuthorizationCodeClientLike,
  code: string,
  options: ExchangeCodeOptions = {},
): Promise<SavedToken> {
  const getTokenArg = options.codeVerifier
    ? { code, codeVerifier: options.codeVerifier }
    : code;
  const result = await client.getToken(getTokenArg);
  if (!hasValidTokenShape(result.tokens)) {
    throw new Error("Saved token JSON has an invalid shape.");
  }

  if ((options.requireRefreshToken ?? true) && !result.tokens.refresh_token) {
    throw new Error(
      "Interactive OAuth exchange must return a refresh_token. Re-run consent and try again.",
    );
  }

  const token = withRequiredScopes(result.tokens, options.scopes ?? []);
  client.setCredentials(token);
  return token;
}

export function buildManualAuthInstructions(authorizationUrl: string): string {
  return [
    "Open this URL in your browser to continue Google authorization:",
    authorizationUrl,
  ].join("\n");
}

export function buildRuntimeRedirectUri(baseRedirectUri: string, port: number): string {
  const parsed = new URL(baseRedirectUri);
  parsed.port = String(port);
  if (!parsed.pathname) {
    parsed.pathname = "/";
  }
  return parsed.toString();
}

function sendAuthorizationResponse(
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("connection", "close");
  response.shouldKeepAlive = false;
  response.end(`<html><body><p>${message}</p></body></html>`);
}

function buildLoopbackCallbackResult(
  request: IncomingMessage,
  expectedState: string,
): LoopbackAuthorizationResult {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const error = requestUrl.searchParams.get("error");
  if (error) {
    throw new Error(`OAuth authorization failed: ${error}`);
  }

  const state = requestUrl.searchParams.get("state");
  if (state !== expectedState) {
    throw new Error("OAuth state mismatch.");
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    throw new Error("OAuth authorization callback did not include a code.");
  }

  return { code };
}

export async function createLoopbackAuthorizationListener(
  baseRedirectUri: string,
  options: LoopbackAuthorizationListenerOptions,
): Promise<LoopbackAuthorizationListener> {
  if (!isLoopbackRedirectUri(baseRedirectUri)) {
    throw new Error("Desktop app OAuth client JSON must contain a loopback redirect URI.");
  }

  const parsed = new URL(baseRedirectUri);
  const listenPort = parsed.port ? Number(parsed.port) : 0;
  const listenHost = parsed.hostname;
  const expectedPathname = parsed.pathname || "/";
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  let settle:
    | ((result: LoopbackAuthorizationResult) => void)
    | undefined;
  let rejectResult:
    | ((error: unknown) => void)
    | undefined;

  const resultPromise = new Promise<LoopbackAuthorizationResult>((resolve, reject) => {
    settle = resolve;
    rejectResult = reject;
  });

  let settled = false;
  const finish = (callback: () => void) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    callback();
  };

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== expectedPathname) {
      sendAuthorizationResponse(response, 404, "Authorization failed.");
      return;
    }

    try {
      const result = buildLoopbackCallbackResult(request, options.expectedState);
      sendAuthorizationResponse(response, 200, "Authorization completed. You can return to the app.");
      finish(() => settle?.(result));
    } catch (error) {
      sendAuthorizationResponse(response, 400, "Authorization failed.");
      finish(() => rejectResult?.(error));
    }
  });
  server.keepAliveTimeout = 0;

  const timeout = setTimeout(() => {
    finish(() => rejectResult?.(new Error("OAuth authorization timed out.")));
  }, timeoutMs);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, listenHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine loopback callback address.");
  }

  return {
    redirectUri: buildRuntimeRedirectUri(baseRedirectUri, address.port),
    waitForCode() {
      return resultPromise;
    },
    async close() {
      clearTimeout(timeout);
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
          server.closeIdleConnections?.();
        });
      }
    },
  };
}

function getBrowserLaunchCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    };
  }

  if (platform === "darwin") {
    return {
      command: "open",
      args: [url],
    };
  }

  return {
    command: "xdg-open",
    args: [url],
  };
}

export function openSystemBrowser(
  authorizationUrl: string,
  options: {
    platform?: NodeJS.Platform;
    runner?: BrowserRunner;
  } = {},
): boolean {
  const platform = options.platform ?? process.platform;
  const runner: BrowserRunner =
    options.runner ??
    ((command, args) =>
      spawnSync(command, args, {
        stdio: "ignore",
      }));

  const { command, args } = getBrowserLaunchCommand(platform, authorizationUrl);
  const result = runner(command, args);
  return !result.error && result.status === 0;
}

export async function runInteractiveAuthorization(
  options: InteractiveAuthorizationOptions,
): Promise<InteractiveAuthorizationResult> {
  const state = options.stateFactory?.() ?? randomUUID();
  const baseRedirectUri = getPreferredRedirectUri(options.credentials);
  const listener =
    options.listenerFactory
      ? await options.listenerFactory(baseRedirectUri, { expectedState: state })
      : await createLoopbackAuthorizationListener(baseRedirectUri, { expectedState: state });

  try {
    const client =
      options.clientFactory?.(listener.redirectUri) ??
      createOAuthClientForRedirectUri(
        options.credentials,
        listener.redirectUri,
      );
    const pkce = await client.generateCodeVerifierAsync();
    const authorizationUrl = buildAuthorizationUrl(client, options.scopes, {
      state,
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: CodeChallengeMethod.S256,
    });
    const browserOpened =
      options.browserOpener?.(authorizationUrl) ?? openSystemBrowser(authorizationUrl);
    const manualInstructions = browserOpened
      ? undefined
      : buildManualAuthInstructions(authorizationUrl);
    await options.onAuthorizationReady?.({
      authorizationUrl,
      browserOpened,
      manualInstructions,
      redirectUri: listener.redirectUri,
    });
    const { code } = await listener.waitForCode();
    const token = await exchangeCodeForToken(client, code, {
      codeVerifier: pkce.codeVerifier,
      requireRefreshToken: true,
      scopes: options.scopes,
    });

    return {
      token,
      authorizationUrl,
      browserOpened,
      manualInstructions,
      redirectUri: listener.redirectUri,
    };
  } finally {
    await listener.close();
  }
}

export async function loadOAuthClientCredentials(
  credentialsPath: string,
  options: {
    readTextFile?: (path: string) => Promise<string>;
  } = {},
): Promise<DesktopClientCredentials> {
  try {
    const readTextFile =
      options.readTextFile ??
      ((filePath: string) => readFile(filePath, "utf-8"));
    const content = await readTextFile(credentialsPath);
    return parseOAuthClientFile(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `OAuth client file was not found: ${credentialsPath}. User action required: place a Desktop app OAuth client JSON file there, or set ${ENV_CREDENTIALS_PATH} to its full path.`,
      );
    }

    throw error;
  }
}

function shouldRefreshSavedToken(
  token: SavedToken,
  now: number,
  eagerRefreshThresholdMs: number,
): boolean {
  if (!token.access_token) {
    return true;
  }

  return token.expiry_date !== undefined && token.expiry_date <= now + eagerRefreshThresholdMs;
}

export async function ensureAuthorizedToken(
  options: EnsureAuthorizedTokenOptions,
): Promise<AuthorizedTokenResult> {
  const now = options.now ?? Date.now();
  const eagerRefreshThresholdMs =
    options.eagerRefreshThresholdMs ?? 5 * 60 * 1000;
  const requireGrantedScopes = options.requireGrantedScopes ?? false;
  const savedToken =
    await (options.loadSavedToken ?? loadSavedToken)(options.tokenPath);
  const savedTokenHasRequiredScopes = savedToken
    ? tokenHasRequiredScopes(
        savedToken,
        options.scopes,
        requireGrantedScopes,
      )
    : false;

  if (
    savedToken &&
    savedTokenHasRequiredScopes &&
    !shouldRefreshSavedToken(savedToken, now, eagerRefreshThresholdMs)
  ) {
    return {
      source: "saved",
      token: savedToken,
    };
  }

  if (savedToken?.refresh_token && savedTokenHasRequiredScopes) {
    const credentials = await loadOAuthClientCredentials(options.credentialsPath, {
      readTextFile: options.readTextFile,
    });
    const client =
      options.clientFactory?.(credentials) ??
      createOAuthClient(credentials);
    applySavedToken(client, savedToken);
    const refreshedToken = await refreshSavedToken(client);
    await (options.saveToken ?? saveToken)(options.tokenPath, refreshedToken);

    return {
      source: "refreshed",
      token: refreshedToken,
    };
  }

  if (savedToken && !savedTokenHasRequiredScopes && !options.allowBrowserAuth) {
    throw new GoogleScopeRequiredError(options.tokenPath, options.scopes);
  }

  if (!options.allowBrowserAuth) {
    throw new GmailAuthRequiredError(options.tokenPath);
  }

  const credentials = await loadOAuthClientCredentials(options.credentialsPath, {
    readTextFile: options.readTextFile,
  });
  const interactiveAuthorization =
    await (options.interactiveAuthorizationRunner ?? runInteractiveAuthorization)({
      credentials,
      scopes: options.scopes,
      onAuthorizationReady: options.onAuthorizationReady,
    });
  const interactiveToken = withRequiredScopes(
    interactiveAuthorization.token,
    options.scopes,
  );
  await (options.saveToken ?? saveToken)(
    options.tokenPath,
    interactiveToken,
  );

  return {
    source: "interactive",
    token: interactiveToken,
  };
}

export async function loadSavedToken(tokenPath: string): Promise<SavedToken | null> {
  try {
    const content = await readFile(tokenPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!hasValidTokenShape(parsed)) {
      throw new Error("Saved token JSON has an invalid shape.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveToken(tokenPath: string, token: SavedToken): Promise<void> {
  if (!hasValidTokenShape(token)) {
    throw new Error("Saved token JSON has an invalid shape.");
  }
  await mkdir(path.dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, JSON.stringify(token, null, 2), "utf-8");
}

export function getAuthScaffoldStatus(): string {
  return "foundations";
}
