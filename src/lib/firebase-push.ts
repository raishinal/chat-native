/* eslint-disable @typescript-eslint/no-require-imports */
// Firebase creates its native event emitter at import time. Load it only in
// configured native builds so existing development clients can still start.
export function firebasePush() {
  const { getApp } =
    require("@react-native-firebase/app") as typeof import("@react-native-firebase/app");
  const messaging =
    require("@react-native-firebase/messaging") as typeof import("@react-native-firebase/messaging");
  return { ...messaging, instance: messaging.getMessaging(getApp()) };
}
