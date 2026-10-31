import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, protectedUrl } from "../src/lib/transport.ts";

test("fetch failures identify the unreachable backend without expiring the session", async (t) => {
  const client = new Client("http://localhost:8000");
  client.token = "private-token";
  client.onExpired = () => assert.fail("Network failure is not session expiry");
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Network request failed");
  });
  await assert.rejects(
    client.request("calls/1/signal", "POST", {}),
    (error) => {
      assert.equal(error.status, 0);
      assert.match(error.message, /Cannot reach.*localhost:8000/);
      assert.doesNotMatch(error.message, /private-token/);
      return true;
    },
  );
});
test("bearer and JSON headers reach only the configured backend", async (t) => {
  const client = new Client("https://relay.example.test");
  client.token = "private-token";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://relay.example.test/api/v1/me");
    assert.equal(init.headers.Authorization, "Bearer private-token");
    assert.equal(init.headers.Accept, "application/json");
    return Response.json({ data: { id: 1 } });
  });
  assert.deepEqual(await client.request("me"), { data: { id: 1 } });
  assert.throws(
    () => protectedUrl("https://evil.example.test/attachment", client.origin),
    /Untrusted/,
  );
  assert.throws(
    () =>
      protectedUrl("https://user:secret@relay.example.test/a", client.origin),
    /Untrusted/,
  );
});
test("a 401 triggers session expiry, a membership 403 does not", async (t) => {
  const client = new Client("https://relay.example.test");
  client.token = "token";
  let expired = 0;
  client.onExpired = () => expired++;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ message: "Expired" }, { status: 401 }),
  );
  await assert.rejects(client.request("me"), /Expired/);
  assert.equal(expired, 1);
  globalThis.fetch = async () =>
    Response.json({ message: "Forbidden" }, { status: 403 });
  await assert.rejects(client.request("admin/users"), /Forbidden/);
  assert.equal(expired, 1);
});
test("old account requests cannot update a new account or expire its token", async (t) => {
  const client = new Client("https://relay.example.test");
  client.token = "old-token";
  let resolve;
  const waiting = new Promise((r) => {
    resolve = r;
  });
  let expired = false;
  client.onExpired = () => {
    expired = true;
  };
  t.mock.method(globalThis, "fetch", () => waiting);
  const request = client.request("conversations");
  client.token = "new-token";
  resolve(Response.json({ data: [{ id: 123 }] }));
  await assert.rejects(request, /Session changed/);
  assert.equal(client.token, "new-token");
  assert.equal(expired, false);
});
test("cancelling a request propagates to its transport", async (t) => {
  const client = new Client("https://relay.example.test"),
    controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("Aborted")),
        );
      }),
  );
  const task = client.request("me", "GET", undefined, controller.signal);
  controller.abort();
  await assert.rejects(task, /Aborted/);
});
