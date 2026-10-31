import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MediaClock,
  CallNetwork,
  OutgoingIce,
} from "../src/lib/call-runtime.ts";

test("local timer starts from polled ICE connection even if an event was missed and freezes on cleanup", () => {
  const clock = new MediaClock();
  assert.equal(clock.observe("connecting", "checking", 1000), null);
  assert.equal(clock.seconds(4000), 0);
  assert.equal(clock.observe("connecting", "completed", 5000), 5000);
  assert.equal(clock.observe("connected", "connected", 9000), 5000);
  assert.equal(clock.seconds(12500), 7);
  clock.stop(14000);
  assert.equal(clock.seconds(50000), 9);
  clock.observe("connected", "connected", 55000);
  assert.equal(clock.seconds(60000), 9);
  assert.equal(new MediaClock().seconds(90000), 0);
});

test("network notices ignore healthy, repeated and unknown snapshots and clear on recovery", () => {
  const network = new CallNetwork();
  assert.equal(network.update({ isConnected: true }), null);
  assert.equal(
    network.update({ isConnected: true, isInternetReachable: true }),
    null,
  );
  assert.equal(network.update({}), null);
  assert.equal(network.update({ isConnected: false }), "offline");
  assert.equal(network.update({ isConnected: false }), null);
  assert.equal(network.update({}), null);
  assert.equal(
    network.update({ isConnected: true, isInternetReachable: false }),
    null,
  );
  assert.equal(
    network.update({ isConnected: true, isInternetReachable: true }),
    "restored",
  );
  assert.equal(network.update({ isConnected: true }), null);
});

test("ICE waits for SDP then uploads sequentially without overlapping requests", async () => {
  const sent = [],
    waiting = [];
  const sender = new OutgoingIce(
    async (value) => {
      sent.push(value);
      await new Promise((resolve) => waiting.push(resolve));
    },
    () => true,
    () => assert.fail(),
  );
  sender.add(1);
  sender.add(2);
  assert.deepEqual(sent, []);
  const done = sender.release();
  assert.deepEqual(sent, [1]);
  waiting.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(sent, [1, 2]);
  sender.add(3);
  waiting.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(sent, [1, 2, 3]);
  waiting.shift()();
  await done;
});

test("one failed candidate does not discard other connection routes", async () => {
  const sent = [],
    errors = [];
  const sender = new OutgoingIce(
    async (value) => {
      sent.push(value);
      if (value === 1) throw new Error("offline");
    },
    () => true,
    (error) => errors.push(error),
  );
  sender.add(1);
  sender.add(2);
  await sender.release();
  assert.deepEqual(sent, [1, 2]);
  assert.equal(errors.length, 1);
});

test("hang-up stops queued uploads and ignores an in-flight cancellation error", async () => {
  let reject;
  const sent = [];
  const sender = new OutgoingIce(
    (value) => {
      sent.push(value);
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    },
    () => true,
    () => assert.fail(),
  );
  sender.add(1);
  sender.add(2);
  const done = sender.release();
  sender.stop();
  reject(new Error("Aborted"));
  await done;
  sender.add(3);
  assert.deepEqual(sent, [1]);
});
