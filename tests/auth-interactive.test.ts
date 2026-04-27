import test from "node:test";
import assert from "node:assert/strict";
import { Socket } from "node:net";

import {
  buildRuntimeRedirectUri,
  createLoopbackAuthorizationListener,
  runInteractiveAuthorization,
} from "../src/auth/googleAuth";

async function createListenerOrSkip(
  t: { skip(message?: string): void },
  baseRedirectUri: string,
  options: {
    expectedState: string;
    timeoutMs?: number;
  },
): Promise<Awaited<ReturnType<typeof createLoopbackAuthorizationListener>> | null> {
  try {
    return await createLoopbackAuthorizationListener(baseRedirectUri, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Loopback listener is not permitted in this environment.");
      return null;
    }

    throw error;
  }
}

test("runtime redirect URI preserves path and swaps the bound port", () => {
  assert.equal(
    buildRuntimeRedirectUri("http://127.0.0.1/callback", 43123),
    "http://127.0.0.1:43123/callback",
  );
  assert.equal(
    buildRuntimeRedirectUri("http://localhost", 39001),
    "http://localhost:39001/",
  );
});

test("loopback authorization listener resolves a matching callback", async (t) => {
  const listener = await createListenerOrSkip(
    t,
    "http://127.0.0.1/callback",
    {
      expectedState: "csrf-state",
      timeoutMs: 1000,
    },
  );
  if (!listener) {
    return;
  }

  try {
    const waitForCode = listener.waitForCode();
    const response = await fetch(
      `${listener.redirectUri}?code=auth-code&state=csrf-state`,
    );

    assert.equal(response.status, 200);
    assert.match(await response.text(), /Authorization completed/);
    const result = await waitForCode;
    assert.equal(result.code, "auth-code");
  } finally {
    await listener.close();
  }
});

test("loopback authorization listener rejects a callback with the wrong state", async (t) => {
  const listener = await createListenerOrSkip(
    t,
    "http://127.0.0.1/callback",
    {
      expectedState: "expected-state",
      timeoutMs: 1000,
    },
  );
  if (!listener) {
    return;
  }

  try {
    const rejection = assert.rejects(
      listener.waitForCode(),
      /OAuth state mismatch\./,
    );
    const response = await fetch(
      `${listener.redirectUri}?code=auth-code&state=wrong-state`,
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), /Authorization failed/);
    await rejection;
  } finally {
    await listener.close();
  }
});

test("loopback authorization listener rejects an OAuth error callback", async (t) => {
  const listener = await createListenerOrSkip(
    t,
    "http://127.0.0.1/callback",
    {
      expectedState: "csrf-state",
      timeoutMs: 1000,
    },
  );
  if (!listener) {
    return;
  }

  try {
    const rejection = assert.rejects(
      listener.waitForCode(),
      /OAuth authorization failed: access_denied/,
    );
    const response = await fetch(
      `${listener.redirectUri}?error=access_denied&state=csrf-state`,
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), /Authorization failed/);
    await rejection;
  } finally {
    await listener.close();
  }
});

test("loopback authorization listener rejects on timeout", async (t) => {
  const listener = await createListenerOrSkip(
    t,
    "http://127.0.0.1/callback",
    {
      expectedState: "csrf-state",
      timeoutMs: 50,
    },
  );
  if (!listener) {
    return;
  }

  try {
    await assert.rejects(listener.waitForCode(), /OAuth authorization timed out\./);
  } finally {
    await listener.close();
  }
});

