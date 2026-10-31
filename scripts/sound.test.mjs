import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSound } from "../src/lib/core.ts";
const state = {
  active: true,
  inCall: false,
  muted: false,
  focused: null,
  conversation: 2,
};
test("foreground sounds suppress focused conversations and muted settings", () => {
  assert.equal(shouldSound(state), true);
  assert.equal(shouldSound({ ...state, focused: 2 }), false);
  assert.equal(shouldSound({ ...state, muted: true }), false);
});
test("sound test bypasses app mute but never background or ongoing call audio", () => {
  assert.equal(shouldSound({ ...state, muted: true, test: true }), true);
  assert.equal(shouldSound({ ...state, active: false, test: true }), false);
  assert.equal(shouldSound({ ...state, inCall: true, test: true }), false);
});
