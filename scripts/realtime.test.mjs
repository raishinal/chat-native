import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(new URL("../src/lib/realtime.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function setup({
  configured = true,
  authorize = async () => ({ auth: "signed" }),
  init,
} = {}) {
  let callbacks;
  const operations = [];
  const pusher = {
    async init(options) {
      callbacks = options;
      await init?.();
    },
    async subscribe({ channelName }) {
      operations.push(["subscribe", channelName]);
    },
    async unsubscribe({ channelName }) {
      operations.push(["unsubscribe", channelName]);
    },
    async connect() {
      operations.push(["connect"]);
    },
    async disconnect() {},
    async reset() {},
  };
  const exports = {};
  runInNewContext(source, {
    exports,
    require: (name) =>
      name === "./api"
        ? { api: { request: authorize } }
        : { Pusher: { getInstance: () => pusher } },
    process: {
      env: configured
        ? { EXPO_PUBLIC_PUSHER_KEY: "key", EXPO_PUBLIC_PUSHER_CLUSTER: "ap1" }
        : {},
    },
    __DEV__: false,
    setTimeout,
  });
  const realtime = new exports.Realtime(
    () => {},
    () => {},
    () => {},
  );
  return { realtime, operations, callbacks: () => callbacks };
}

test("failed authorization returns to native code and retries the private channel", async () => {
  const { realtime, callbacks, operations } = setup({
    authorize: async () => {
      throw new Error("Server unavailable");
    },
  });
  await realtime.start(7);
  callbacks().onConnectionStateChange("CONNECTED");
  const result = await callbacks().onAuthorizer("private-v1.users.7", "socket");
  assert.equal(JSON.stringify(result), "{}");
  callbacks().onSubscriptionError("private-v1.users.7");
  operations.length = 0;
  await realtime.reconnect(7);
  assert.deepEqual(operations, [
    ["unsubscribe", "private-v1.users.7"],
    ["subscribe", "private-v1.users.7"],
  ]);
  callbacks().onSubscriptionSucceeded("private-v1.users.7");
  await realtime.readyForCalls();
  await realtime.stop();
});

test("conversation subscriptions and reconnect wait for initialization", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { realtime, operations } = setup({ init: () => gate });
  const starting = realtime.start(7);
  const conversations = realtime.conversations([42]);
  const reconnect = realtime.reconnect(7);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(operations, []);
  release();
  await Promise.all([starting, conversations, reconnect]);
  assert.ok(
    operations.some(
      ([operation, channel]) =>
        operation === "subscribe" && channel === "private-v1.conversations.42",
    ),
  );
  await realtime.stop();
});

test("a call reconnects the socket before waiting for readiness", async () => {
  const { realtime, callbacks, operations } = setup();
  await realtime.start(7);
  const ready = realtime.readyForCalls();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    operations.filter(([operation]) => operation === "connect").length,
    2,
  );
  callbacks().onConnectionStateChange("CONNECTED");
  callbacks().onSubscriptionSucceeded("private-v1.users.7");
  await ready;
  await realtime.stop();
});

test("missing build configuration fails immediately with an actionable error", async () => {
  const { realtime } = setup({ configured: false });
  await realtime.start(7);
  await assert.rejects(
    realtime.readyForCalls(),
    /Pusher configuration is missing/,
  );
  await realtime.stop();
});
