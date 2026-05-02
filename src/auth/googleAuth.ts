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
  _google_tool?: TokenDiagnosticsMetadata;
}

export interface TokenDiagnosticsMetadata {
  authorized_at?: string;
  client_id?: string;
  credentials_path?: string;
  scopes?: string[];
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
  credentials?: DesktopClientCredentials;
  credentialsPath?: string;
  requireRefreshToken?: boolean;
  tokenPath?: string;
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

export interface GoogleOAuthErrorDetails {
  error?: string;
  errorDescription?: string;
  status?: number;
}

interface GoogleOAuthGrantErrorOptions {
  cause: unknown;
  credentials?: DesktopClientCredentials;
  credentialsPath?: string;
  details: GoogleOAuthErrorDetails;
  operation: "refresh" | "authorization_code_exchange";
  savedToken?: SavedToken;
  tokenPath?: string;
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

export class GoogleOAuthGrantError extends Error {
  readonly cause: unknown;
  readonly details: GoogleOAuthErrorDetails;
  readonly operation: GoogleOAuthGrantErrorOptions["operation"];

  constructor(options: GoogleOAuthGrantErrorOptions) {
    super(formatGoogleOAuthGrantErrorMessage(options));
    this.name = "GoogleOAuthGrantError";
    this.cause = options.cause;
    this.details = options.details;
    this.operation = options.operation;
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

  if (!hasValidTokenDiagnosticsMetadata(candidate._google_tool)) {
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasValidTokenDiagnosticsMetadata(
  value: unknown,
): value is TokenDiagnosticsMetadata {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.authorized_at === undefined ||
      typeof candidate.authorized_at === "string") &&
    (candidate.client_id === undefined ||
      typeof candidate.client_id === "string") &&
    (candidate.credentials_path === undefined ||
      typeof candidate.credentials_path === "string") &&
    (candidate.scopes === undefined || isStringArray(candidate.scopes))
  );
}

function stripTokenDiagnosticsMetadata(token: SavedToken): SavedToken {
  const { _google_tool: _metadata, ...credentialToken } = token;
  return credentialToken;
}

function withTokenDiagnosticsMetadata(
  token: SavedToken,
  options: {
    authorizedAt?: string;
    credentials?: DesktopClientCredentials;
    credentialsPath?: string;
    existingToken?: SavedToken;
    scopes?: readonly string[];
  },
): SavedToken {
  const existingMetadata = options.existingToken?._google_tool ?? token._google_tool;
  const metadata: TokenDiagnosticsMetadata = {
    ...existingMetadata,
  };

  if (options.authorizedAt !== undefined) {
    metadata.authorized_at = options.authorizedAt;
  }

  if (options.credentials !== undefined) {
    metadata.client_id = options.credentials.clientId;
  }

  if (options.credentialsPath !== undefined) {
    metadata.credentials_path = options.credentialsPath;
  }

  if (options.scopes !== undefined) {
    metadata.scopes = normalizeScopes(options.scopes);
  }

  if (Object.keys(metadata).length === 0) {
    return token;
  }

  return {
    ...token,
    _google_tool: metadata,
  };
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractGoogleOAuthErrorDetails(error: unknown): GoogleOAuthErrorDetails {
  const errorRecord = getRecord(error);
  const response = getRecord(errorRecord?.response);
  const data = getRecord(response?.data);
  const status =
    typeof response?.status === "number"
      ? response.status
      : typeof errorRecord?.code === "number"
        ? errorRecord.code
        : undefined;
  const googleError =
    typeof data?.error === "string"
      ? data.error
      : typeof errorRecord?.error === "string"
        ? errorRecord.error
        : undefined;
  const errorDescription =
    typeof data?.error_description === "string"
      ? data.error_description
      : typeof errorRecord?.error_description === "string"
        ? errorRecord.error_description
        : undefined;

  return {
    error: googleError,
    errorDescription,
    status,
  };
}

function isInvalidGrantError(details: GoogleOAuthErrorDetails, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return details.error === "invalid_grant" || /\binvalid_grant\b/u.test(message);
}

function formatElapsedDays(authorizedAt: string | undefined): number | null {
  if (!authorizedAt) {
    return null;
  }

  const authorizedAtMs = Date.parse(authorizedAt);
  if (!Number.isFinite(authorizedAtMs)) {
    return null;
  }

  return Math.floor((Date.now() - authorizedAtMs) / (24 * 60 * 60 * 1000));
}

function buildGoogleOAuthGrantFacts(
  options: GoogleOAuthGrantErrorOptions,
): string[] {
  const facts: string[] = [];
  const googleError = options.details.error ?? "invalid_grant";
  facts.push(
    options.operation === "refresh"
      ? `The failure happened while refreshing the saved OAuth token with Google.`
      : `The failure happened while exchanging the browser authorization code for OAuth tokens.`,
  );
  facts.push(`Google rejected the OAuth grant with ${googleError}.`);

  if (options.details.errorDescription) {
    facts.push(`Google response: ${options.details.errorDescription}`);
  }

  if (options.tokenPath) {
    facts.push(`Token path: ${options.tokenPath}`);
  }

  const tokenClientId = options.savedToken?._google_tool?.client_id;
  const credentialsClientId = options.credentials?.clientId;
  if (tokenClientId && credentialsClientId) {
    facts.push(
      tokenClientId === credentialsClientId
        ? "The saved token metadata matches the current credentials.json OAuth client_id."
        : "The saved token metadata was created for a different OAuth client_id than the current credentials.json.",
    );
  }

  const authorizedAt = options.savedToken?._google_tool?.authorized_at;
  const elapsedDays = formatElapsedDays(authorizedAt);
  if (authorizedAt && elapsedDays !== null) {
    facts.push(`The saved token metadata says browser authorization happened ${elapsedDays} day(s) ago.`);
  }

  return facts;
}

function buildGoogleOAuthGrantPossibleCauses(
  options: GoogleOAuthGrantErrorOptions,
): string[] {
  if (options.operation === "authorization_code_exchange") {
    return [
      "The authorization code expired or was already used.",
      "The browser callback did not match the redirect URI or PKCE verifier used by this server.",
      "The authorization code was issued for a different OAuth client.",
    ];
  }

  const causes = [
    "The refresh token was revoked in the Google Account security settings.",
    "The refresh token expired under Google OAuth policy, such as long inactivity or account security changes.",
    "The refresh token was superseded after too many tokens were issued for the same user and OAuth client.",
  ];

  const tokenClientId = options.savedToken?._google_tool?.client_id;
  const credentialsClientId = options.credentials?.clientId;
  if (tokenClientId && credentialsClientId && tokenClientId !== credentialsClientId) {
    causes.unshift("token.json and credentials.json belong to different OAuth clients.");
  }

  const elapsedDays = formatElapsedDays(options.savedToken?._google_tool?.authorized_at);
  if (elapsedDays !== null && elapsedDays >= 7) {
    causes.unshift(
      "If the OAuth consent screen is External and still in Testing, Google's short refresh-token lifetime may apply.",
    );
  } else {
    causes.push(
      "If the OAuth consent screen is External and still in Testing, Google's short refresh-token lifetime may apply.",
    );
  }

  return causes;
}

function formatGoogleOAuthGrantErrorMessage(
  options: GoogleOAuthGrantErrorOptions,
): string {
  const summary =
    options.operation === "refresh"
      ? "Google rejected the saved OAuth refresh token."
      : "Google rejected the browser authorization code.";
  const facts = buildGoogleOAuthGrantFacts(options);
  const possibleCauses = buildGoogleOAuthGrantPossibleCauses(options);
  const action =
    options.operation === "refresh"
      ? "Move or delete token.json, then retry the same tool call to complete browser authorization again."
      : "Retry the same tool call and complete the browser authorization flow again.";

  return [
    summary,
    "Confirmed details:",
    ...facts.map((fact) => `- ${fact}`),
    "Possible causes:",
    ...possibleCauses.map((cause) => `- ${cause}`),
    `Action: ${action}`,
  ].join("\n");
}

function wrapInvalidGrantError(
  error: unknown,
  options: Omit<GoogleOAuthGrantErrorOptions, "cause" | "details">,
): never {
  const details = extractGoogleOAuthErrorDetails(error);
  if (!isInvalidGrantError(details, error)) {
    throw error;
  }

  throw new GoogleOAuthGrantError({
    ...options,
    cause: error,
    details,
  });
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

  client.setCredentials(stripTokenDiagnosticsMetadata(token));
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
  const normalizedToken = withTokenDiagnosticsMetadata(
    withOptionalScope(
      mergedToken,
      result.credentials.scope ?? existingToken?.scope,
    ),
    {
      existingToken,
    },
  );

  client.setCredentials(stripTokenDiagnosticsMetadata(normalizedToken));
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
  let result: OAuthTokenResponseShape;
  try {
    result = await client.getToken(getTokenArg);
  } catch (error) {
    wrapInvalidGrantError(error, {
      credentials: options.credentials,
      credentialsPath: options.credentialsPath,
      operation: "authorization_code_exchange",
      tokenPath: options.tokenPath,
    });
  }
  if (!hasValidTokenShape(result.tokens)) {
    throw new Error("Saved token JSON has an invalid shape.");
  }

  if ((options.requireRefreshToken ?? true) && !result.tokens.refresh_token) {
    throw new Error(
      "Interactive OAuth exchange must return a refresh_token. Re-run consent and try again.",
    );
  }

  const token = withRequiredScopes(result.tokens, options.scopes ?? []);
  client.setCredentials(stripTokenDiagnosticsMetadata(token));
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
      credentials: options.credentials,
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
    let refreshedToken: SavedToken;
    try {
      refreshedToken = await refreshSavedToken(client);
    } catch (error) {
      wrapInvalidGrantError(error, {
        credentials,
        credentialsPath: options.credentialsPath,
        operation: "refresh",
        savedToken,
        tokenPath: options.tokenPath,
      });
    }
    const tokenWithDiagnostics = withTokenDiagnosticsMetadata(refreshedToken, {
      credentials,
      credentialsPath: options.credentialsPath,
      existingToken: savedToken,
      scopes: options.scopes,
    });
    await (options.saveToken ?? saveToken)(options.tokenPath, tokenWithDiagnostics);

    return {
      source: "refreshed",
      token: tokenWithDiagnostics,
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
  const interactiveToken = withTokenDiagnosticsMetadata(
    withRequiredScopes(
      interactiveAuthorization.token,
      options.scopes,
    ),
    {
      authorizedAt: new Date(now).toISOString(),
      credentials,
      credentialsPath: options.credentialsPath,
      scopes: options.scopes,
    },
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
