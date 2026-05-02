import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ENV_TOKEN_PATH } from "../src/config/constants";
import {
  applySavedToken,
  buildAuthorizationUrl,
  buildManualAuthInstructions,
  createOAuthClient,
  ensureAuthorizedToken,
  exchangeCodeForToken,
  GmailAuthRequiredError,
  GoogleOAuthGrantError,
  GoogleScopeRequiredError,
  getPreferredRedirectUri,
  loadOAuthClientCredentials,
  loadSavedToken,
  openSystemBrowser,
  parseOAuthClientFile,
  refreshSavedToken,
  saveToken,
} from "../src/auth/googleAuth";

test("oauth client file parser accepts Desktop app credentials", () => {
  const parsed = parseOAuthClientFile(
    JSON.stringify({
      installed: {
        client_id: "client-id",
        client_secret: "client-secret",
        redirect_uris: ["http://127.0.0.1", "http://localhost"],
      },
    }),
  );

  assert.deepEqual(parsed, {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUris: ["http://127.0.0.1", "http://localhost"],
  });
});

test("oauth client file parser rejects unsupported credential shapes", () => {
  assert.throws(
    () =>
      parseOAuthClientFile(
        JSON.stringify({
          web: {
            client_id: "client-id",
          },
        }),
      ),
    /Desktop app OAuth client JSON is required\./,
  );
});

test("oauth client file parser requires at least one redirect URI", () => {
  assert.throws(
    () =>
      parseOAuthClientFile(
        JSON.stringify({
          installed: {
            client_id: "client-id",
            client_secret: "client-secret",
            redirect_uris: [],
          },
        }),
      ),
    /Desktop app OAuth client JSON must contain at least one redirect URI\./,
  );
});

test("oauth client file parser requires a loopback redirect URI", () => {
  assert.throws(
    () =>
      parseOAuthClientFile(
        JSON.stringify({
          installed: {
            client_id: "client-id",
            client_secret: "client-secret",
            redirect_uris: ["urn:ietf:wg:oauth:2.0:oob"],
          },
        }),
      ),
    /Desktop app OAuth client JSON must contain a loopback redirect URI\./,
  );
});

test("oauth client file parser rejects non-loopback hosts that only share a prefix", () => {
  assert.throws(
    () =>
      parseOAuthClientFile(
        JSON.stringify({
          installed: {
            client_id: "client-id",
            client_secret: "client-secret",
            redirect_uris: ["http://localhost.evil.test/callback"],
          },
        }),
      ),
    /Desktop app OAuth client JSON must contain a loopback redirect URI\./,
  );
});

test("oauth client file parser ignores empty redirect URIs", () => {
  const parsed = parseOAuthClientFile(
    JSON.stringify({
      installed: {
        client_id: "client-id",
        client_secret: "client-secret",
        redirect_uris: ["", "http://localhost"],
      },
    }),
  );

  assert.deepEqual(parsed.redirectUris, ["http://localhost"]);
});

test("preferred redirect URI favors 127.0.0.1 over localhost", () => {
  assert.equal(
    getPreferredRedirectUri({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUris: ["http://localhost:3000", "http://127.0.0.1:4000"],
    }),
    "http://127.0.0.1:4000",
  );
});

test("preferred redirect URI ignores prefix-matching non-loopback values", () => {
  assert.equal(
    getPreferredRedirectUri({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUris: [
        "http://127.0.0.1.evil.test/callback",
        "http://localhost.evil.test/callback",
        "http://localhost:3000",
      ],
    }),
    "http://localhost:3000",
  );
});

test("oauth client generates an offline consent authorization URL", () => {
  const client = createOAuthClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUris: ["http://localhost:3000", "http://127.0.0.1:4000"],
  });

  const authorizationUrl = buildAuthorizationUrl(client, [
    "https://www.googleapis.com/auth/gmail.readonly",
  ]);
  const parsedUrl = new URL(authorizationUrl);

  assert.equal(parsedUrl.searchParams.get("client_id"), "client-id");
  assert.equal(parsedUrl.searchParams.get("redirect_uri"), "http://127.0.0.1:4000");
  assert.equal(parsedUrl.searchParams.get("access_type"), "offline");
  assert.equal(parsedUrl.searchParams.get("prompt"), "consent");
  assert.equal(
    parsedUrl.searchParams.get("scope"),
    "https://www.googleapis.com/auth/gmail.readonly",
  );
});

