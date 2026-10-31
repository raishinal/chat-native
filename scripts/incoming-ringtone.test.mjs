import { test } from "node:test";
import assert from "node:assert/strict";
import { createIncomingRingtone } from "../src/lib/incoming-ringtone.ts";

test("incoming ringtone loops once per call and stops before another call starts", () => {
  const events = [];
  const alert = createIncomingRingtone({
    startRingtone: (...args) => events.push(["start", ...args]),
    stopRingtone: () => events.push(["stop"]),
  });
  alert.start(1, 45);
  alert.start(1, 40);
  assert.equal(events.length, 1);
  assert.equal(events[0][1], "_DEFAULT_");
  assert.deepEqual(events[0][2], [0, 700, 350, 700, 1400]);
  alert.start(2, 120);
  assert.deepEqual(events[1], ["stop"]);
  assert.equal(events[2].at(-1), 60);
  alert.stop();
  alert.stop();
  assert.equal(events.filter(([type]) => type === "stop").length, 2);
});
