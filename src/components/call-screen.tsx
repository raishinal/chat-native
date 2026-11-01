import { useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { SafeAreaView } from "react-native-safe-area-context";
import { RTCView, type MediaStream } from "react-native-webrtc";
import type { Call } from "@/lib/contracts";
import type { CallAudioRoute } from "@/lib/call-audio-routes";

type ControlProps = {
  icon: ComponentProps<typeof Feather>["name"];
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  tone?: "normal" | "accept" | "end";
  onPress(): void | Promise<unknown>;
};
function Control({
  icon,
  label,
  hint,
  active,
  disabled,
  tone = "normal",
  onPress,
}: ControlProps) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={s.controlItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hint || label}
        accessibilityState={{
          disabled: disabled || busy,
          selected: active,
          busy,
        }}
        disabled={disabled || busy}
        onPress={() => {
          setBusy(true);
          Promise.resolve()
            .then(onPress)
            .catch((e) => Alert.alert("Relay", e.message || "Please retry."))
            .finally(() => setBusy(false));
        }}
        style={({ pressed }) => [
          s.control,
          active && s.controlActive,
          tone === "accept" && s.accept,
          tone === "end" && s.end,
          (disabled || busy) && { opacity: 0.4 },
          pressed && { transform: [{ scale: 0.94 }], opacity: 0.8 },
        ]}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Feather
            name={icon}
            size={25}
            color={active && tone === "normal" ? "#13213c" : "white"}
          />
        )}
      </Pressable>
      <Text style={s.controlLabel}>{label}</Text>
    </View>
  );
}

export type CallScreenProps = {
  call: Call;
  name: string;
  incoming: boolean;
  local: MediaStream | null;
  remote: MediaStream | null;
  seconds: number;
  muted: boolean;
  camera: boolean;
  audioRoutes: CallAudioRoute[];
  preparing: boolean;
  ending: boolean;
  error: string;
  retryEnd: boolean;
  onAccept(): Promise<unknown>;
  onEnd(): Promise<unknown>;
  onRetryEnd(): Promise<unknown>;
  onMute(): void;
  onCamera(): void;
  onRefreshAudio(): Promise<void>;
  onAudioRoute(route: CallAudioRoute): Promise<void>;
};

