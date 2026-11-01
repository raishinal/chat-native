import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireCallResources } from "../src/lib/core.ts";
import { gatherEarlyIce } from "../src/lib/call-ice.ts";

test("TURN gathering can finish after the former 400ms cutoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let listener;
  let finished = false;
  const peer = {
    iceGatheringState: "gathering",
    addEventListener(_, fn) {
      listener = fn;
    },
    removeEventListener() {},
  };
  const gathering = gatherEarlyIce(peer).then(() => {
    finished = true;
  });
  t.mock.timers.tick(800);
  await Promise.resolve();
  assert.equal(finished, false);
  peer.iceGatheringState = "complete";
  listener();
  await gathering;
  assert.equal(finished, true);
});

test("microphone preparation starts without waiting for relay credentials", async () => {
  let resolvePeer,
    mediaStarted = false;
  const pc = {
    close() {
      assert.fail();
    },
  };
  const media = { getTracks: () => [] };
  const task = acquireCallResources(
    () =>
      new Promise((resolve) => {
        resolvePeer = resolve;
      }),
    async () => {
      mediaStarted = true;
      return media;
    },
    () => true,
  );
  assert.equal(mediaStarted, true);
  resolvePeer(pc);
  assert.deepEqual(await task, { pc, media });
});

test("peer failure releases acquired microphone tracks and stream", async () => {
  const released = [];
  await assert.rejects(
    acquireCallResources(
      async () => {
        throw new Error("ICE unavailable");
      },
      async () => ({
        getTracks: () => [{ stop: () => released.push("track") }],
        release: () => released.push("stream"),
      }),
      () => true,
    ),
    /ICE unavailable/,
  );
  assert.deepEqual(released, ["track", "stream"]);
});

test("hang-up during preparation releases both late resources", async () => {
  const released = [];
  await assert.rejects(
    acquireCallResources(
      async () => ({ close: () => released.push("peer") }),
      async () => ({
        getTracks: () => [{ stop: () => released.push("track") }],
      }),
      () => false,
    ),
    /cancelled/,
  );
  assert.deepEqual(released, ["peer", "track"]);
});

test("early ICE wait finishes on gathering completion and removes its listener", async () => {
  let listener,
    removed = false;
  const peer = {
    iceGatheringState: "gathering",
    addEventListener(_, fn) {
      listener = fn;
    },
    removeEventListener(_, fn) {
      assert.equal(fn, listener);
      removed = true;
    },
  };
  const task = gatherEarlyIce(peer);
  peer.iceGatheringState = "complete";
  listener();
  await task;
  assert.equal(removed, true);
});

test("hang-up cancels the early ICE wait", async () => {
  const controller = new AbortController();
  let removed = false;
  const task = gatherEarlyIce(
    {
      iceGatheringState: "gathering",
      addEventListener() {},
      removeEventListener() {
        removed = true;
      },
    },
    controller.signal,
  );
  controller.abort();
  await task;
  assert.equal(removed, true);
});
