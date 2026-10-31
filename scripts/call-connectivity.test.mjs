import { test } from "node:test";
import assert from "node:assert/strict";
import { createCallPeerConnection } from "../src/lib/call-connectivity.ts";
const options = {
  apiOrigin: "https://chat.example.test",
  accessToken: "test-mobile-token",
};
const config = {
  ice_servers: [
    {
      urls: ["turns:turn.cloudflare.com:443?transport=tcp"],
      username: "temporary",
      credential: "temporary-secret",
    },
  ],
  expires_in: 3600,
  expires_at: new Date(Date.now() + 3600000).toISOString(),
};

test("ICE fetch network errors identify the backend without constructing a peer", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Network request failed");
  });
  await assert.rejects(
    createCallPeerConnection(options, () => assert.fail()),
    /Cannot reach the chat server.*chat.example.test/,
  );
});

test("native peer construction waits for authenticated Laravel ICE configuration", async (t) => {
  const order = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    order.push("fetch");
    assert.equal(url, "https://chat.example.test/api/v1/ice-servers");
    assert.equal(init.headers.Authorization, "Bearer test-mobile-token");
    await new Promise((resolve) => setImmediate(resolve));
    order.push("response");
    return new Response(JSON.stringify(config), { status: 200 });
  });
  const peer = await createCallPeerConnection(options, (configuration) => {
    order.push("peer");
    assert.deepEqual(configuration, { iceServers: config.ice_servers });
    return { connected: false };
  });
  assert.deepEqual(order, ["fetch", "response", "peer"]);
  assert.equal(peer.connected, false);
});

test("unauthorized or failed issuance never constructs a native peer", async (t) => {
  let constructed = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}", { status: 403 }),
  );
  await assert.rejects(
    createCallPeerConnection(options, () => {
      constructed = true;
    }),
    /cannot start calls/,
  );
  assert.equal(constructed, false);
});

test("expired credentials are rejected before peer construction", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({ ...config, expires_at: "2000-01-01T00:00:00Z" }),
        { status: 200 },
      ),
  );
  await assert.rejects(
    createCallPeerConnection(options, () =>
      assert.fail("Must not construct peer"),
    ),
    /Invalid call connectivity/,
  );
});

test("cancelled calls do not construct peers even if fetch completes", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return new Response(JSON.stringify(config), { status: 200 });
  });
  await assert.rejects(
    createCallPeerConnection({ ...options, signal: controller.signal }, () =>
      assert.fail("Must not construct peer"),
    ),
    /cancelled/,
  );
});
