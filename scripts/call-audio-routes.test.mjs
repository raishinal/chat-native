import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAndroidCallRoutes } from "../src/lib/call-audio-routes.ts";

test("Bluetooth is available separately from phone and speaker and reports the active route", () => {
  const routes = parseAndroidCallRoutes({
    availableAudioDeviceList: '["SPEAKER_PHONE","EARPIECE","BLUETOOTH"]',
    selectedAudioDevice: "BLUETOOTH",
  });
  assert.equal(routes.length, 3);
  assert.equal(routes.find((route) => route.selected)?.kind, "bluetooth");
  assert.equal(routes.find((route) => route.kind === "phone")?.selected, false);
});

test("disconnecting earbuds removes their route and reflects the phone fallback", () => {
  const routes = parseAndroidCallRoutes({
    availableAudioDeviceList: '["EARPIECE","SPEAKER_PHONE"]',
    selectedAudioDevice: "EARPIECE",
  });
  assert.equal(
    routes.some((route) => route.kind === "bluetooth"),
    false,
  );
  assert.equal(routes.find((route) => route.selected)?.kind, "phone");
});

test("wired headsets are selectable and malformed native payloads are safe", () => {
  assert.equal(
    parseAndroidCallRoutes({
      availableAudioDeviceList: ["WIRED_HEADSET", "NONE"],
      selectedAudioDevice: "WIRED_HEADSET",
    })[0]?.kind,
    "headset",
  );
  for (const value of [undefined, "invalid", "null", "{}", 3]) {
    assert.deepEqual(
      parseAndroidCallRoutes({ availableAudioDeviceList: value }),
      [],
    );
  }
});