test("oauth client authorization URL can carry state and PKCE parameters", () => {
  const client = createOAuthClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUris: ["http://127.0.0.1:4000"],
  });

  const authorizationUrl = buildAuthorizationUrl(
    client,
    ["https://www.googleapis.com/auth/gmail.readonly"],
    {
      state: "csrf-state",
      codeChallenge: "pkce-challenge",
    },
  );
  const parsedUrl = new URL(authorizationUrl);

  assert.equal(parsedUrl.searchParams.get("state"), "csrf-state");
  assert.equal(parsedUrl.searchParams.get("code_challenge"), "pkce-challenge");
  assert.equal(parsedUrl.searchParams.get("code_challenge_method"), "S256");
});

test("applySavedToken stores validated credentials on the client", () => {
  const client = {
    credentials: {},
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    },
  };

  const applied = applySavedToken(client, {
    refresh_token: "refresh-token",
  });

  assert.deepEqual(applied, { refresh_token: "refresh-token" });
  assert.deepEqual(client.credentials, { refresh_token: "refresh-token" });
});

test("refreshSavedToken validates and applies refreshed credentials", async () => {
  const client = {
    credentials: {},
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    },
    async refreshAccessToken() {
      return {
        credentials: {
          access_token: "new-access-token",
          refresh_token: "refresh-token",
        },
      };
    },
  };

  const refreshed = await refreshSavedToken(client);

  assert.deepEqual(refreshed, {
    access_token: "new-access-token",
    refresh_token: "refresh-token",
  });
  assert.deepEqual(client.credentials, refreshed);
});

test("refreshSavedToken preserves the existing refresh token when refresh omits it", async () => {
  const client = {
    credentials: {
      refresh_token: "refresh-token",
    },
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    },
    async refreshAccessToken() {
      return {
        credentials: {
          access_token: "new-access-token",
          expiry_date: 123456789,
        },
      };
    },
  };

  const refreshed = await refreshSavedToken(client);

  assert.deepEqual(refreshed, {
    access_token: "new-access-token",
    refresh_token: "refresh-token",
    expiry_date: 123456789,
  });
  assert.deepEqual(client.credentials, refreshed);
});

test("exchangeCodeForToken validates and applies exchanged credentials", async () => {
  const client = {
    credentials: {},
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    },
    async getToken(codeOrOptions: string | { code: string; codeVerifier?: string }) {
      assert.equal(codeOrOptions, "auth-code");
      return {
        tokens: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      };
    },
  };

  const token = await exchangeCodeForToken(client, "auth-code");

  assert.deepEqual(token, {
    access_token: "access-token",
    refresh_token: "refresh-token",
  });
  assert.deepEqual(client.credentials, token);
});

test("exchangeCodeForToken can pass a PKCE code verifier", async () => {
  const client = {
    credentials: {},
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    },
    async getToken(codeOrOptions: string | { code: string; codeVerifier?: string }) {
      assert.deepEqual(codeOrOptions, {
        code: "auth-code",
        codeVerifier: "pkce-verifier",
      });
      return {
        tokens: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      };
    },
  };

  const token = await exchangeCodeForToken(client, "auth-code", {
    codeVerifier: "pkce-verifier",
  });

  assert.equal(token.refresh_token, "refresh-token");
});

test("exchangeCodeForToken requires a refresh token by default", async () => {
  const client = {
    credentials: {},
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    },
    async getToken() {
      return {
        tokens: {
          access_token: "access-token",
        },
      };
    },
  };

  await assert.rejects(
    exchangeCodeForToken(client, "auth-code"),
    /Interactive OAuth exchange must return a refresh_token\./,
  );
});

test("exchangeCodeForToken can opt out of refresh token enforcement", async () => {
  const client = {
    credentials: {},
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    },
    async getToken() {
      return {
        tokens: {
          access_token: "access-token",
        },
      };
    },
  };

  const token = await exchangeCodeForToken(client, "auth-code", {
    requireRefreshToken: false,
  });

  assert.deepEqual(token, {
    access_token: "access-token",
  });
});

