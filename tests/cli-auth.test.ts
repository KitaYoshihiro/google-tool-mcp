import test from "node:test";
import assert from "node:assert/strict";

import { GmailAuthRequiredError } from "../src/auth/googleAuth";
import { runCli } from "../src/cli";

test("cli prints the default config dir and skips auth bootstrap", async () => {
  let ensureCalled = false;
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(
    ["--print-config-dir"],
    {
      out(message) {
        stdout.push(message);
      },
      error(message) {
        stderr.push(message);
      },
    },
    {
      env: {
        HOME: "/home/alice",
      },
      platform: "linux",
      ensureAuthorizedToken: async () => {
        ensureCalled = true;
        return {
          source: "saved",
          token: {
            access_token: "access-token",
          },
        };
      },
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(ensureCalled, false);
  assert.deepEqual(stdout, ["/home/alice/.config/google-tool"]);
  assert.deepEqual(stderr, []);
});

test("cli prints the profiled config dir when GOOGLE_TOOL_PROFILE is set", async () => {
  const stdout: string[] = [];

  const exitCode = await runCli(
    ["--print-config-dir"],
    {
      out(message) {
        stdout.push(message);
      },
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
        GOOGLE_TOOL_PROFILE: "work",
      },
      platform: "linux",
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["/home/alice/.config/google-tool/profiles/work"]);
});

test("cli prints the profiled config dir when --profile is set", async () => {
  const stdout: string[] = [];

  const exitCode = await runCli(
    ["--print-config-dir", "--profile", "team-a"],
    {
      out(message) {
        stdout.push(message);
      },
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
      },
      platform: "linux",
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["/home/alice/.config/google-tool/profiles/team-a"]);
});

test("cli accepts --profile=value", async () => {
  const stdout: string[] = [];

  const exitCode = await runCli(
    ["--print-config-dir", "--profile=team-a"],
    {
      out(message) {
        stdout.push(message);
      },
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
      },
      platform: "linux",
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["/home/alice/.config/google-tool/profiles/team-a"]);
});

test("cli prefers --profile over GOOGLE_TOOL_PROFILE", async () => {
  const stdout: string[] = [];

  const exitCode = await runCli(
    ["--print-config-dir", "--profile", "work"],
    {
      out(message) {
        stdout.push(message);
      },
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
        GOOGLE_TOOL_PROFILE: "personal",
      },
      platform: "linux",
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["/home/alice/.config/google-tool/profiles/work"]);
});

test("cli rejects --profile without a value", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(
    ["--profile"],
    {
      out() {},
      error(message) {
        stderr.push(message);
      },
    },
    {},
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(stderr, ["Missing value for --profile."]);
});

test("cli rejects --profile= without a value", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(
    ["--profile="],
    {
      out() {},
      error(message) {
        stderr.push(message);
      },
    },
    {},
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(stderr, ["Missing value for --profile."]);
});

test("cli bootstraps auth with configured paths and Gmail readonly scope", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ensuredDirs: string[] = [];
  let observedOptions:
    | {
        credentialsPath: string;
        tokenPath: string;
        allowBrowserAuth: boolean;
        requireGrantedScopes: boolean | undefined;
        scopes: readonly string[];
      }
    | undefined;

  const exitCode = await runCli(
    [],
    {
      out(message) {
        stdout.push(message);
      },
      error(message) {
        stderr.push(message);
      },
    },
    {
      env: {
        HOME: "/home/alice",
      },
      platform: "linux",
      ensureDir: async (dirPath) => {
        ensuredDirs.push(dirPath);
      },
      ensureAuthorizedToken: async (options) => {
        observedOptions = {
          credentialsPath: options.credentialsPath,
          tokenPath: options.tokenPath,
          allowBrowserAuth: options.allowBrowserAuth,
          requireGrantedScopes: options.requireGrantedScopes,
          scopes: options.scopes,
        };
        await options.onAuthorizationReady?.({
          authorizationUrl: "https://example.com/auth",
          browserOpened: false,
          manualInstructions:
            "Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth",
          redirectUri: "http://127.0.0.1:43123/callback",
        });
        return {
          source: "interactive",
          token: {
            access_token: "access-token",
            refresh_token: "refresh-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["No messages matched the request."]);
  assert.deepEqual(stderr, [
    "Open this URL in your browser to continue Google authorization:\nhttps://example.com/auth",
  ]);
  assert.deepEqual(observedOptions, {
    credentialsPath: "/home/alice/.config/google-tool/credentials.json",
    tokenPath: "/home/alice/.config/google-tool/token.json",
    allowBrowserAuth: true,
    requireGrantedScopes: true,
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
  });
  assert.deepEqual(ensuredDirs, ["/home/alice/.config/google-tool"]);
});

test("cli bootstraps auth inside the profiled config dir", async () => {
  const ensuredDirs: string[] = [];
  let observedOptions:
    | {
        credentialsPath: string;
        tokenPath: string;
      }
    | undefined;

  const exitCode = await runCli(
    [],
    {
      out() {},
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
        GOOGLE_TOOL_PROFILE: "work",
      },
      platform: "linux",
      pathExists: async (filePath) =>
        filePath === "/home/alice/.config/google-tool/profiles/work/credentials.json",
      ensureDir: async (dirPath) => {
        ensuredDirs.push(dirPath);
      },
      ensureAuthorizedToken: async (options) => {
        observedOptions = {
          credentialsPath: options.credentialsPath,
          tokenPath: options.tokenPath,
        };
        return {
          source: "saved",
          token: {
            access_token: "access-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(observedOptions, {
    credentialsPath: "/home/alice/.config/google-tool/profiles/work/credentials.json",
    tokenPath: "/home/alice/.config/google-tool/profiles/work/token.json",
  });
  assert.deepEqual(ensuredDirs, ["/home/alice/.config/google-tool/profiles/work"]);
});

test("cli bootstraps auth inside the --profile config dir", async () => {
  let observedOptions:
    | {
        credentialsPath: string;
        tokenPath: string;
      }
    | undefined;

  const exitCode = await runCli(
    ["--profile", "work"],
    {
      out() {},
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
        GOOGLE_TOOL_PROFILE: "personal",
      },
      platform: "linux",
      pathExists: async (filePath) =>
        filePath === "/home/alice/.config/google-tool/profiles/work/credentials.json",
      ensureDir: async () => {},
      ensureAuthorizedToken: async (options) => {
        observedOptions = {
          credentialsPath: options.credentialsPath,
          tokenPath: options.tokenPath,
        };
        return {
          source: "saved",
          token: {
            access_token: "access-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(observedOptions, {
    credentialsPath: "/home/alice/.config/google-tool/profiles/work/credentials.json",
    tokenPath: "/home/alice/.config/google-tool/profiles/work/token.json",
  });
});

test("cli bootstraps auth inside the --profile=value config dir", async () => {
  let observedOptions:
    | {
        credentialsPath: string;
        tokenPath: string;
      }
    | undefined;

  const exitCode = await runCli(
    ["--profile=work"],
    {
      out() {},
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
      },
      platform: "linux",
      pathExists: async (filePath) =>
        filePath === "/home/alice/.config/google-tool/profiles/work/credentials.json",
      ensureDir: async () => {},
      ensureAuthorizedToken: async (options) => {
        observedOptions = {
          credentialsPath: options.credentialsPath,
          tokenPath: options.tokenPath,
        };
        return {
          source: "saved",
          token: {
            access_token: "access-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(observedOptions, {
    credentialsPath: "/home/alice/.config/google-tool/profiles/work/credentials.json",
    tokenPath: "/home/alice/.config/google-tool/profiles/work/token.json",
  });
});

test("cli falls back to shared credentials when profiled credentials are missing", async () => {
  let observedOptions:
    | {
        credentialsPath: string;
        tokenPath: string;
      }
    | undefined;

  const exitCode = await runCli(
    [],
    {
      out() {},
      error() {},
    },
    {
      env: {
        HOME: "/home/alice",
        GOOGLE_TOOL_PROFILE: "work",
      },
      platform: "linux",
      ensureDir: async () => {},
      pathExists: async (filePath) =>
        filePath === "/home/alice/.config/google-tool/profiles/work/credentials.json"
          ? false
          : filePath === "/home/alice/.config/google-tool/credentials.json",
      ensureAuthorizedToken: async (options) => {
        observedOptions = {
          credentialsPath: options.credentialsPath,
          tokenPath: options.tokenPath,
        };
        return {
          source: "saved",
          token: {
            access_token: "access-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(observedOptions, {
    credentialsPath: "/home/alice/.config/google-tool/credentials.json",
    tokenPath: "/home/alice/.config/google-tool/profiles/work/token.json",
  });
});

test("cli resolves explicit credentials and token path arguments", async () => {
  let observedPaths:
    | {
        credentialsPath: string;
        tokenPath: string;
      }
    | undefined;
  let ensureDirCalls = 0;

  const exitCode = await runCli(
    ["--credentials", "./secrets/credentials.json", "--token", "./state/token.json"],
    {
      out() {},
      error() {},
    },
    {
      cwd: "/workspace/project",
      ensureDir: async () => {
        ensureDirCalls += 1;
      },
      ensureAuthorizedToken: async (options) => {
        observedPaths = {
          credentialsPath: options.credentialsPath,
          tokenPath: options.tokenPath,
        };
        return {
          source: "saved",
          token: {
            access_token: "access-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(observedPaths, {
    credentialsPath: "/workspace/project/secrets/credentials.json",
    tokenPath: "/workspace/project/state/token.json",
  });
  assert.equal(ensureDirCalls, 0);
});

test("cli expands ~/ paths using USERPROFILE on Windows", async () => {
  let observedPaths:
    | {
        credentialsPath: string;
        tokenPath: string;
      }
    | undefined;

  const exitCode = await runCli(
    ["--credentials", "~/secrets/credentials.json", "--token", "~/state/token.json"],
    {
      out() {},
      error() {},
    },
    {
      env: {
        USERPROFILE: "C:\\Users\\alice",
      },
      platform: "win32",
      ensureAuthorizedToken: async (options) => {
        observedPaths = {
          credentialsPath: options.credentialsPath,
          tokenPath: options.tokenPath,
        };
        return {
          source: "saved",
          token: {
            access_token: "access-token",
          },
        };
      },
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(observedPaths, {
    credentialsPath: "C:\\Users\\alice\\secrets\\credentials.json",
    tokenPath: "C:\\Users\\alice\\state\\token.json",
  });
});

test("cli can complete auth bootstrap and continue into an empty message result", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(
    [],
    {
      out(message) {
        stdout.push(message);
      },
      error(message) {
        stderr.push(message);
      },
    },
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
        },
      }),
      createGmailClient: async () => ({
        async listLabels() {
          return [];
        },
        async listMessageIds() {
          return [];
        },
        async getMessage() {
          throw new Error("not needed");
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ["No messages matched the request."]);
  assert.deepEqual(stderr, []);
});

test("cli can complete auth bootstrap and continue into an empty Drive result", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let gmailClientCalled = false;

  const exitCode = await runCli(
    ["--drive-query", "name contains 'Plan'"],
    {
      out(message) {
        stdout.push(message);
      },
      error(message) {
        stderr.push(message);
      },
    },
    {
      ensureAuthorizedToken: async () => ({
        source: "saved",
        token: {
          access_token: "access-token",
          scope:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.metadata.readonly",
        },
      }),
      createGmailClient: async () => {
        gmailClientCalled = true;
        throw new Error("not needed");
      },
      createDriveClient: async () => ({
        async getAbout() {
          throw new Error("not needed");
        },
        async getFile() {
          throw new Error("not needed");
        },
        async listFiles() {
          return {
            files: [],
          };
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(gmailClientCalled, false);
  assert.deepEqual(stdout, ["No Drive files matched the request."]);
  assert.deepEqual(stderr, []);
});

test("cli prints auth/bootstrap errors without stack traces", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(
    [],
    {
      out(message) {
        stdout.push(message);
      },
      error(message) {
        stderr.push(message);
      },
    },
    {
      ensureAuthorizedToken: async () => {
        throw new GmailAuthRequiredError("/tmp/token.json");
      },
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    "OAuth token was not ready at /tmp/token.json. Complete Google authorization, or point GOOGLE_TOOL_TOKEN to an existing token.json file.",
  ]);
});
