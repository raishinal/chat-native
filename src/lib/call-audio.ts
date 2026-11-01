import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import {
  parseAndroidCallRoutes,
  type CallAudioRoute,
} from "./call-audio-routes";

function iosRoutes() {
  if (!NativeModules.RNCallKeep)
    throw new Error("Update the app to select Bluetooth call audio.");
  // Audio routing is also available when native push notifications are disabled.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("react-native-callkeep")
    .default as typeof import("react-native-callkeep").default;
}

export function watchIOSCallAudioRoutes(onChange: () => void) {
  if (Platform.OS !== "ios" || !NativeModules.RNCallKeep) return null;
  return iosRoutes().addEventListener("didChangeAudioRoute", onChange);
}

export async function getCallAudioRoutes(): Promise<CallAudioRoute[]> {
  if (Platform.OS === "android") {
    // An empty route queries state without changing the user's selection.
    return parseAndroidCallRoutes(await InCallManager.chooseAudioRoute(""));
  }
  if (Platform.OS === "ios") {
    return (await iosRoutes().getAudioRoutes()).map((route) => ({
      id: route.name,
      label: route.type === "Phone" ? "Phone" : route.name,
      kind:
        route.type === "Bluetooth"
          ? "bluetooth"
          : route.type === "Headset"
            ? "headset"
            : route.type === "Phone"
              ? "phone"
              : "speaker",
      selected: !!route.selected,
    }));
  }
  return [];
}

export async function selectCallAudioRoute(
  uuid: string,
  route: CallAudioRoute,
) {
  if (Platform.OS === "android") {
    return parseAndroidCallRoutes(
      await InCallManager.chooseAudioRoute(route.id),
    );
  }
  if (Platform.OS === "ios") {
    // Clear the speaker override before selecting the accessory microphone.
    InCallManager.setForceSpeakerphoneOn(route.kind === "speaker");
    await iosRoutes().setAudioRoute(uuid, route.id);
    return getCallAudioRoutes();
  }
  return [];
}

export async function requestCallBluetooth() {
  if (Platform.OS !== "android" || Number(Platform.Version) < 31) return;
  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (!(await PermissionsAndroid.check(permission))) {
    // Denial leaves the phone microphone available; Bluetooth is optional.
    await PermissionsAndroid.request(permission, {
      title: "Use earbuds for calls",
      message:
        "Allow Nearby devices so Relay can use your connected Bluetooth earbuds and their microphone.",
      buttonPositive: "Continue",
      buttonNegative: "Use phone audio",
    });
  }
}
