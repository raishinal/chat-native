import { test } from "node:test";
import assert from "node:assert/strict";
import { CallStateSync } from "../src/lib/call-state-sync.ts";

test("polling delivers a missed acceptance and terminal update for the current call", async () => {
  const sync = new CallStateSync();
  const received = [];
  for (const status of ["accepted", "ended"]) {
    const snapshot = { id: 7, status };
    await sync.refresh(
      7,
      async () => [{ id: 8 }, snapshot],
      () => true,
      (c) => received.push(c.status),
    );
  }
  assert.deepEqual(received, ["accepted", "ended"]);
});

test("a response after hang-up or account change cannot revive the call", async () => {
  const sync = new CallStateSync();
  let finish;
  let valid = true;
  const task = sync.refresh(
    7,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => valid,
    () => assert.fail("Stale call applied"),
  );
  valid = false;
  finish([{ id: 7, status: "accepted" }]);
  await task;
});

test("slow polls do not overlap and failures allow the next attempt", async () => {
  const sync = new CallStateSync();
  let finish;
  const first = sync.refresh(
    7,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => true,
    () => {},
  );
  await sync.refresh(
    7,
    () => assert.fail("Overlapping request"),
    () => true,
    () => {},
  );
  finish([]);
  await first;
  await assert.rejects(
    sync.refresh(
      7,
      async () => {
        throw new Error("Offline");
      },
      () => true,
      () => {},
    ),
    /Offline/,
  );
  let recovered = false;
  await sync.refresh(
    7,
    async () => [{ id: 7 }],
    () => true,
    () => {
      recovered = true;
    },
  );
  assert.equal(recovered, true);
});