export function CallScreen(p: CallScreenProps) {
  const [showAudioRoutes, setShowAudioRoutes] = useState(false);
  const selectedAudio = p.audioRoutes.find((route) => route.selected);
  const video = p.call.kind === "video";
  const ended = !!p.call.ended_at;
  const hasCamera = !!p.local
    ?.getVideoTracks()
    .some((track) => track.readyState === "live");
  const remoteVideo =
    video &&
    p.remote
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && track.enabled);
  const duration = `${Math.floor(p.seconds / 60)}:${String(p.seconds % 60).padStart(2, "0")}`;
  const status = p.ending
    ? "Ending call…"
    : ended
      ? "Call ended"
      : p.preparing
        ? "Preparing your microphone…"
        : p.incoming
          ? "Incoming call"
          : p.call.status === "ringing"
            ? "Calling…"
            : p.call.connected_at
              ? duration
              : "Connecting…";
  const initials = p.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <SafeAreaView style={s.page}>
      <View pointerEvents="none" style={s.glow} />
      <ScrollView contentContainerStyle={s.content} bounces={false}>
        <View style={s.topbar}>
          <Text style={s.brand}>
            relay<Text style={{ color: "#8ca5ff" }}>.</Text>
          </Text>
          <View style={s.kindBadge}>
            <Feather
              name={video ? "video" : "phone"}
              size={13}
              color="#b9c9ff"
            />
            <Text style={s.kind}>{video ? "VIDEO CALL" : "AUDIO CALL"}</Text>
          </View>
        </View>
        <View style={s.heading}>
          <Text style={s.name}>{p.name}</Text>
          <View style={s.statusRow}>
            {!ended && (
              <View
                style={[
                  s.dot,
                  {
                    backgroundColor: p.call.connected_at
                      ? "#69dfb0"
                      : "#9bafff",
                  },
                ]}
              />
            )}
            <Text
              accessibilityLiveRegion="polite"
              style={[s.status, !!p.call.connected_at && s.timer]}
            >
              {status}
            </Text>
          </View>
        </View>
        <View style={[s.stage, video && s.videoStage]}>
          {remoteVideo && p.remote ? (
            <RTCView
              accessibilityLabel="Other participant's video"
              streamURL={p.remote.toURL()}
              objectFit="contain"
              zOrder={0}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={s.identity}>
              <View style={[s.outerRing, video && { width: 176, height: 176 }]}>
                <View
                  style={[s.innerRing, video && { width: 148, height: 148 }]}
                >
                  <View
                    style={[s.avatar, video && { width: 120, height: 120 }]}
                  >
                    <Text style={s.initials}>{initials || "?"}</Text>
                  </View>
                </View>
              </View>
              <Text style={s.stageTitle}>
                {ended
                  ? "Until next time"
                  : video
                    ? p.incoming
                      ? "A face-to-face moment"
                      : "Waiting for video"
                    : p.incoming
                      ? "Someone wants to connect"
                      : p.call.connected_at
                        ? "You're connected"
                        : p.call.status === "ringing"
                          ? "A conversation away"
                          : "Connecting your conversation"}
              </Text>
              <Text style={s.stageSubtitle}>
                {ended
                  ? "Your call has finished"
                  : video
                    ? "Video appears here when their camera is on"
                    : p.incoming
                      ? "Answer to start your conversation"
                      : p.call.connected_at
                        ? "Take your time. Stay a little."
                        : p.call.status === "ringing"
                          ? "Waiting for them to answer"
                          : "Call accepted. Establishing audio…"}
              </Text>
            </View>
          )}
          {video && !ended && (
            <View style={s.selfView}>
              {p.local && p.camera ? (
                <RTCView
                  accessibilityLabel="Your camera preview"
                  streamURL={p.local.toURL()}
                  mirror
                  objectFit="cover"
                  zOrder={1}
                  style={StyleSheet.absoluteFill}
                />
              ) : (
                <Feather name="video-off" size={23} color="#aab9d4" />
              )}
              <View style={s.selfLabel}>
                <Text style={s.selfLabelText}>
                  You{!p.camera ? " · camera off" : ""}
                </Text>
              </View>
            </View>
          )}
        </View>
        {!!p.error && (
          <View style={s.error}>
            <Feather name="alert-circle" size={17} color="#ffb9be" />
            <Text accessibilityRole="alert" style={s.errorText}>
              {p.error}
            </Text>
          </View>
        )}
        <View style={s.dock}>
          {!ended && !p.incoming && (
            <View style={s.controls}>
              <Control
                icon={p.muted ? "mic-off" : "mic"}
                label={p.muted ? "Unmute" : "Mute"}
                hint={p.muted ? "Unmute microphone" : "Mute microphone"}
                active={p.muted}
                disabled={!p.local || p.ending}
                onPress={p.onMute}
              />
              {video && (
                <Control
                  icon={p.camera ? "video" : "video-off"}
                  label="Camera"
                  hint={p.camera ? "Turn camera off" : "Turn camera on"}
                  active={p.camera}
                  disabled={!hasCamera || p.ending}
                  onPress={p.onCamera}
                />
              )}
              <Control
                icon={
                  selectedAudio?.kind === "bluetooth"
                    ? "bluetooth"
                    : selectedAudio?.kind === "headset"
                      ? "headphones"
                      : selectedAudio?.kind === "speaker"
                        ? "volume-2"
                        : "phone"
                }
                label="Audio"
                hint="Choose call speaker and microphone"
                active={showAudioRoutes}
                disabled={!p.local || p.ending}
                onPress={async () => {
                  setShowAudioRoutes((shown) => !shown);
                  await p.onRefreshAudio();
                }}
              />
            </View>
          )}
          {showAudioRoutes && !ended && !p.incoming && (
            <View>
              <Text style={s.note}>
                Call audio and microphone
                {selectedAudio ? ` · ${selectedAudio.label}` : ""}
              </Text>
              <ScrollView horizontal contentContainerStyle={s.controls}>
                {p.audioRoutes.map((route) => (
                  <Control
                    key={route.id}
                    icon={
                      route.kind === "bluetooth"
                        ? "bluetooth"
                        : route.kind === "headset"
                          ? "headphones"
                          : route.kind === "speaker"
                            ? "volume-2"
                            : "phone"
                    }
                    label={route.label}
                    active={route.selected}
                    disabled={!p.local || p.ending}
                    onPress={async () => {
                      await p.onAudioRoute(route);
                      setShowAudioRoutes(false);
                    }}
                  />
                ))}
              </ScrollView>
              <Text style={s.note}>
                Connect earbuds in Bluetooth settings. On Android, allow Nearby
                devices.
              </Text>
            </View>
          )}
          {video && !p.incoming && !hasCamera && !ended && (
            <Text style={s.note}>
              Your camera is unavailable. You can still receive video.
            </Text>
          )}
          <View style={s.actions}>
            <Control
              icon="phone-off"
              tone="end"
              label={
                p.incoming
                  ? "Decline"
                  : p.call.status === "ringing"
                    ? "Cancel"
                    : "End call"
              }
              disabled={p.ending || ended}
              onPress={p.onEnd}
            />
            {p.incoming && !ended && (
              <Control
                icon={video ? "video" : "phone"}
                tone="accept"
                label={p.preparing ? "Preparing…" : "Answer"}
                hint="Accept call"
                disabled={p.preparing || p.ending}
                onPress={p.onAccept}
              />
            )}
            {p.retryEnd && !p.ending && (
              <Control
                icon="refresh-cw"
                label="Retry ending"
                onPress={p.onRetryEnd}
              />
            )}
          </View>
          <Text style={s.footer}>
            {p.incoming
              ? `${video ? "Video" : "Audio"} call invitation`
              : p.muted && !ended
                ? "Your microphone is muted"
                : "PRIVATE CONVERSATION"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0c1426" },
  glow: {
    position: "absolute",
    top: -150,
    right: -120,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: "#172547",
    opacity: 0.6,
  },
  content: { flexGrow: 1, padding: 24, gap: 22 },
  topbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: { fontSize: 26, fontWeight: "800", color: "#fff", letterSpacing: -1 },
  kindBadge: {
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#344364",
    backgroundColor: "#1a2742",
  },
  kind: {
    color: "#b9c9ff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  heading: { alignItems: "center", gap: 10, paddingTop: 8 },
  name: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.7,
    textAlign: "center",
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { color: "#b2c1db", fontSize: 14 },
  timer: { fontVariant: ["tabular-nums"], letterSpacing: 2 },
  stage: {
    flex: 1,
    minHeight: 290,
    justifyContent: "center",
    alignItems: "center",
  },
  videoStage: {
    minHeight: 340,
    backgroundColor: "#101e34",
    borderWidth: 1,
    borderColor: "#293750",
    borderRadius: 28,
    overflow: "hidden",
  },
  identity: { alignItems: "center", gap: 12, padding: 20 },
  outerRing: {
    width: 216,
    height: 216,
    borderRadius: 108,
    borderWidth: 1,
    borderColor: "#263757",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111e35",
    marginBottom: 16,
  },
  innerRing: {
    width: 182,
    height: 182,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#344c7b",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a2c4c",
  },
  avatar: {
    width: 148,
    height: 148,
    borderRadius: 80,
    backgroundColor: "#687fd5",
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 44,
    letterSpacing: 2,
  },
  stageTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#e1e8f6",
    textAlign: "center",
  },
  stageSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: "#8fA3c3",
    textAlign: "center",
  },
  selfView: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 100,
    height: 136,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#60718e",
    backgroundColor: "#23324c",
    alignItems: "center",
    justifyContent: "center",
  },
  selfLabel: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    backgroundColor: "#0c1426cc",
    paddingVertical: 6,
    alignItems: "center",
  },
  selfLabelText: { fontSize: 10, color: "#fff" },
  dock: {
    gap: 20,
    backgroundColor: "#152139",
    borderRadius: 30,
    paddingVertical: 22,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#293751",
  },
  controls: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    flexWrap: "wrap",
    rowGap: 16,
  },
  controlItem: { alignItems: "center", gap: 9, minWidth: 76, maxWidth: 100 },
  control: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#2b3a55",
    justifyContent: "center",
    alignItems: "center",
  },
  controlActive: { backgroundColor: "#e5edff" },
  controlLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#c9d5e9",
    textAlign: "center",
  },
  accept: {
    backgroundColor: "#23a77c",
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  end: { backgroundColor: "#ed566c", width: 68, height: 68, borderRadius: 34 },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 56,
    flexWrap: "wrap",
    rowGap: 16,
  },
  footer: {
    textAlign: "center",
    fontSize: 10,
    color: "#8fa1bf",
    letterSpacing: 1.3,
  },
  note: { color: "#a3b3cf", fontSize: 12, textAlign: "center", lineHeight: 18 },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#422733",
  },
  errorText: { color: "#ffb9be", flex: 1, fontSize: 13, lineHeight: 20 },
});
