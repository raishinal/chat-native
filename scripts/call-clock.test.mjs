import { test } from "node:test";
import assert from "node:assert/strict";
import { callSeconds } from "../src/lib/core.ts";

test("timer waits for media then advances without a server timestamp and freezes when ended", () => {
  assert.equal(callSeconds(null, null, 12000), 0);
  assert.equal(callSeconds(10000, null, 12500), 2);
  assert.equal(callSeconds("1970-01-01T00:00:10.000Z", null, 15000), 5);
  assert.equal(callSeconds(10000, "1970-01-01T00:00:14.000Z", 90000), 4);
  assert.equal(callSeconds("invalid", null, 12000), 0);
  assert.equal(callSeconds(20000, null, 12000), 0);
});
