const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const eas = require("../eas.json");

function buildProfile(name, visited = new Set()) {
  const current = eas.build[name];
  if (!current || visited.has(name))
    throw new Error(`Unknown or cyclic environment: ${name}`);
  visited.add(name);
  const parent = current.extends ? buildProfile(current.extends, visited) : {};
  return {
    ...parent,
    ...current,
    env: { ...parent.env, ...current.env },
    ios: {
      ...parent.ios,
      ...current.ios,
      env: { ...parent.ios?.env, ...current.ios?.env },
    },
    android: {
      ...parent.android,
      ...current.android,
      env: { ...parent.android?.env, ...current.android?.env },
    },
  };
}

function resolveEnvironment(
  name,
  { platform = "android", inherited = {}, common = {}, selected = {} } = {},
) {
  const profile = buildProfile(name);
  const defaults = { ...profile.env, ...profile[platform]?.env };
  // Legacy .env supplies shared public Pusher values. Its API address is local-only.
  const rawOrigin =
    inherited.EXPO_PUBLIC_API_ORIGIN ||
    selected.EXPO_PUBLIC_API_ORIGIN ||
    (name === "local" && common.EXPO_PUBLIC_API_ORIGIN) ||
    defaults.EXPO_PUBLIC_API_ORIGIN;
  const url = new URL(rawOrigin);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error(
      "API origin must be an HTTP(S) origin without credentials, a path, query or fragment.",
    );
  if (
    name !== "local" &&
    (url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "10.0.2.2"].includes(
        url.hostname,
      ))
  )
    throw new Error(
      "Hosted environments require an HTTPS backend and cannot use the emulator/loopback address.",
    );
  const result = {
    ...inherited,
    APP_ENV: defaults.APP_ENV,
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_API_ORIGIN: url.origin,
  };
  for (const key of [
    "EXPO_PUBLIC_PUSHER_KEY",
    "EXPO_PUBLIC_PUSHER_CLUSTER",
    "EXPO_PUBLIC_NATIVE_PUSH_ENABLED",
    "GOOGLE_SERVICES_JSON",
    "GOOGLE_SERVICES_PLIST",
  ])
    result[key] =
      inherited[key] || selected[key] || common[key] || defaults[key] || "";
  return result;
}

function readEnvironmentFile(file) {
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
}
function loadEnvironment(
  name,
  {
    root = path.resolve(__dirname, ".."),
    platform,
    inherited = process.env,
  } = {},
) {
  const file = name === "local" ? ".env.local" : `.env.${name}.local`;
  return resolveEnvironment(name, {
    platform,
    inherited,
    common: readEnvironmentFile(path.join(root, ".env")),
    selected: readEnvironmentFile(path.join(root, file)),
  });
}
module.exports = { buildProfile, resolveEnvironment, loadEnvironment };
