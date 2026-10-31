import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Alert, AppState, DeviceEventEmitter, Modal } from "react-native";
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
} from "react-native-webrtc";
import InCallManager from "react-native-incall-manager";
import { createIncomingRingtone } from "./lib/incoming-ringtone";
import * as Network from "expo-network";
import { useSession } from "./session";
import { useChat } from "./chat";
import { api, origin } from "./lib/api";
import { createCallPeerConnection } from "./lib/call-connectivity";
import {
  acquireMedia,
  CandidateBuffer,
  Lifetime,
  SignalAssembler,
  type Signal,
} from "./lib/core";
import type { Call } from "./lib/contracts";
import { CallScreen } from "./components/call-screen";

const Context = createContext<{
  start(id: number, kind: "audio" | "video"): Promise<void>;
}>(null!);
export const useCalls = () => useContext(Context);
export function CallProvider({ children }: PropsWithChildren) {
  const { user } = useSession(),
    chat = useChat();
  const [call, setCall] = useState<Call | null>(null),
    [local, setLocal] = useState<MediaStream | null>(null),
    [remote, setRemote] = useState<MediaStream | null>(null),
    [error, setError] = useState(""),
    [ending, setEnding] = useState(false),
    [preparing, setPreparing] = useState(false),
    [muted, setMuted] = useState(false),
    [camera, setCamera] = useState(false),
    [speaker, setSpeaker] = useState(false),
    [seconds, setSeconds] = useState(0),
    [retryEnd, setRetryEnd] = useState(false);
  const current = useRef<Call | null>(null),
    peer = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    lifetime = useRef(new Lifetime()),
    setup = useRef<Promise<RTCPeerConnection> | null>(null),
    controller = useRef<AbortController | null>(null),
    candidates = useRef(new CandidateBuffer()),
    assembler = useRef(new SignalAssembler()),
    offered = useRef(false),
    ringtone = useRef(createIncomingRingtone(InCallManager)),
    pending = useRef<{ id: number; action: string } | null>(null),
    submitting = useRef(false),
    starting = useRef(false),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    signalQueue = useRef(Promise.resolve());
  function cleanup(id?: number) {
    ringtone.current.stop();
    InCallManager.stopRingback();
    lifetime.current.stop(id);
    controller.current?.abort();
    controller.current = null;
    peer.current?.close();
    peer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current?.release();
    stream.current = null;
    setup.current = null;
    candidates.current.clear();
    offered.current = false;
    setLocal(null);
    setRemote(null);
    setCamera(false);
    setMuted(false);
    InCallManager.stop();
  }
  function dismiss() {
    if (current.current) lifetime.current.ended.add(current.current.id);
    current.current = null;
    setCall(null);
    setError("");
    pending.current = null;
  }
  function closeSoon(id: number) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (current.current?.id === id && !pending.current) dismiss();
    }, 900);
  }
  function receive(next: Call) {
    if (lifetime.current.ended.has(next.id) && !next.ended_at) return;
    if (
      current.current &&
      current.current.id !== next.id &&
      !current.current.ended_at
    )
      return;
    if (
      !current.current &&
      (next.ended_at || lifetime.current.ended.has(next.id))
    )
      return;
    if (
      current.current?.id === next.id &&
      current.current.ended_at &&
      !next.ended_at
    )
      return;
    if (next.status !== "ringing" || next.ended_at) {
      ringtone.current.stop();
      InCallManager.stopRingback();
    }
    current.current = next;
    setCall(next);
    if (next.ended_at) {
      cleanup(next.id);
      if (!pending.current) closeSoon(next.id);
    } else if (
      next.status === "accepted" &&
      next.caller_id === user?.id &&
      !offered.current
    ) {
      offered.current = true;
      void offer(next).catch((e) => fail(e, next.id));
    }
  }
  async function action(action: string, id = current.current?.id) {
    if (!id) return;
    const terminal = ["end", "cancel", "reject", "failed"].includes(action);
    if (terminal) {
      if (submitting.current) return;
      submitting.current = true;
      pending.current = { id, action };
      setRetryEnd(false);
      setEnding(true);
      setError("");
      cleanup(id);
      if (current.current?.id === id) {
        current.current = {
          ...current.current,
          status: "ending",
          ended_at: new Date().toISOString(),
        };
        setCall(current.current);
      }
      try {
        const result = await api.request<{ data: Call }>(
          `calls/${id}`,
          "PATCH",
          { action },
        );
        pending.current = null;
        if (current.current?.id === id) {
          current.current = result.data;
          setCall(result.data);
          closeSoon(id);
        }
      } catch {
        setRetryEnd(true);
        setError(
          "Microphone and camera are off. Server hang-up could not be confirmed. Retry hang-up.",
        );
      } finally {
        submitting.current = false;
        setEnding(false);
      }
      return;
    }
    if (lifetime.current.ended.has(id)) return;
    const result = await api.request<{ data: Call }>(`calls/${id}`, "PATCH", {
      action,
    });
    if (!lifetime.current.ended.has(id)) receive(result.data);
  }
  async function fail(e: unknown, expectedId?: number) {
    if (
      expectedId &&
      (current.current?.id !== expectedId ||
        lifetime.current.ended.has(expectedId))
    )
      return;
    if (current.current?.ended_at) return;
    const message = (e as Error).message || "Call failed.";
    setError(message);
    Alert.alert("Call interrupted", message);
    const id = current.current?.id;
    if (id && !lifetime.current.ended.has(id)) await action("failed", id);
    else cleanup();
  }
  async function sendSignal(c: Call, type: string, payload: unknown) {
    if (lifetime.current.ended.has(c.id)) return;
    await api.request(`calls/${c.id}/signal`, "POST", { type, payload });
  }
  async function prepare(c: Call, freshPeer?: RTCPeerConnection) {
    if (setup.current) return setup.current;
    if (peer.current && stream.current) return peer.current;
    const generation = lifetime.current.generation;
    const valid = () =>
      lifetime.current.valid(generation, c.id) && current.current?.id === c.id;
    controller.current = new AbortController();
    const task = (async () => {
      const pc =
        freshPeer ||
        (await createCallPeerConnection(
          {
            apiOrigin: origin,
            accessToken: api.token,
            signal: controller.current!.signal,
          },
          (config) => new RTCPeerConnection(config),
        ));
      if (!valid()) {
        pc.close();
        throw new Error("Call cancelled.");
      }
      peer.current = pc;
      const media = await acquireMedia(
        c.kind === "video",
        (constraints) => mediaDevices.getUserMedia(constraints),
        valid,
      );
      if (!valid()) {
        media.getTracks().forEach((t) => t.stop());
        pc.close();
        throw new Error("Call cancelled.");
      }
      stream.current = media;
      setLocal(media);
      setCamera(!!media.getVideoTracks().length);
      InCallManager.start({
        media: c.kind,
        ringback:
          c.caller_id === user?.id && current.current?.status === "ringing"
            ? "_DEFAULT_"
            : "",
      });
      InCallManager.setForceSpeakerphoneOn(c.kind === "video");
      setSpeaker(c.kind === "video");
      for (const track of media.getTracks()) {
        pc.addTrack(track, media);
        track.addEventListener("ended", () => {
          if (valid()) {
            if (track.kind === "audio")
              void fail(
                new Error("Microphone disconnected. Reconnect it and redial."),
                c.id,
              );
            else setCamera(false);
          }
        });
      }
      if (c.kind === "video" && !media.getVideoTracks().length)
        pc.addTransceiver("video", { direction: "recvonly" });
      pc.addEventListener("track", (e) => {
        if (valid())
          setRemote(e.streams[0] ?? new MediaStream(e.track ? [e.track] : []));
      });
      pc.addEventListener("icecandidate", (e) => {
        if (valid() && e.candidate)
          void sendSignal(c, "ice", e.candidate.toJSON()).catch((e) =>
            fail(e, c.id),
          );
      });
      pc.addEventListener("connectionstatechange", () => {
        if (!valid()) return;
        if (pc.connectionState === "connected")
          void action("connected", c.id).catch((e) => fail(e, c.id));
        if (pc.connectionState === "failed")
          void fail(
            new Error(
              "Media connection failed. Check your network and redial.",
            ),
            c.id,
          );
        if (pc.connectionState === "disconnected")
          setError("Media connection interrupted. Waiting for recovery.");
      });
      return pc;
    })();
    setup.current = task;
    try {
      return await task;
    } finally {
      if (setup.current === task) setup.current = null;
    }
  }
  async function offer(c: Call) {
    const pc = await prepare(c);
    if (lifetime.current.ended.has(c.id)) return;
    const description = await pc.createOffer();
    await pc.setLocalDescription(description);
    await sendSignal(c, "offer", {
      type: description.type,
      sdp: description.sdp,
    });
  }
  async function handleSignal(s: Signal) {
    const c = current.current;
    if (
      !c ||
      c.id !== s.call_id ||
      c.ended_at ||
      lifetime.current.ended.has(c.id)
    )
      return;
    const raw = assembler.current.add(s);
    if (!raw) return;
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(raw), (x) => x.charCodeAt(0)),
      ),
    );
    const pc = await prepare(c);
    if (lifetime.current.ended.has(c.id)) return;
    if (s.type === "ice") {
      await candidates.current.add(
        payload,
        !!pc.remoteDescription,
        (candidate) => pc.addIceCandidate(candidate),
      );
      return;
    }
    await pc.setRemoteDescription(payload);
    await candidates.current.flush(
      (candidate) => pc.addIceCandidate(candidate),
      () => !lifetime.current.ended.has(c.id),
    );
    if (lifetime.current.ended.has(c.id)) return;
    if (s.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(c, "answer", { type: answer.type, sdp: answer.sdp });
    }
  }
  async function start(id: number, kind: "audio" | "video") {
    if (starting.current || current.current)
      throw new Error("Finish the current call first.");
    starting.current = true;
    let startedId: number | undefined;
    let freshPeer: RTCPeerConnection | undefined;
    setPreparing(true);
    setError("");
    try {
      // Constructing a peer first guarantees fresh ICE before the server rings.
      const generation = lifetime.current.generation;
      freshPeer = await createCallPeerConnection(
        { apiOrigin: origin, accessToken: api.token },
        (config) => new RTCPeerConnection(config),
      );
      if (!lifetime.current.valid(generation)) {
        freshPeer.close();
        return;
      }
      const result = await api.request<{ data: Call }>(
        `conversations/${id}/calls`,
        "POST",
        { kind },
      );
      startedId = result.data.id;
      if (!lifetime.current.valid(generation)) {
        freshPeer.close();
        await action("cancel", result.data.id);
        return;
      }
      receive(result.data);
      await prepare(result.data, freshPeer);
    } catch (e) {
      freshPeer?.close();
      await fail(e, startedId);
      if (!startedId || !lifetime.current.ended.has(startedId)) throw e;
    } finally {
      starting.current = false;
      setPreparing(false);
    }
  }
  async function accept() {
    ringtone.current.stop();
    const c = current.current;
    if (!c || preparing) return;
    setPreparing(true);
    try {
      await prepare(c);
      if (!lifetime.current.ended.has(c.id)) await action("accept", c.id);
    } catch (e) {
      await fail(e, c.id);
    } finally {
      setPreparing(false);
    }
  }
  const handlerRef = useRef({ receive, handleSignal, action, cleanup, fail });
  useEffect(() => {
    handlerRef.current = { receive, handleSignal, action, cleanup, fail };
  });
  useEffect(
    () =>
      chat.listen((e) => {
        if (e.event === "v1.call.updated")
          handlerRef.current.receive(e.data as Call);
        if (e.event === "v1.call.signal")
          signalQueue.current = signalQueue.current
            .then(() => handlerRef.current.handleSignal(e.data as Signal))
            .catch((error) =>
              handlerRef.current.fail(error, (e.data as Signal).call_id),
            );
        if (e.event === "v1.call.recovered") {
          const c = e.data as Call;
          if (!current.current && !lifetime.current.ended.has(c.id)) {
            handlerRef.current.receive(c);
            if (c.status !== "ringing") {
              setError(
                "An interrupted call cannot be restored. Please redial.",
              );
              void handlerRef.current.action("end", c.id);
            }
          }
        }
      }),
    // The registered listener reads current methods from handlerRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      const c = current.current;
      if (!c || c.ended_at) return;
      if (Date.parse(c.expires_at) <= Date.now()) {
        void handlerRef.current.action("end", c.id);
        return;
      }
      if (["accepted", "connected"].includes(c.status))
        void handlerRef.current
          .action("heartbeat", c.id)
          .catch(() =>
            setError(
              "Call heartbeat unavailable. Call will end if the lease expires.",
            ),
          );
    }, 20000);
    const clock = setInterval(() => {
      const c = current.current;
      setSeconds(
        c?.connected_at
          ? Math.max(
              0,
              Math.floor((Date.now() - Date.parse(c.connected_at)) / 1000),
            )
          : 0,
      );
    }, 1000);
    const app = AppState.addEventListener("change", (state) => {
      if (
        (state === "background" ||
          (state === "inactive" && !!stream.current)) &&
        current.current &&
        !current.current.ended_at
      ) {
        setError("Call ended because Relay moved to the background.");
        void handlerRef.current.action("end");
      }
    });
    const interruption = DeviceEventEmitter.addListener(
      "onAudioFocusChange",
      (e) => {
        if (e.eventCode < 0 && stream.current && current.current)
          void handlerRef.current.action("end");
      },
    );
    const noisy = DeviceEventEmitter.addListener("NoisyAudio", () => {
      if (current.current) void handlerRef.current.action("end");
    });
    const headset = DeviceEventEmitter.addListener("WiredHeadset", (e) => {
      if (!e.isPlugged && current.current)
        void handlerRef.current.action("end");
    });
    const network = Network.addNetworkStateListener((state) => {
      if (current.current && !current.current.ended_at)
        setError(
          state.isConnected
            ? "Network changed. Waiting for media recovery; redial if it does not return."
            : "Network unavailable. The call will end if its participant lease expires.",
        );
    });
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      app.remove();
      interruption.remove();
      noisy.remove();
      headset.remove();
      network.remove();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      const c = current.current;
      handlerRef.current.cleanup(c?.id);
      if (c && !c.ended_at)
        void api
          .request(`calls/${c.id}`, "PATCH", { action: "end" })
          .catch(() => {});
      current.current = null;
      setCall(null);
    };
  }, [user?.id]);
  const incoming = call?.callee_id === user?.id && call?.status === "ringing";
  const ringtoneCallId = call?.id,
    ringtoneExpiry = call?.expires_at,
    ringtoneEnded = !!call?.ended_at;
  useEffect(() => {
    const alert = ringtone.current;
    if (
      incoming &&
      ringtoneCallId &&
      !ringtoneEnded &&
      !preparing &&
      AppState.currentState === "active"
    ) {
      const remaining = Math.ceil(
        (Date.parse(ringtoneExpiry ?? "") - Date.now()) / 1000,
      );
      if (!Number.isFinite(remaining) || remaining > 0)
        alert.start(
          ringtoneCallId,
          Number.isFinite(remaining) ? remaining : 45,
        );
    } else alert.stop();
    return () => alert.stop();
  }, [incoming, ringtoneCallId, ringtoneEnded, ringtoneExpiry, preparing]);
  const setCallAudioActive = chat.setCallAudioActive;
  const callAudioActive = !!call && !call.ended_at;
  useEffect(() => {
    setCallAudioActive(callAudioActive);
    return () => setCallAudioActive(false);
  }, [callAudioActive, setCallAudioActive]);
  return (
    <Context.Provider value={{ start }}>
      {children}
      <Modal
        visible={!!call}
        animationType="slide"
        onRequestClose={() => {
          void action(
            call?.status === "ringing" && call.caller_id === user?.id
              ? "cancel"
              : "end",
          );
        }}
      >
        {call && (
          <CallScreen
            call={call}
            name={
              chat.conversations.find((c) => c.id === call.conversation_id)
                ?.peer.name || "Relay member"
            }
            incoming={incoming}
            local={local}
            remote={remote}
            seconds={seconds}
            muted={muted}
            camera={camera}
            speaker={speaker}
            preparing={preparing}
            ending={ending}
            error={error}
            retryEnd={retryEnd}
            onAccept={accept}
            onEnd={() =>
              action(
                incoming
                  ? "reject"
                  : call.status === "ringing"
                    ? "cancel"
                    : "end",
              )
            }
            onRetryEnd={() =>
              action(pending.current!.action, pending.current!.id)
            }
            onMute={() => {
              const next = !muted;
              local?.getAudioTracks().forEach((track) => {
                track.enabled = !next;
              });
              setMuted(next);
            }}
            onCamera={() => {
              local?.getVideoTracks().forEach((track) => {
                track.enabled = !camera;
              });
              setCamera(!camera);
            }}
            onSpeaker={() => {
              InCallManager.setForceSpeakerphoneOn(!speaker);
              setSpeaker(!speaker);
            }}
          />
        )}
      </Modal>
    </Context.Provider>
  );
}
