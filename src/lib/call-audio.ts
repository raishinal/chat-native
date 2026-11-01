import { PermissionsAndroid, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";

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

export function setCallSpeaker(enabled: boolean) {
  // false explicitly selects phone/earpiece mode. null would restore automatic
  // routing, which defaults back to the loudspeaker for video calls.
  InCallManager.setForceSpeakerphoneOn(enabled);
}
