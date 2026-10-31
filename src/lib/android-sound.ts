import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";

let generation = 0;
let allowed: (test: boolean, conversation?: number) => boolean = () => false;
const channelId = "relay-foreground-messages-v2";

export function bindAndroidSoundGate(
  gate: (test: boolean, conversation?: number) => boolean,
) {
  if (Platform.OS !== "android") return () => {};
  const ownGeneration = ++generation;
  allowed = gate;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => ({
      shouldPlaySound:
        AppState.currentState === "active" &&
        notification.request.content.data?.soundGeneration === generation &&
        allowed(
          notification.request.content.data?.soundTest === true,
          notification.request.content.data?.conversationId as
            number | undefined,
        ),
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    }),
  });
  return () => {
    if (generation === ownGeneration) {
      generation++;
      allowed = () => false;
      Notifications.setNotificationHandler(null);
    }
  };
}

/** Local foreground sound only. Never requests a push token or remote delivery. */
export async function androidMessageSound(
  interactive: boolean,
  conversationId?: number,
) {
  await Notifications.setNotificationChannelAsync(channelId, {
    name: "Foreground message sounds",
    // Expo re-exports this runtime enum from a *.types module.
    // eslint-disable-next-line import/namespace
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: false,
    bypassDnd: false,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && interactive)
    permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    if (interactive)
      throw new Error(
        "Enable Relay notifications in device Settings to allow message sounds.",
      );
    return;
  }
  if (
    !allowed(interactive, conversationId) ||
    AppState.currentState !== "active"
  )
    return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Relay",
      body: "New message",
      sound: "default",
      data: {
        soundGeneration: generation,
        soundTest: interactive,
        conversationId,
      },
    },
    trigger: { channelId },
  });
}
