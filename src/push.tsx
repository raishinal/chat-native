import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { permissions } from "react-native-webrtc";
import { firebasePush } from "./lib/firebase-push";
import { useSession } from "./session";
import { api } from "./lib/api";
import { pushEnabled, setupNativeCalls, VoipPush } from "./lib/native-push";

export function PushRegistration() {
  const { user } = useSession();
  const userId = user?.id;
  useEffect(() => {
    if (!userId || !pushEnabled) return;
    let active = true;
    const sessionToken = api.token;
    const stop: (() => void)[] = [];
    let voipToken: string | undefined;
    let fcmToken: string | undefined;
    async function register() {
      let deviceId = await SecureStore.getItemAsync("relay-installation-id");
      if (!deviceId) {
        deviceId = randomUUID();
        await SecureStore.setItemAsync("relay-installation-id", deviceId);
      }
      if (!active || sessionToken !== api.token) return;
      await api.request("devices", "PUT", {
        device_id: deviceId,
        platform: Platform.OS,
        ...(fcmToken ? { push_token: fcmToken } : {}),
        ...(voipToken ? { voip_token: voipToken } : {}),
      });
    }
    function openConversation(data?: Record<string, unknown>) {
      if (!active || sessionToken !== api.token) return;
      const id = Number(data?.conversation_id);
      if (Number.isSafeInteger(id) && id > 0)
        router.push({
          pathname: "/conversation/[id]",
          params: { id: String(id) },
        });
    }
    async function initialize() {
      if (Platform.OS === "android")
        await Notifications.setNotificationChannelAsync("relay-messages", {
          name: "Messages",
          // eslint-disable-next-line import/namespace
          importance: Notifications.AndroidImportance.HIGH,
          sound: "message.wav",
        });
      await Notifications.requestPermissionsAsync();
      if (AppState.currentState === "active")
        await permissions.request({ name: "microphone" });
      await setupNativeCalls();
      const {
        instance: messaging,
        registerDeviceForRemoteMessages,
        getToken,
        onTokenRefresh,
        onNotificationOpenedApp,
        getInitialNotification,
      } = firebasePush();
      if (Platform.OS === "ios")
        await registerDeviceForRemoteMessages(messaging);
      fcmToken = await getToken(messaging);
      await register();
      if (!active) return;
      stop.push(
        onTokenRefresh(messaging, (token) => {
          fcmToken = token;
          void register().catch(() => {});
        }),
      );
      stop.push(
        onNotificationOpenedApp(messaging, (message) =>
          openConversation(message.data),
        ),
      );
      const initial = await getInitialNotification(messaging);
      if (initial) openConversation(initial.data);
      if (Platform.OS === "ios" && VoipPush) {
        VoipPush.addEventListener("register", (token) => {
          voipToken = token;
          void register().catch(() => {});
        });
        VoipPush.registerVoipToken();
        stop.push(() => VoipPush.removeEventListener("register"));
      }
    }
    void initialize().catch(() =>
      console.warn(
        "Relay push registration unavailable. Check native push setup.",
      ),
    );
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void register().catch(() => {});
    });
    return () => {
      active = false;
      app.remove();
      stop.forEach((unsubscribe) => unsubscribe());
    };
  }, [userId]);
  return null;
}
