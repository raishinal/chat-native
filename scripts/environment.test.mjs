import { test } from "node:test";
import assert from "node:assert/strict";
import environment from "./environment.cjs";
import { sessionStorageKey } from "../src/lib/session-key.ts";
const { resolveEnvironment, buildProfile } = environment;
const hosted = "https://chat.roshanlama.com.np";
test("local Android and iOS use their host-machine addresses without editing files", () => {
  assert.equal(
    resolveEnvironment("local").EXPO_PUBLIC_API_ORIGIN,
    "http://localhost:8000",
  );
  assert.equal(
    resolveEnvironment("local", { platform: "ios" }).EXPO_PUBLIC_API_ORIGIN,
    "http://localhost:8000",
  );
});
test("hosted profiles inherit the configured domain and never inherit the legacy local API origin", () => {
  for (const name of ["development", "staging", "preview", "production"])
    assert.equal(
      resolveEnvironment(name, {
        common: { EXPO_PUBLIC_API_ORIGIN: "http://10.0.2.2:8000" },
      }).EXPO_PUBLIC_API_ORIGIN,
      hosted,
    );
  assert.equal(buildProfile("staging").environment, "preview");
  assert.equal(buildProfile("staging").developmentClient, false);
  assert.equal(buildProfile("production").environment, "production");
  assert.equal(buildProfile("preview").developmentClient, false);
});
test("selected files and explicit shell overrides win without changing NODE_ENV", () => {
  const options = {
    common: {
      EXPO_PUBLIC_PUSHER_KEY: "shared",
      EXPO_PUBLIC_PUSHER_CLUSTER: "ap2",
    },
    selected: {
      EXPO_PUBLIC_API_ORIGIN: "https://staging.example.test/",
      EXPO_PUBLIC_PUSHER_KEY: "selected",
    },
    inherited: { NODE_ENV: "production" },
  };
  const result = resolveEnvironment("staging", options);
  assert.equal(result.EXPO_PUBLIC_API_ORIGIN, "https://staging.example.test");
  assert.equal(result.EXPO_PUBLIC_PUSHER_KEY, "selected");
  assert.equal(result.EXPO_PUBLIC_PUSHER_CLUSTER, "ap2");
  assert.equal(result.NODE_ENV, "production");
  assert.equal(result.EXPO_NO_DOTENV, "1");
  assert.equal(
    resolveEnvironment("staging", {
      ...options,
      inherited: { EXPO_PUBLIC_API_ORIGIN: "https://override.example.test" },
    }).EXPO_PUBLIC_API_ORIGIN,
    "https://override.example.test",
  );
});
test("dotenv files cannot inject backend secrets into the Expo child process", () => {
  const result = resolveEnvironment("local", {
    common: {
      PUSHER_APP_SECRET: "private",
      CLOUDFLARE_TURN_API_TOKEN: "private",
      EXPO_PUBLIC_PUSHER_KEY: "public",
    },
    selected: { BEARER_TOKEN: "private", NODE_ENV: "unexpected" },
  });
  assert.equal(result.PUSHER_APP_SECRET, undefined);
  assert.equal(result.CLOUDFLARE_TURN_API_TOKEN, undefined);
  assert.equal(result.BEARER_TOKEN, undefined);
  assert.equal(result.NODE_ENV, undefined);
  assert.equal(result.EXPO_PUBLIC_PUSHER_KEY, "public");
});
test("unknown targets, paths, embedded credentials and insecure hosted URLs fail before startup", () => {
  assert.throws(() => resolveEnvironment("unknown"), /Unknown/);
  for (const origin of [
    "http://10.0.2.2:8000",
    "https://localhost",
    "https://user:password@example.test",
    "https://example.test/api/v1",
    "https://example.test?token=secret",
  ])
    assert.throws(() =>
      resolveEnvironment("staging", {
        selected: { EXPO_PUBLIC_API_ORIGIN: origin },
      }),
    );
});
test("tokens are isolated per backend while equivalent origins share the same storage key", () => {
  assert.notEqual(
    sessionStorageKey("http://10.0.2.2:8000"),
    sessionStorageKey(hosted),
  );
  assert.notEqual(
    sessionStorageKey("http://localhost:8000"),
    sessionStorageKey("http://localhost:8001"),
  );
  assert.equal(sessionStorageKey(`${hosted}/`), sessionStorageKey(hosted));
  assert.match(sessionStorageKey(hosted), /^[\w.-]+$/);
});