test("loopback authorization listener closes promptly after a successful callback", async (t) => {
  const listener = await createListenerOrSkip(
    t,
    "http://127.0.0.1/callback",
    {
      expectedState: "csrf-state",
      timeoutMs: 1000,
    },
  );
  if (!listener) {
    return;
  }

  const redirectUrl = new URL(listener.redirectUri);
  const socket = new Socket();
  let responseText = "";

  try {
    const waitForCode = listener.waitForCode();
    const responseReceived = new Promise<void>((resolve, reject) => {
      socket.setEncoding("utf8");
      socket.once("error", reject);
      socket.on("data", (chunk: string) => {
        responseText += chunk;
        if (responseText.includes("Authorization completed. You can return to the app.")) {
          resolve();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      socket.connect(
        Number(redirectUrl.port),
        redirectUrl.hostname,
        () => {
          socket.write(
            [
              `GET ${redirectUrl.pathname}?code=auth-code&state=csrf-state HTTP/1.1`,
              `Host: ${redirectUrl.host}`,
              "Connection: keep-alive",
              "",
              "",
            ].join("\r\n"),
          );
          resolve();
        },
      );
      socket.once("error", reject);
    });

    await responseReceived;
    const result = await waitForCode;
    assert.equal(result.code, "auth-code");
    assert.match(responseText, /Connection: close/i);

    const closeResult = await Promise.race([
      listener.close().then(() => "closed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 200)),
    ]);
    assert.equal(closeResult, "closed");
  } finally {
    socket.destroy();
    await listener.close().catch(() => undefined);
  }
});

test("interactive authorization orchestrates state, PKCE, manual fallback and code exchange", async () => {
  const observed: Record<string, unknown> = {};

  const result = await runInteractiveAuthorization({
    credentials: {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUris: ["http://127.0.0.1/callback"],
    },
    scopes: ["scope-a"],
    stateFactory() {
      return "csrf-state";
    },
    listenerFactory: async (_baseRedirectUri, options) => {
      observed.listenerExpectedState = options.expectedState;
      return {
        redirectUri: "http://127.0.0.1:43123/callback",
        async waitForCode() {
          return { code: "auth-code" };
        },
        async close() {},
      };
    },
    clientFactory(redirectUri) {
      observed.redirectUri = redirectUri;
      return {
        credentials: {},
        setCredentials(credentials: Record<string, unknown>) {
          this.credentials = credentials;
        },
        generateAuthUrl(options: Record<string, unknown>) {
          observed.authOptions = options;
          return "https://example.com/auth";
        },
        async generateCodeVerifierAsync() {
          return {
            codeVerifier: "pkce-verifier",
            codeChallenge: "pkce-challenge",
          };
        },
        async getToken(options: unknown) {
          observed.exchangeOptions = options;
          return {
            tokens: {
              access_token: "access-token",
              refresh_token: "refresh-token",
            },
          };
        },
      };
    },
    browserOpener() {
      return false;
    },
  });

  assert.deepEqual(result.token, {
    access_token: "access-token",
    refresh_token: "refresh-token",
    scope: "scope-a",
  });
  assert.equal(result.authorizationUrl, "https://example.com/auth");
  assert.equal(result.browserOpened, false);
  assert.match(result.manualInstructions ?? "", /https:\/\/example.com\/auth/);
  assert.equal(result.redirectUri, "http://127.0.0.1:43123/callback");
  assert.equal(observed.listenerExpectedState, "csrf-state");
  assert.equal(observed.redirectUri, "http://127.0.0.1:43123/callback");
  assert.deepEqual(observed.authOptions, {
    access_type: "offline",
    prompt: "consent",
    scope: ["scope-a"],
    state: "csrf-state",
    code_challenge: "pkce-challenge",
    code_challenge_method: "S256",
  });
  assert.deepEqual(observed.exchangeOptions, {
    code: "auth-code",
    codeVerifier: "pkce-verifier",
  });
});

test("interactive authorization exposes manual fallback before waiting for the code", async () => {
  let resolveCode: ((value: { code: string }) => void) | undefined;
  let authorizationReadyCalled = false;
  let callbackNotice: Record<string, unknown> | undefined;
  let exchangeCalled = false;
  let resolveAuthorizationReady: (() => void) | undefined;
  const authorizationReady = new Promise<void>((resolve) => {
    resolveAuthorizationReady = resolve;
  });

  const authorizationPromise = runInteractiveAuthorization({
    credentials: {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUris: ["http://127.0.0.1/callback"],
    },
    scopes: ["scope-a"],
    stateFactory() {
      return "csrf-state";
    },
    listenerFactory: async (_baseRedirectUri, options) => {
      assert.equal(options.expectedState, "csrf-state");
      return {
        redirectUri: "http://127.0.0.1:43123/callback",
        waitForCode() {
          return new Promise<{ code: string }>((resolve) => {
            resolveCode = resolve;
          });
        },
        async close() {},
      };
    },
    clientFactory() {
      return {
        credentials: {},
        setCredentials() {},
        generateAuthUrl() {
          return "https://example.com/auth";
        },
        async generateCodeVerifierAsync() {
          return {
            codeVerifier: "pkce-verifier",
            codeChallenge: "pkce-challenge",
          };
        },
        async getToken() {
          exchangeCalled = true;
          return {
            tokens: {
              access_token: "access-token",
              refresh_token: "refresh-token",
            },
          };
        },
      };
    },
    browserOpener() {
      return false;
    },
    onAuthorizationReady(notice) {
      authorizationReadyCalled = true;
      callbackNotice = notice;
      assert.equal(exchangeCalled, false);
      resolveAuthorizationReady?.();
    },
  });

  await authorizationReady;

  assert.equal(authorizationReadyCalled, true);
  assert.deepEqual(callbackNotice, {
    authorizationUrl: "https://example.com/auth",
    browserOpened: false,
    manualInstructions:
      "Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth",
    redirectUri: "http://127.0.0.1:43123/callback",
  });
  assert.equal(exchangeCalled, false);

  await Promise.resolve();
  resolveCode?.({ code: "auth-code" });
  const result = await authorizationPromise;
  assert.equal(result.token.refresh_token, "refresh-token");
});
