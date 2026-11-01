import test from "node:test";
import assert from "node:assert/strict";
import { NativeCallSetup } from "../src/lib/native-call-setup.ts";

test("Later does not reopen setup during repeated ringing updates", async () => {
  let initialized = 0,
    prompted = 0;
  const setup = new NativeCallSetup(
    async () => {
      initialized++;
    },
    async () => false,
    async () => {
      prompted++;
      throw new Error("Later");
    },
  );
  assert.equal(await setup.request(), false);
  for (let i = 0; i < 10; i++) assert.equal(await setup.ready(), false);
  assert.equal(prompted, 1);
  assert.equal(initialized, 1);
});

test("enabling the phone account in Settings is picked up without another prompt", async () => {
  let enabled = false;
  const setup = new NativeCallSetup(
    async () => {},
    async () => enabled,
    async () => assert.fail("Must not prompt automatically"),
  );
  assert.equal(await setup.ready(), false);
  enabled = true;
  assert.equal(await setup.ready(), true);
});

test("concurrent incoming events share registration and only explicit requests prompt", async () => {
  let initialized = 0,
    prompted = 0;
  const setup = new NativeCallSetup(
    async () => {
      initialized++;
    },
    async () => true,
    async () => {
      prompted++;
    },
  );
  assert.deepEqual(
    await Promise.all([setup.ready(), setup.ready(), setup.ready()]),
    [true, true, true],
  );
  assert.equal(initialized, 1);
  assert.equal(prompted, 0);
  assert.equal(await setup.request(), true);
  assert.equal(prompted, 1);
});
