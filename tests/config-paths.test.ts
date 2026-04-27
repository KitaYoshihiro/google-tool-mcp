import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  getDefaultConfigDir,
  getDefaultCredentialPaths,
  getSharedCredentialPaths,
  resolveProfileName,
  resolveConfiguredPaths,
  shouldUseSharedCredentialFallback,
} from "../src/config/paths";

test("default config dir uses ~/.config on Windows", () => {
  const configDir = getDefaultConfigDir({
    platform: "win32",
    homeDir: "C:\\Users\\alice",
    env: { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" },
  });

  assert.equal(configDir, path.win32.join("C:\\Users\\alice", ".config", "google-tool"));
});

test("default config dir uses ~/.config on macOS", () => {
  const configDir = getDefaultConfigDir({
    platform: "darwin",
    homeDir: "/Users/alice",
    env: {},
  });

  assert.equal(configDir, path.posix.join("/Users/alice", ".config", "google-tool"));
});

test("default config dir uses ~/.config on Linux", () => {
  const configDir = getDefaultConfigDir({
    platform: "linux",
    homeDir: "/home/alice",
    env: {},
  });

  assert.equal(configDir, path.posix.join("/home/alice", ".config", "google-tool"));
});

test("default config dir ignores XDG_CONFIG_HOME and stays under ~/.config", () => {
  const configDir = getDefaultConfigDir({
    platform: "linux",
    homeDir: "/home/alice",
    env: { XDG_CONFIG_HOME: "/tmp/config-home" },
  });

  assert.equal(configDir, path.posix.join("/home/alice", ".config", "google-tool"));
});

test("default config dir uses a profile subdirectory when GOOGLE_TOOL_PROFILE is set", () => {
  const configDir = getDefaultConfigDir({
    platform: "linux",
    homeDir: "/home/alice",
    env: { GOOGLE_TOOL_PROFILE: "work@example.com" },
  });

  assert.equal(
    configDir,
    path.posix.join(
      "/home/alice",
      ".config",
      "google-tool",
      "profiles",
      "work@example.com",
    ),
  );
});

test("blank GOOGLE_TOOL_PROFILE falls back to the shared config dir", () => {
  const configDir = getDefaultConfigDir({
    platform: "linux",
    homeDir: "/home/alice",
    env: { GOOGLE_TOOL_PROFILE: "   " },
  });

  assert.equal(configDir, path.posix.join("/home/alice", ".config", "google-tool"));
});

test("invalid GOOGLE_TOOL_PROFILE values are rejected", () => {
  assert.throws(
    () =>
      getDefaultConfigDir({
        platform: "linux",
        homeDir: "/home/alice",
        env: { GOOGLE_TOOL_PROFILE: "../work" },
      }),
    /Invalid GOOGLE_TOOL_PROFILE value/u,
  );
});

test("explicit profile name overrides GOOGLE_TOOL_PROFILE", () => {
  assert.equal(
    resolveProfileName({
      env: { GOOGLE_TOOL_PROFILE: "personal" },
      profileName: "work",
    }),
    "work",
  );
});

test("invalid explicit profile name is rejected as a cli option error", () => {
  assert.throws(
    () =>
      resolveProfileName({
        profileName: "../work",
      }),
    /Invalid --profile value/u,
  );
});

test("default credential paths are derived from the default config dir", () => {
  const paths = getDefaultCredentialPaths({
    platform: "darwin",
    homeDir: "/Users/alice",
    env: {},
  });

  assert.deepEqual(paths, {
    configDir: "/Users/alice/.config/google-tool",
    credentialsPath: "/Users/alice/.config/google-tool/credentials.json",
    tokenPath: "/Users/alice/.config/google-tool/token.json",
  });
});

test("default credential paths use the profiled config dir when configured", () => {
  const paths = getDefaultCredentialPaths({
    platform: "linux",
    homeDir: "/home/alice",
    env: { GOOGLE_TOOL_PROFILE: "personal" },
  });

  assert.deepEqual(paths, {
    configDir: "/home/alice/.config/google-tool/profiles/personal",
    credentialsPath: "/home/alice/.config/google-tool/profiles/personal/credentials.json",
    tokenPath: "/home/alice/.config/google-tool/profiles/personal/token.json",
  });
});

test("shared credential paths stay on the common config dir even when profiled", () => {
  const paths = getSharedCredentialPaths({
    platform: "linux",
    homeDir: "/home/alice",
    env: { GOOGLE_TOOL_PROFILE: "personal" },
  });

  assert.deepEqual(paths, {
    configDir: "/home/alice/.config/google-tool",
    credentialsPath: "/home/alice/.config/google-tool/credentials.json",
    tokenPath: "/home/alice/.config/google-tool/token.json",
  });
});

test("environment variables override both configured paths", () => {
  const paths = resolveConfiguredPaths({
    platform: "linux",
    homeDir: "/home/alice",
    env: {
      GOOGLE_TOOL_CREDENTIALS: "/secure/credentials.json",
      GOOGLE_TOOL_TOKEN: "/secure/token.json",
    },
  });

  assert.equal(paths.credentialsPath, "/secure/credentials.json");
  assert.equal(paths.tokenPath, "/secure/token.json");
  assert.equal(paths.configDir, "/home/alice/.config/google-tool");
});

test("profiled configured paths keep explicit path overrides", () => {
  const paths = resolveConfiguredPaths({
    platform: "linux",
    homeDir: "/home/alice",
    env: {
      GOOGLE_TOOL_PROFILE: "work",
      GOOGLE_TOOL_TOKEN: "/secure/token.json",
    },
  });

  assert.equal(paths.configDir, "/home/alice/.config/google-tool/profiles/work");
  assert.equal(
    paths.credentialsPath,
    "/home/alice/.config/google-tool/profiles/work/credentials.json",
  );
  assert.equal(paths.tokenPath, "/secure/token.json");
});

test("shared credential fallback is enabled only for profiled default credentials", () => {
  assert.equal(
    shouldUseSharedCredentialFallback({
      env: { GOOGLE_TOOL_PROFILE: "work" },
    }),
    true,
  );
  assert.equal(
    shouldUseSharedCredentialFallback({
      env: {
        GOOGLE_TOOL_PROFILE: "work",
        GOOGLE_TOOL_CREDENTIALS: "/secure/credentials.json",
      },
    }),
    false,
  );
  assert.equal(
    shouldUseSharedCredentialFallback({
      env: {},
    }),
    false,
  );
});

test("partial environment override fills the missing side with the default path", () => {
  const paths = resolveConfiguredPaths({
    platform: "linux",
    homeDir: "/home/alice",
    env: {
      GOOGLE_TOOL_TOKEN: "/secure/token.json",
    },
  });

  assert.equal(paths.credentialsPath, "/home/alice/.config/google-tool/credentials.json");
  assert.equal(paths.tokenPath, "/secure/token.json");
});

test("configured paths keep the shared XDG config dir on macOS", () => {
  const paths = resolveConfiguredPaths({
    platform: "darwin",
    homeDir: "/Users/alice",
    env: {},
  });

  assert.equal(paths.configDir, "/Users/alice/.config/google-tool");
  assert.equal(paths.credentialsPath, "/Users/alice/.config/google-tool/credentials.json");
  assert.equal(paths.tokenPath, "/Users/alice/.config/google-tool/token.json");
});

test("home directory fallback prefers context env over process env", () => {
  const configDir = getDefaultConfigDir({
    platform: "linux",
    env: { HOME: "/context-home" },
  });

  assert.equal(configDir, "/context-home/.config/google-tool");
});

test("configured paths keep the shared XDG config dir on Windows", () => {
  const paths = resolveConfiguredPaths({
    platform: "win32",
    homeDir: "C:\\Users\\alice",
    env: {
      APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
    },
  });

  assert.equal(paths.configDir, "C:\\Users\\alice\\.config\\google-tool");
  assert.equal(paths.credentialsPath, "C:\\Users\\alice\\.config\\google-tool\\credentials.json");
  assert.equal(paths.tokenPath, "C:\\Users\\alice\\.config\\google-tool\\token.json");
});
