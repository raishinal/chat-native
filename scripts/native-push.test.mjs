import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  callUUID,
  callIdFromUUID,
  liveIncoming,
} from "../src/lib/push-contract.ts";
const require = createRequire(import.meta.url);
const {
  modifyAppDelegate,
  modifySceneDelegate,
  configureAndroidCallService,
} = require("../plugins/with-native-calls.js");

test("Android call service is created regardless of manifest plugin order", () => {
  const app = {};
  configureAndroidCallService(app);
  configureAndroidCallService(app);
  assert.equal(app.service.length, 1);
  assert.equal(
    app.service[0].$["android:foregroundServiceType"],
    "phoneCall|microphone",
  );
  assert.equal(
    app.service[0].$["android:permission"],
    "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
  );
  assert.equal(
    app.service[0]["intent-filter"][0].action[0].$["android:name"],
    "android.telecom.ConnectionService",
  );
});

test("native call UUIDs round trip and reject unrelated system calls", () => {
  for (const id of [1, 123, 4294967296])
    assert.equal(callIdFromUUID(callUUID(id)), id);
  assert.equal(callIdFromUUID("bad-id"), null);
  assert.equal(callIdFromUUID("ffffffff-ffff-4fff-8fff-000000000001"), null);
});

test("expired and ended pushes cannot create incoming calls", () => {
  const now = Date.now();
  const data = {
    status: "ringing",
    ended_at: "null",
    expires_at: new Date(now + 1000).toISOString(),
  };
  assert.equal(liveIncoming(data, now), true);
  assert.equal(liveIncoming(data, now + 2000), false);
  assert.equal(
    liveIncoming({ ...data, ended_at: new Date(now).toISOString() }, now),
    false,
  );
  assert.equal(liveIncoming({ ...data, status: "cancelled" }, now), false);
});

test("PushKit integration supports the installed SDK template and is idempotent", () => {
  const swift = execFileSync(
    "tar",
    [
      "-xOf",
      "node_modules/expo/template.tgz",
      "package/ios/HelloWorld/AppDelegate.swift",
    ],
    { encoding: "utf8" },
  );
  const modified = modifyAppDelegate(swift);
  assert.match(
    modified,
    /ExpoReactNativeFactoryProvider\s*, PKPushRegistryDelegate/,
  );
  assert.match(modified, /RNCallKeep.reportNewIncomingCall/);
  assert.ok(
    modified.indexOf("RNCallKeep.reportNewIncomingCall") <
      modified.indexOf("RNVoipPushNotificationManager.didReceiveIncomingPush"),
  );
  assert.equal(modifyAppDelegate(modified), modified);
  const scene = execFileSync(
    "tar",
    [
      "-xOf",
      "node_modules/expo/template.tgz",
      "package/ios/HelloWorld/SceneDelegate.swift",
    ],
    { encoding: "utf8" },
  );
  const modifiedScene = modifySceneDelegate(scene);
  assert.match(modifiedScene, /app.relayCallRootView = nil/);
  assert.equal(modifySceneDelegate(modifiedScene), modifiedScene);
});