test("exchangeCodeForToken explains invalid_grant during authorization code exchange", async () => {
  const client = {
    credentials: {},
    setCredentials() {},
    async getToken() {
      const error = new Error("invalid_grant");
      Object.assign(error, {
        response: {
          status: 400,
          data: {
            error: "invalid_grant",
            error_description: "Bad Request",
          },
        },
      });
      throw error;
    },
  };

  await assert.rejects(
    exchangeCodeForToken(client, "auth-code", {
      credentials: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUris: ["http://127.0.0.1/callback"],
      },
    }),
    (error: unknown) =>
      error instanceof GoogleOAuthGrantError &&
      error.operation === "authorization_code_exchange" &&
      error.message.includes("Google rejected the browser authorization code.") &&
      error.message.includes("The authorization code expired or was already used.") &&
      error.message.includes("Google response: Bad Request"),
  );
});

test("exchangeCodeForToken preserves non-invalid_grant token exchange errors", async () => {
  const originalError = new Error("network unavailable");
  const client = {
    credentials: {},
    setCredentials() {},
    async getToken() {
      throw originalError;
    },
  };

  await assert.rejects(
    exchangeCodeForToken(client, "auth-code"),
    (error: unknown) => error === originalError,
  );
});

test("manual auth instructions include the authorization URL", () => {
  assert.equal(
    buildManualAuthInstructions("https://example.com/auth"),
    "Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth",
  );
});

test("browser opener uses platform-specific commands", () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  assert.equal(
    openSystemBrowser("https://example.com/auth", {
      platform: "darwin",
      runner(command, args) {
        calls.push({ command, args });
        return { status: 0 };
      },
    }),
    true,
  );

  assert.equal(
    openSystemBrowser("https://example.com/auth", {
      platform: "linux",
      runner(command, args) {
        calls.push({ command, args });
        return { status: 0 };
      },
    }),
    true,
  );

  assert.equal(
    openSystemBrowser("https://example.com/auth", {
      platform: "win32",
      runner(command, args) {
        calls.push({ command, args });
        return { status: 0 };
      },
    }),
    true,
  );

  assert.deepEqual(calls, [
    { command: "open", args: ["https://example.com/auth"] },
    { command: "xdg-open", args: ["https://example.com/auth"] },
    {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "https://example.com/auth"],
    },
  ]);
});

test("browser opener reports launch failure", () => {
  assert.equal(
    openSystemBrowser("https://example.com/auth", {
      platform: "linux",
      runner() {
        return { status: 1 };
      },
    }),
    false,
  );
});

