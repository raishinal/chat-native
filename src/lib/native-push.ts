import { AppState, NativeModules, Platform } from "react-native";
import type CallKeepType from "react-native-callkeep";
import type VoipPushType from "react-native-voip-push-notification";
import { NativeCallSetup } from "./native-call-setup";
import { callTimeout } from "./call-timer";
import { firebasePush } from "./firebase-push";
import { RTCAudioSession } from "react-native-webrtc";
import { api, tokenStorage } from "./api";
import { callIdFromUUID, callUUID, liveIncoming } from "./push-contract";

export const pushEnabled =
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === "true" &&
  Platform.OS !== "web";
export const nativeCallsAvailable = pushEnabled && !!NativeModules.RNCallKeep;
// Lazy imports preserve existing development builds that lack these native modules.
export const CallKeep: typeof CallKeepType = nativeCallsAvailable
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-callkeep").default
  : null;
export const VoipPush: typeof VoipPushType =
  pushEnabled &&
  Platform.OS === "ios" &&
  NativeModules.RNVoipPushNotificationManager
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react-native-voip-push-notification").default
    : null;
export type NativeCallAction = {
  id: number;
  action: "answer" | "end" | "refresh" | "mute";
  muted?: boolean;
};
let listener: ((event: NativeCallAction) => Promise<void>) | undefined;
const pending: NativeCallAction[] = [];
const closed = new Set<number>();
const answered = new Set<number>();
const displayed = new Set<number>();
const expiryTimers = new Map<number, () => void>();

const nativeCallOptions: Parameters<typeof CallKeep.setup>[0] = {
  ios: {
    appName: "Relay",
    supportsVideo: true,
    maximumCallGroups: "1",
    maximumCallsPerCallGroup: "1",
    includesCallsInRecents: false,
  },
  android: {
    alertTitle: "Enable Relay calls",
    alertDescription:
      "Enable Relay in phone accounts to answer calls from your lock screen.",
    cancelButton: "Later",
    okButton: "Open settings",
    additionalPermissions: [],
    ...{ displayCallReachabilityTimeout: 30000 },
    foregroundService: {
      channelId: "relay-active-call",
      channelName: "Ongoing calls",
      notificationTitle: "Relay call in progress",
      notificationIcon: "ic_launcher",
    },
  },
};

// Setup dialogs are offered only by the explicit profile action.
const callSetup = new NativeCallSetup(
  async () => {
    if (Platform.OS === "android") {
      CallKeep.registerPhoneAccount(nativeCallOptions);
      CallKeep.registerAndroidEvents();
      CallKeep.setAvailable(true);
      CallKeep.canMakeMultipleCalls(false);
    } else {
      await CallKeep.setup(nativeCallOptions);
    }
  },
  async () =>
    Platform.OS === "android" ? CallKeep.checkPhoneAccountEnabled() : true,
  async () => CallKeep.setup(nativeCallOptions),
);

export function setupNativeCalls() {
  return nativeCallsAvailable ? callSetup.ready() : Promise.resolve(false);
}

export function requestNativeCallSetup() {
  return nativeCallsAvailable ? callSetup.request() : Promise.resolve(false);
}

function deliver(event: NativeCallAction) {
  if (event.action === "answer" && Platform.OS === "android")
    CallKeep.backToForeground();
  if (listener) void listener(event).catch(() => endNativeCall(event.id));
  else {
    pending.push(event);

    if (event.action === "end") {
      // A decline must work even when no React screen has mounted.
      void (async () => {
        const token = await tokenStorage.read();
        if (!token) return;
        const { Client } = await import("./transport");
        const client = new Client(api.origin);
        client.token = token;
        await client.request(`calls/${event.id}`, "PATCH", { action: "end" });
      })().catch(() => {});
    }
  }
}

export function bindNativeCallActions(
  handler: (event: NativeCallAction) => Promise<void>,
) {
  listener = handler;
  for (const event of pending.splice(0)) deliver(event);
  if (nativeCallsAvailable) CallKeep.setReachable();
  return () => {
    if (listener === handler) listener = undefined;
  };
}

export function markNativeAnswered(id: number) {
  displayed.add(id);
  answered.add(id);
  expiryTimers.get(id)?.();
}
export function nativeCallIsTracked(id: number) {
  return displayed.has(id);
}
export function endNativeCall(id: number) {
  if (!nativeCallsAvailable) return;
  closed.add(id);
  if (closed.size > 200) closed.delete(closed.values().next().value!);
  answered.delete(id);
  displayed.delete(id);
  expiryTimers.get(id)?.();
  expiryTimers.delete(id);
  CallKeep.reportEndCallWithUUID(callUUID(id), 2);
}

