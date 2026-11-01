import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CallNetworkState,
  CallSignaling,
  CallSignalingUnavailable,
} from "../src/lib/call-signaling.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("slow host delivery does not leave relay candidates behind other private addresses", async () => {
  const sent = [];
  let releaseHost;
  const sender = new CallSignaling(
    async (type, payload) => {
      sent.push([type, payload]);
      if (payload?.candidate?.includes("first"))
        await new Promise((resolve) => {
          releaseHost = resolve;
        });
    },
    () => true,
    () => assert.fail(),
  );
  const first = {
    candidate: "candidate:first 1 udp 1 192.0.2.1 1000 typ host",
  };
  const second = {
    candidate: "candidate:second 1 udp 1 192.0.2.2 1001 typ host",
  };
  const relay = {
    candidate: "candidate:relay 1 udp 1 192.0.2.3 1002 typ relay",
  };
  sender.candidate(first);
  await sender.description("offer", { sdp: "v=0" });
  assert.equal(sender.busy, true);
  sender.candidate(second);
  sender.candidate(relay);
  releaseHost();
  await tick();
  assert.deepEqual(
    sent.map(([, payload]) => payload),
    [{ sdp: "v=0" }, first, relay, second],
  );
  assert.equal(sender.busy, false);
});

test("recovery sees SDP delivery as busy until it has completed", async () => {
  let finish;
  const sender = new CallSignaling(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => true,
    () => assert.fail(),
  );
  const delivery = sender.description("offer", { sdp: "v=0" });
  assert.equal(sender.busy, true);
  finish();
  await delivery;
  assert.equal(sender.busy, false);
  sender.beginDescription();
  assert.equal(sender.busy, true);
});

test("candidates embedded in SDP do not require separate HTTP requests", async () => {
  const sent = [];
  const sender = new CallSignaling(
    async (type, payload) => {
      sent.push([type, payload]);
    },
    () => true,
    () => assert.fail(),
  );
  const embedded = {
    candidate: "candidate:early 1 udp 1 192.0.2.1 1000 typ host",
  };
  const late = { candidate: "candidate:late 1 udp 1 192.0.2.2 1001 typ relay" };
  sender.candidate(embedded);
  const offer = { sdp: `v=0\r\na=${embedded.candidate}\r\n` };
  await sender.description("offer", offer);
  sender.candidate(late);
  await tick();
  assert.deepEqual(sent, [
    ["offer", offer],
    ["ice", late],
  ]);
});

test("restart candidates wait for the replacement SDP", async () => {
  const sent = [];
  const sender = new CallSignaling(
    async (type, payload) => {
      sent.push([type, payload]);
    },
    () => true,
    () => assert.fail(),
  );
  await sender.description("offer", "original");
  sender.beginDescription();
  sender.candidate("restart-candidate");
  await tick();
  assert.deepEqual(sent, [["offer", "original"]]);
  await sender.description("offer", "restart");
  await tick();
  assert.deepEqual(sent, [
    ["offer", "original"],
    ["offer", "restart"],
    ["ice", "restart-candidate"],
  ]);
});

test("ICE waits for SDP and candidate requests never overlap", async () => {
  const sent = [];
  let active = 0,
    maximum = 0;
  const sender = new CallSignaling(
    async (type, payload) => {
      active++;
      maximum = Math.max(maximum, active);
      await tick();
      sent.push([type, payload]);
      active--;
    },
    () => true,
    () => assert.fail("Unexpected failure"),
  );
  sender.candidate("first");
  sender.candidate("second");
  await tick();
  assert.deepEqual(sent, []);
  await sender.description("offer", "sdp");
  await tick();
  await tick();
  assert.deepEqual(sent, [
    ["offer", "sdp"],
    ["ice", "first"],
    ["ice", "second"],
  ]);
  assert.equal(maximum, 1);
});

test("temporary signal failures retry, authorization failures do not", async () => {
  let attempts = 0;
  const sender = new CallSignaling(
    async () => {
      if (++attempts < 3) throw new TypeError("Network request failed");
    },
    () => true,
    () => {},
    async () => {},
  );
  await sender.description("offer", {});
  assert.equal(attempts, 3);
  attempts = 0;
  const forbidden = new CallSignaling(
    async () => {
      attempts++;
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    },
    () => true,
    () => {},
    async () => {},
  );
  await assert.rejects(forbidden.description("offer", {}), /Forbidden/);
  assert.equal(attempts, 1);
});

test("exhausted transient failures request recovery and leave ICE gated", async () => {
  const sent = [];
  const sender = new CallSignaling(
    async (type) => {
      sent.push(type);
      throw Object.assign(new Error("Unavailable"), { status: 503 });
    },
    () => true,
    () => assert.fail(),
    async () => {},
  );
  sender.candidate({});
  await assert.rejects(
    sender.description("offer", {}),
    CallSignalingUnavailable,
  );
  assert.deepEqual(sent, ["offer", "offer", "offer"]);
});

test("hang-up cancels queued candidates and retries", async () => {
  let valid = true,
    attempts = 0;
  const sender = new CallSignaling(
    async () => {
      attempts++;
      throw new TypeError("Offline");
    },
    () => valid,
    () => assert.fail(),
    async () => {
      valid = false;
    },
  );
  sender.candidate({});
  await sender.description("offer", {});
  await tick();
  assert.equal(attempts, 1);
});

test("initial and repeated network events are not changes; offline and switches are", () => {
  const state = new CallNetworkState();
  const wifi = { type: "WIFI", isConnected: true, isInternetReachable: true };
  assert.deepEqual(state.update(wifi), { changed: false, online: true });
  assert.deepEqual(state.update(wifi), { changed: false, online: true });
  assert.deepEqual(state.update({ ...wifi, isInternetReachable: false }), {
    changed: true,
    online: false,
  });
  assert.deepEqual(state.update({ type: "CELLULAR", isConnected: true }), {
    changed: true,
    online: true,
  });
});