test("saved token loader returns null when token file is missing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "gmail-token-missing-"));
  const missingPath = path.join(tempDir, "token.json");

  try {
    const token = await loadSavedToken(missingPath);
    assert.equal(token, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saved token loader parses persisted token JSON", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "gmail-token-load-"));
  const tokenPath = path.join(tempDir, "token.json");

  try {
    writeFileSync(
      tokenPath,
      JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: "scope-a scope-b",
        token_type: "Bearer",
        expiry_date: 123456789,
      }),
      "utf-8",
    );

    const token = await loadSavedToken(tokenPath);
    assert.deepEqual(token, {
      access_token: "access-token",
      refresh_token: "refresh-token",
      scope: "scope-a scope-b",
      token_type: "Bearer",
      expiry_date: 123456789,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("oauth client credentials loader rewrites missing-file errors with setup guidance", async () => {
  await assert.rejects(
    loadOAuthClientCredentials("/tmp/missing-credentials.json"),
    /OAuth client file was not found: \/tmp\/missing-credentials\.json\./,
  );
});

test("ensureAuthorizedToken returns a reusable saved token without touching disk", async () => {
  let saveCalled = false;

  const result = await ensureAuthorizedToken({
    credentialsPath: "/tmp/credentials.json",
    tokenPath: "/tmp/token.json",
    scopes: ["scope-a"],
    allowBrowserAuth: true,
    now: 1_000,
    loadSavedToken: async () => ({
      access_token: "access-token",
      expiry_date: 1_000_000,
    }),
    saveToken: async () => {
      saveCalled = true;
    },
  });

  assert.deepEqual(result, {
    source: "saved",
    token: {
      access_token: "access-token",
      expiry_date: 1_000_000,
    },
  });
  assert.equal(saveCalled, false);
});

test("ensureAuthorizedToken refreshes an expired token and persists it", async () => {
  const savedTokens: Array<{ tokenPath: string; token: Record<string, unknown> }> = [];

  const result = await ensureAuthorizedToken({
    credentialsPath: "/tmp/credentials.json",
    tokenPath: "/tmp/token.json",
    scopes: ["scope-a"],
    allowBrowserAuth: false,
    now: 1_000,
    loadSavedToken: async () => ({
      access_token: "stale-access-token",
      refresh_token: "refresh-token",
      expiry_date: 100,
    }),
    readTextFile: async () =>
      JSON.stringify({
        installed: {
          client_id: "client-id",
          client_secret: "client-secret",
          redirect_uris: ["http://127.0.0.1/callback"],
        },
      }),
    clientFactory() {
      return {
        credentials: {},
        setCredentials(credentials: Record<string, unknown>) {
          this.credentials = credentials;
        },
        async refreshAccessToken() {
          return {
            credentials: {
              access_token: "fresh-access-token",
              expiry_date: 50_000,
            },
          };
        },
      };
    },
    saveToken: async (tokenPath, token) => {
      savedTokens.push({ tokenPath, token });
    },
  });

  assert.deepEqual(result, {
    source: "refreshed",
    token: {
      access_token: "fresh-access-token",
      refresh_token: "refresh-token",
      expiry_date: 50_000,
      _google_tool: {
        client_id: "client-id",
        credentials_path: "/tmp/credentials.json",
        scopes: ["scope-a"],
      },
    },
  });
  assert.deepEqual(savedTokens, [
    {
      tokenPath: "/tmp/token.json",
      token: {
        access_token: "fresh-access-token",
        refresh_token: "refresh-token",
        expiry_date: 50_000,
        _google_tool: {
          client_id: "client-id",
          credentials_path: "/tmp/credentials.json",
          scopes: ["scope-a"],
        },
      },
    },
  ]);
});

test("ensureAuthorizedToken explains invalid_grant while refreshing saved token", async () => {
  await assert.rejects(
    ensureAuthorizedToken({
      credentialsPath: "/tmp/credentials.json",
      tokenPath: "/tmp/token.json",
      scopes: ["scope-a"],
      allowBrowserAuth: false,
      now: 1_000,
      loadSavedToken: async () => ({
        access_token: "stale-access-token",
        refresh_token: "refresh-token",
        expiry_date: 100,
        _google_tool: {
          authorized_at: "2000-01-01T00:00:00.000Z",
          client_id: "old-client-id",
          credentials_path: "/tmp/old-credentials.json",
          scopes: ["scope-a"],
        },
      }),
      readTextFile: async () =>
        JSON.stringify({
          installed: {
            client_id: "new-client-id",
            client_secret: "client-secret",
            redirect_uris: ["http://127.0.0.1/callback"],
          },
        }),
      clientFactory() {
        return {
          credentials: {},
          setCredentials(credentials: Record<string, unknown>) {
            this.credentials = credentials;
          },
          async refreshAccessToken() {
            const error = new Error("invalid_grant");
            Object.assign(error, {
              response: {
                status: 400,
                data: {
                  error: "invalid_grant",
                  error_description: "Token has been expired or revoked.",
                },
              },
            });
            throw error;
          },
        };
      },
    }),
    (error: unknown) =>
      error instanceof GoogleOAuthGrantError &&
      error.operation === "refresh" &&
      error.message.includes("Google rejected the saved OAuth refresh token.") &&
      error.message.includes("Google response: Token has been expired or revoked.") &&
      error.message.includes("different OAuth client_id") &&
      error.message.includes("short refresh-token lifetime may apply") &&
      error.message.includes("Move or delete token.json"),
  );
});

test("ensureAuthorizedToken runs interactive auth and saves the resulting token", async () => {
  let observedNotice: Record<string, unknown> | undefined;
  const savedTokens: Array<{ tokenPath: string; token: Record<string, unknown> }> = [];

  const result = await ensureAuthorizedToken({
    credentialsPath: "/tmp/credentials.json",
    tokenPath: "/tmp/token.json",
    scopes: ["scope-a"],
    allowBrowserAuth: true,
    now: 1_000,
    loadSavedToken: async () => null,
    readTextFile: async () =>
      JSON.stringify({
        installed: {
          client_id: "client-id",
          client_secret: "client-secret",
          redirect_uris: ["http://127.0.0.1/callback"],
        },
      }),
    interactiveAuthorizationRunner: async (options) => {
      await options.onAuthorizationReady?.({
        authorizationUrl: "https://example.com/auth",
        browserOpened: true,
        redirectUri: "http://127.0.0.1:43123/callback",
      });
      return {
        token: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
        authorizationUrl: "https://example.com/auth",
        browserOpened: true,
        redirectUri: "http://127.0.0.1:43123/callback",
      };
    },
    onAuthorizationReady: async (notice) => {
      observedNotice = notice;
    },
    saveToken: async (tokenPath, token) => {
      savedTokens.push({ tokenPath, token });
    },
  });

  assert.deepEqual(observedNotice, {
    authorizationUrl: "https://example.com/auth",
    browserOpened: true,
    redirectUri: "http://127.0.0.1:43123/callback",
  });
  assert.deepEqual(result, {
    source: "interactive",
    token: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      scope: "scope-a",
      _google_tool: {
        authorized_at: "1970-01-01T00:00:01.000Z",
        client_id: "client-id",
        credentials_path: "/tmp/credentials.json",
        scopes: ["scope-a"],
      },
    },
  });
  assert.deepEqual(savedTokens, [
    {
      tokenPath: "/tmp/token.json",
      token: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: "scope-a",
        _google_tool: {
          authorized_at: "1970-01-01T00:00:01.000Z",
          client_id: "client-id",
          credentials_path: "/tmp/credentials.json",
          scopes: ["scope-a"],
        },
      },
    },
  ]);
});

test("ensureAuthorizedToken raises GmailAuthRequiredError when browser auth is disabled", async () => {
  await assert.rejects(
    ensureAuthorizedToken({
      credentialsPath: "/tmp/credentials.json",
      tokenPath: "/tmp/token.json",
      scopes: ["scope-a"],
      allowBrowserAuth: false,
      loadSavedToken: async () => null,
    }),
    /OAuth token was not ready at \/tmp\/token\.json\./,
  );
});

test("ensureAuthorizedToken raises GoogleScopeRequiredError when strict scope checking fails", async () => {
  await assert.rejects(
    ensureAuthorizedToken({
      credentialsPath: "/tmp/credentials.json",
      tokenPath: "/tmp/token.json",
      scopes: ["scope-b"],
      allowBrowserAuth: false,
      requireGrantedScopes: true,
      loadSavedToken: async () => ({
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: "scope-a",
      }),
    }),
    (error: unknown) =>
      error instanceof GoogleScopeRequiredError &&
      error.message ===
        "OAuth token at /tmp/token.json does not include the required Google API scopes. Reauthorize with the required scopes, or point GOOGLE_TOOL_TOKEN to a token.json file that includes them. Missing scopes: scope-b",
  );
});

test("saved token loader accepts refresh-token-only JSON", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "gmail-token-refresh-only-"));
  const tokenPath = path.join(tempDir, "token.json");

  try {
    writeFileSync(
      tokenPath,
      JSON.stringify({
        refresh_token: "refresh-token",
      }),
      "utf-8",
    );

    const token = await loadSavedToken(tokenPath);
    assert.deepEqual(token, {
      refresh_token: "refresh-token",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saved token loader rejects malformed token JSON shapes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "gmail-token-invalid-"));
  const tokenPath = path.join(tempDir, "token.json");

  try {
    writeFileSync(
      tokenPath,
      JSON.stringify({
        expiry_date: "tomorrow",
      }),
      "utf-8",
    );

    await assert.rejects(loadSavedToken(tokenPath), /Saved token JSON has an invalid shape\./);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveToken persists JSON and creates parent directories", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "gmail-token-save-"));
  const tokenPath = path.join(tempDir, "nested", "token.json");

  try {
    await saveToken(tokenPath, {
      access_token: "access-token",
      refresh_token: "refresh-token",
      scope: "scope-a",
      token_type: "Bearer",
      expiry_date: 123,
    });

    assert.deepEqual(JSON.parse(readFileSync(tokenPath, "utf-8")), {
      access_token: "access-token",
      refresh_token: "refresh-token",
      scope: "scope-a",
      token_type: "Bearer",
      expiry_date: 123,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveToken rejects invalid token shapes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "gmail-token-invalid-save-"));
  const tokenPath = path.join(tempDir, "nested", "token.json");

  try {
    await assert.rejects(
      saveToken(tokenPath, {
        expiry_date: 123,
      }),
      /Saved token JSON has an invalid shape\./,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("auth required error message points users to authorization and env var", () => {
  const error = new GmailAuthRequiredError("/tmp/token.json");
  assert.match(
    error.message,
    new RegExp(
      `OAuth token was not ready at /tmp/token\\.json\\. Complete Google authorization, or point ${ENV_TOKEN_PATH} to an existing token\\.json file\\.`,
    ),
  );
});