export async function showNativeCall(
  id: number,
  name: string,
  video: boolean,
  expiresAt: string,
  alreadyDisplayed = false,
) {
  if (!nativeCallsAvailable || Date.parse(expiresAt) <= Date.now()) {
    endNativeCall(id);
    return;
  }
  if (displayed.has(id)) return true;
  if (closed.has(id)) return false;
  if (!(await setupNativeCalls())) return;
  if (displayed.has(id)) return true;
  if (closed.has(id)) return false;
  if (Date.parse(expiresAt) <= Date.now()) {
    endNativeCall(id);
    return false;
  }
  displayed.add(id);
  if (!alreadyDisplayed)
    CallKeep.displayIncomingCall(
      callUUID(id),
      String(id),
      name,
      "generic",
      video,
    );
  expiryTimers.set(
    id,
    callTimeout(
      () => endNativeCall(id),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    ),
  );
  return true;
}

async function receivePush(
  data?: Record<string, string | object>,
  voip = false,
) {
  if (!data || (!voip && data.type !== "call")) return;
  const id = Number(data.call_id);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  if (closed.has(id)) return;
  if (liveIncoming(data)) {
    if (Platform.OS === "android" || voip)
      await showNativeCall(
        id,
        String(data.caller_name || "Relay"),
        data.kind === "video",
        String(data.expires_at),
        voip,
      );
  } else if (
    !["connected", "accepted"].includes(String(data.status)) ||
    !answered.has(id)
  )
    endNativeCall(id);
  deliver({ id, action: "refresh" });
}

if (nativeCallsAvailable) {
  CallKeep.addEventListener("didLoadWithEvents", (events) => {
    for (const event of events) {
      if (event.name === "RNCallKeepDidActivateAudioSession") {
        RTCAudioSession.audioSessionDidActivate();
        continue;
      }
      if (event.name === "RNCallKeepDidDeactivateAudioSession") {
        RTCAudioSession.audioSessionDidDeactivate();
        continue;
      }
      if (event.name === "RNCallKeepDidPerformSetMutedCallAction") {
        const data = event.data as { callUUID: string; muted: boolean };
        const id = callIdFromUUID(data.callUUID);
        if (id) deliver({ id, action: "mute", muted: data.muted });
        continue;
      }
      if (
        event.name !== "RNCallKeepPerformAnswerCallAction" &&
        event.name !== "RNCallKeepPerformEndCallAction"
      )
        continue;
      const id = callIdFromUUID((event.data as { callUUID: string }).callUUID);
      if (id) {
        if (event.name === "RNCallKeepPerformAnswerCallAction")
          markNativeAnswered(id);
        deliver({
          id,
          action:
            event.name === "RNCallKeepPerformAnswerCallAction"
              ? "answer"
              : "end",
        });
      }
    }
    CallKeep.clearInitialEvents();
  });
  CallKeep.addEventListener("didActivateAudioSession", () =>
    RTCAudioSession.audioSessionDidActivate(),
  );
  CallKeep.addEventListener("didDeactivateAudioSession", () =>
    RTCAudioSession.audioSessionDidDeactivate(),
  );
  CallKeep.addEventListener("answerCall", ({ callUUID: uuid }) => {
    const id = callIdFromUUID(uuid);
    if (id) {
      markNativeAnswered(id);
      deliver({ id, action: "answer" });
    }
  });
  CallKeep.addEventListener("endCall", ({ callUUID: uuid }) => {
    const id = callIdFromUUID(uuid);
    if (id) deliver({ id, action: "end" });
  });
  CallKeep.addEventListener(
    "didPerformSetMutedCallAction",
    ({ callUUID: uuid, muted }) => {
      const id = callIdFromUUID(uuid);
      if (id) deliver({ id, action: "mute", muted });
    },
  );
  if (Platform.OS === "ios" && VoipPush) {
    VoipPush.addEventListener("notification", (data) => {
      void receivePush(data as Record<string, string>, true);
    });
    VoipPush.addEventListener("didLoadWithEvents", (events) => {
      for (const event of events)
        if (event.name === "RNVoipPushRemoteNotificationReceivedEvent")
          void receivePush(event.data as Record<string, string>, true);
    });
  }
}
if (pushEnabled) {
  try {
    const {
      instance: messaging,
      setBackgroundMessageHandler,
      onMessage,
    } = firebasePush();
    setBackgroundMessageHandler(messaging, async (message) => {
      await receivePush(message.data);
    });
    onMessage(messaging, async (message) => {
      if (AppState.currentState !== "active" || message.data?.type === "call")
        await receivePush(message.data);
    });
  } catch {
    /* Unconfigured builds retain foreground chat and calls. */
  }
}
