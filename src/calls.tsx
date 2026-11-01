import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  Alert,
  AppState,
  DeviceEventEmitter,
  Modal,
  Platform,
} from "react-native";
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
} from "react-native-webrtc";
import InCallManager from "react-native-incall-manager";
import * as Network from "expo-network";
import { useSession } from "./session";
import { useChat } from "./chat";
import { api, origin } from "./lib/api";
import {
  createCallPeerConnection,
  fetchCallConnectivity,
  type CallConnectivity,
} from "./lib/call-connectivity";
import { createIncomingRingtone } from "./lib/incoming-ringtone";
import {
  requestCallBluetooth,
  getCallAudioRoutes,
  selectCallAudioRoute,
  watchIOSCallAudioRoutes,
} from "./lib/call-audio";
import {
  parseAndroidCallRoutes,
  type CallAudioRoute,
} from "./lib/call-audio-routes";
import { gatherEarlyIce } from "./lib/call-ice";
import { CallStateSync } from "./lib/call-state-sync";
import { canApplyAnswer, RemoteDescriptions } from "./lib/remote-descriptions";
import {
  CallNetworkState,
  CallSignaling,
  CallSignalingUnavailable,
} from "./lib/call-signaling";
import {
  acquireMedia,
  acquireCallResources,
  CandidateBuffer,
  Lifetime,
  SignalAssembler,
  type Signal,
} from "./lib/core";
import type { Call, Page } from "./lib/contracts";
import {
  bindNativeCallActions,
  CallKeep,
  nativeCallsAvailable,
  setupNativeCalls,
  showNativeCall,
  endNativeCall,
  markNativeAnswered,
  nativeCallIsTracked,
} from "./lib/native-push";
import { callInterval } from "./lib/call-timer";
import { callUUID } from "./lib/push-contract";
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
    [audioRoutes, setAudioRoutes] = useState<CallAudioRoute[]>([]),
    [seconds, setSeconds] = useState(0),
    [nativeRingingId, setNativeRingingId] = useState<number | null>(null),
    [retryEnd, setRetryEnd] = useState(false);
  const current = useRef<Call | null>(null),
    peer = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    lifetime = useRef(new Lifetime()),
    setup = useRef<Promise<RTCPeerConnection> | null>(null),
    controller = useRef<AbortController | null>(null),
    candidates = useRef(new CandidateBuffer()),
    assembler = useRef(new SignalAssembler()),
    descriptions = useRef(new RemoteDescriptions()),
    offered = useRef(false),
    ringtone = useRef(createIncomingRingtone(InCallManager)),
    incomingIce = useRef<{
      id: number;
      controller: AbortController;
      task: Promise<CallConnectivity | null>;
    } | null>(null),
    pending = useRef<{ id: number; action: string } | null>(null),
    submitting = useRef(false),
    starting = useRef(false),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    connectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    recoveryStarted = useRef(0),
    signaling = useRef<CallSignaling | null>(null),
    signalQueue = useRef(Promise.resolve());
  const mutedRef = useRef(false);
  const userId = user?.id;
  const callStateSync = useRef(new CallStateSync());
  async function reconcileCall() {
    const c = current.current;
    if (!c || c.ended_at || !["ringing", "accepted"].includes(c.status)) return;
    const generation = lifetime.current.generation;
    await callStateSync.current.refresh(
      c.id,
      async () => (await api.request<Page<Call>>("calls")).data,
      () =>
        lifetime.current.valid(generation, c.id) &&
        current.current?.id === c.id &&
        !current.current.ended_at,
      (next) => handlerRef.current.receive(next),
    );
  }
  function clearRecovery() {
    if (connectionTimer.current) clearTimeout(connectionTimer.current);
    connectionTimer.current = null;
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = null;
    recoveryStarted.current = 0;
  }
  function cleanup(id?: number) {
    if (id) endNativeCall(id);
    ringtone.current.stop();
    InCallManager.stopRingback();
    incomingIce.current?.controller.abort();
    incomingIce.current = null;
    lifetime.current.stop(id);
    clearRecovery();
    signaling.current = null;
    controller.current?.abort();
    controller.current = null;
    peer.current?.close();
    peer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current?.release();
    stream.current = null;
    setup.current = null;
    candidates.current.clear();
    descriptions.current.clear();
    offered.current = false;
    setLocal(null);
    setRemote(null);
    setCamera(false);
    mutedRef.current = false;
    setMuted(false);
    setAudioRoutes([]);
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
    if (
      __DEV__ &&
      (current.current?.id !== next.id ||
        current.current?.status !== next.status)
    )
      console.info("[calls] update", next.id, next.status, "self", user?.id);
    if (
      current.current?.id === next.id &&
      Date.parse(next.updated_at) < Date.parse(current.current.updated_at)
    )
      return;
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
    current.current = next;
    setCall(next);
    if (
      nativeCallsAvailable &&
      !next.ended_at &&
      next.status === "ringing" &&
      next.callee_id === user?.id
    ) {
      const name =
        chat.conversations.find((c) => c.id === next.conversation_id)?.peer
          .name || "Relay";
      void showNativeCall(
        next.id,
        name,
        next.kind === "video",
        next.expires_at,
      ).then((shown) => {
        if (shown && current.current?.id === next.id)
          setNativeRingingId(next.id);
      });
    }
    if (
      nativeCallsAvailable &&
      next.status === "connected" &&
      nativeCallIsTracked(next.id)
    ) {
      if (Platform.OS === "android")
        CallKeep.setCurrentCallActive(callUUID(next.id));
      else if (next.caller_id === user?.id)
        CallKeep.reportConnectedOutgoingCallWithUUID(callUUID(next.id));
    }
    if (
      next.status === "accepted" &&
      !next.ended_at &&
      !connectionTimer.current &&
      !recoveryTimer.current &&
      peer.current?.connectionState !== "connected"
    ) {
      connectionTimer.current = setTimeout(() => {
        connectionTimer.current = null;
        if (current.current?.id === next.id && !current.current.ended_at)
          handlerRef.current.recoverMedia(current.current);
      }, 20000);
    }
    if (next.status !== "ringing" || next.ended_at) {
      ringtone.current.stop();
      InCallManager.stopRingback();
    }
    if (
      next.status === "ringing" &&
      !next.ended_at &&
      next.callee_id === user?.id &&
      incomingIce.current?.id !== next.id &&
      !peer.current &&
      !setup.current
    ) {
      const abort = new AbortController();
      incomingIce.current = {
        id: next.id,
        controller: abort,
        // Only fetch authenticated credentials while ringing; never open a microphone.
        task: fetchCallConnectivity({
          apiOrigin: origin,
          accessToken: api.token,
          signal: abort.signal,
        }).catch(() => null),
      };
    }
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
    if (e instanceof CallSignalingUnavailable && current.current) {
      if (peer.current?.connectionState !== "connected")
        recoverMedia(current.current);
      return;
    }
    const message = (e as Error).message || "Call failed.";
    setError(message);
    Alert.alert("Call interrupted", message);
    const id = current.current?.id;
    if (id && !lifetime.current.ended.has(id)) await action("failed", id);
    else cleanup();
  }
  function recoverMedia(c: Call) {
    if (
      recoveryTimer.current ||
      current.current?.id !== c.id ||
      c.ended_at ||
      lifetime.current.ended.has(c.id)
    )
      return;
    recoveryStarted.current ||= Date.now();
    setError(
      c.connected_at
        ? "Media connection interrupted. Reconnecting…"
        : "Media connection delayed. Retrying…",
    );
    recoveryTimer.current = setTimeout(async () => {
      const pc = peer.current;
      if (
        !pc ||
        current.current?.id !== c.id ||
        lifetime.current.ended.has(c.id)
      ) {
        recoveryTimer.current = null;
        return;
      }
      if (pc.connectionState === "connected") {
        clearRecovery();
        setError("");
        return;
      }
      if (Date.now() - recoveryStarted.current >= 40000) {
        void fail(
          new Error(
            "The media connection could not recover. Check your network and redial.",
          ),
          c.id,
        );
        return;
      }
      // The signaling API reserves offers for the caller, avoiding offer collisions.
      try {
        if (signaling.current?.busy) {
          // An ICE restart invalidates the generation whose candidates are still
          // crossing the API. Finish delivery before beginning another exchange.
        } else if (c.caller_id === user?.id && pc.signalingState === "stable")
          await offer(c, true);
        else if (pc.localDescription?.type)
          await signaling.current?.description(pc.localDescription.type, {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          });
      } catch {
        /* Keep recovering until the grace period expires. */
      }
      if (peer.current === pc) {
        recoveryTimer.current = null;
        if (peer.current?.connectionState !== "connected") recoverMedia(c);
      }
    }, 5000);
  }
  async function prepare(c: Call, freshPeer?: RTCPeerConnection) {
    if (setup.current) return setup.current;
    if (peer.current && stream.current) return peer.current;
    const generation = lifetime.current.generation;
    const valid = () =>
      lifetime.current.valid(generation, c.id) && current.current?.id === c.id;
    const preflight =
      incomingIce.current?.id === c.id ? incomingIce.current : null;
    incomingIce.current = null;
    controller.current = preflight?.controller ?? new AbortController();
    const signal = controller.current.signal;
    const task = (async () => {
      const { pc, media } = await acquireCallResources(
        async () => {
          if (freshPeer) return freshPeer;
          const config = await preflight?.task;
          if (signal.aborted) throw new Error("Call cancelled.");
          if (config && Date.parse(config.expires_at) > Date.now() + 30000)
            return new RTCPeerConnection({ iceServers: config.ice_servers });
          return createCallPeerConnection(
            {
              apiOrigin: origin,
              accessToken: api.token,
              signal,
            },
            (config) => new RTCPeerConnection(config),
          );
        },
        () =>
          acquireMedia(
            c.kind === "video" && AppState.currentState === "active",
            (constraints) => mediaDevices.getUserMedia(constraints),
            valid,
          ),
        valid,
      );
      peer.current = pc;
      const sender = new CallSignaling(
        async (type, payload) => {
          if (__DEV__) console.info("[calls] sending", c.id, type);
          try {
            await api.request(
              `calls/${c.id}/signal`,
              "POST",
              { type, payload },
              signal,
            );
            if (__DEV__) console.info("[calls] sent", c.id, type);
          } catch (error) {
            if (__DEV__)
              console.warn(
                "[calls] signal failed",
                c.id,
                type,
                (error as { status?: number }).status ?? "network/timeout",
              );
            throw error;
          }
        },
        () => valid() && peer.current === pc,
        () => {
          if (valid() && pc.connectionState !== "connected")
            setError("Call signaling delayed. Retrying the media connection…");
        },
      );
      signaling.current = sender;
      stream.current = media;
      media.getAudioTracks().forEach((track) => {
        track.enabled = !mutedRef.current;
      });
      setLocal(media);
      setCamera(!!media.getVideoTracks().length);
      InCallManager.start({
        media: c.kind,
        auto: true,
        ringback:
          c.caller_id === user?.id && current.current?.status === "ringing"
            ? "_DEFAULT_"
            : "",
      });
      void getCallAudioRoutes()
        .then((routes) => {
          if (valid()) setAudioRoutes(routes);
        })
        .catch(() => {});
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
      const candidateCounts: Record<string, number> = {};
      pc.addEventListener("icecandidate", (e) => {
        if (!valid()) return;
        if (e.candidate) {
          const type =
            /\btyp (\w+)/.exec(e.candidate.candidate)?.[1] ?? "unknown";
          candidateCounts[type] = (candidateCounts[type] || 0) + 1;
          sender.candidate(e.candidate.toJSON());
        } else if (__DEV__) {
          console.info("[calls] gathered", c.id, candidateCounts);
        }
      });
      pc.addEventListener("iceconnectionstatechange", () => {
        if (__DEV__)
          console.info("[calls] ice state", c.id, pc.iceConnectionState);
      });
      pc.addEventListener("connectionstatechange", () => {
        if (__DEV__) console.info("[calls] peer", c.id, pc.connectionState);
        if (!valid()) return;
        if (pc.connectionState === "connected") {
          clearRecovery();
          setError("");
          // A control-plane timeout must not tear down working media.
          void action("connected", c.id).catch(() => {
            if (valid())
              setError(
                "Call connected. Server confirmation delayed; retrying.",
              );
          });
        }
        if (["failed", "disconnected"].includes(pc.connectionState))
          recoverMedia(c);
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
  async function offer(c: Call, iceRestart = false) {
    const pc = await prepare(c);
    if (lifetime.current.ended.has(c.id)) return;
    signaling.current?.beginDescription();
    const description = await pc.createOffer({ iceRestart });
    if (lifetime.current.ended.has(c.id)) return;
    await pc.setLocalDescription(description);
    await gatherEarlyIce(pc, controller.current?.signal);
    if (lifetime.current.ended.has(c.id)) return;
    await signaling.current?.description("offer", {
      type: description.type,
      sdp: pc.localDescription?.sdp ?? description.sdp,
    });
  }
  async function handleSignal(s: Signal) {
    if (__DEV__)
      console.info("[calls] received", s.call_id, s.type, s.index, s.total);
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
    if (s.type === "answer" && !canApplyAnswer(pc.signalingState)) {
      if (__DEV__)
        console.info("[calls] ignored extra answer", c.id, pc.signalingState);
      return;
    }
    // Native remoteDescription changes when ICE is applied. Compare received
    // descriptions separately so retries cannot set a second answer in stable state.
    const duplicate = descriptions.current.classify(payload);
    if (duplicate !== "new") {
      if (
        duplicate === "repeat" &&
        s.type === "offer" &&
        pc.localDescription?.type === "answer"
      )
        await signaling.current?.description("answer", {
          type: "answer",
          sdp: pc.localDescription.sdp,
        });
      return;
    }
    if (s.type === "offer") signaling.current?.beginDescription();
    await pc.setRemoteDescription(payload);
    descriptions.current.remember(payload);
    await candidates.current.flush(
      (candidate) => pc.addIceCandidate(candidate),
      () => !lifetime.current.ended.has(c.id),
    );
    if (lifetime.current.ended.has(c.id)) return;
    if (s.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await gatherEarlyIce(pc, controller.current?.signal);
      if (lifetime.current.ended.has(c.id)) return;
      await signaling.current?.description("answer", {
        type: answer.type,
        sdp: pc.localDescription?.sdp ?? answer.sdp,
      });
    }
  }
  async function start(id: number, kind: "audio" | "video") {
    if (__DEV__) console.info("[calls] start", kind);
    if (starting.current || current.current)
      throw new Error("Finish the current call first.");
    starting.current = true;
    let startedId: number | undefined;
    let freshPeer: RTCPeerConnection | undefined;
    setPreparing(true);
    setError("");
    try {
      await requestCallBluetooth();
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
      if (await setupNativeCalls()) {
        CallKeep.startCall(
          callUUID(result.data.id),
          String(result.data.id),
          chat.conversations.find((c) => c.id === id)?.peer.name || "Relay",
          "generic",
          kind === "video",
        );
        markNativeAnswered(result.data.id);
      }
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
    if (__DEV__) console.info("[calls] accept", current.current?.id);
    const c = current.current;
    if (
      !c ||
      preparing ||
      c.status !== "ringing" ||
      lifetime.current.ended.has(c.id)
    )
      return;
    ringtone.current.stop();
    setPreparing(true);
    try {
      await chat.readyForCalls();
      await requestCallBluetooth();
      await prepare(c);
      if (nativeCallsAvailable && nativeCallIsTracked(c.id)) {
        markNativeAnswered(c.id);
        CallKeep.answerIncomingCall(callUUID(c.id));
      }
      if (!lifetime.current.ended.has(c.id)) await action("accept", c.id);
    } catch (e) {
      await fail(e, c.id);
    } finally {
      setPreparing(false);
    }
  }
  const handlerRef = useRef({
    receive,
    handleSignal,
    action,
    cleanup,
    fail,
    recoverMedia,
    reconcileCall,
    accept,
  });
  useEffect(() => {
    handlerRef.current = {
      receive,
      handleSignal,
      action,
      cleanup,
      fail,
      recoverMedia,
      reconcileCall,
      accept,
    };
  });
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let queue = Promise.resolve();
    const unbind = bindNativeCallActions((event) => {
      queue = queue
        .catch(() => {})
        .then(async () => {
          if (!active) return;
          const { data } = await api.request<Page<Call>>("calls");
          if (!active) return;
          const next = data.find((c) => c.id === event.id);
          if (
            !next ||
            next.ended_at ||
            Date.parse(next.expires_at) <= Date.now()
          ) {
            endNativeCall(event.id);
            return;
          }
          if (event.action === "end") {
            await handlerRef.current.action("end", event.id);
            return;
          }
          handlerRef.current.receive(next);
          if (
            event.action === "answer" &&
            next.status === "ringing" &&
            next.callee_id === userId
          )
            await handlerRef.current.accept();
          if (event.action === "mute" && current.current?.id === event.id) {
            stream.current?.getAudioTracks().forEach((track) => {
              track.enabled = !event.muted;
            });
            mutedRef.current = !!event.muted;
            setMuted(!!event.muted);
          }
        });
      return queue;
    });
    return () => {
      active = false;
      unbind();
    };
  }, [userId]);
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
          if (current.current?.id === c.id) {
            // Reconciliation must also advance an existing ringing call to accepted.
            handlerRef.current.receive(c);
          } else if (!current.current && !lifetime.current.ended.has(c.id)) {
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
    if (__DEV__) console.info("[calls] state-sync-v2", origin);
    const reconcile = setInterval(() => {
      void handlerRef.current.reconcileCall().catch(() => {
        // Pusher and the next poll can still recover a transient API failure.
      });
    }, 3000);
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
      const c = current.current;
      if (!c || c.ended_at) return;
      if (state === "active") {
        void handlerRef.current.reconcileCall().catch(() => {});
      } else if (state === "background") {
        // Keep audio alive through the native call service. Camera is foreground only.
        if (nativeCallsAvailable && nativeCallIsTracked(c.id)) {
          stream.current?.getVideoTracks().forEach((track) => {
            track.enabled = false;
          });
          setCamera(false);
        } else {
          setError(
            "Enable native calling to continue calls in the background.",
          );
          void handlerRef.current.action("end");
        }
      }
    });
    const interruption = DeviceEventEmitter.addListener(
      "onAudioFocusChange",
      (e) => {
        if (e.eventCode < 0 && current.current)
          void handlerRef.current.action("end");
      },
    );
    // Route changes (including unplugging earbuds) are handled by InCallManager.
    const route = DeviceEventEmitter.addListener(
      "onAudioDeviceChanged",
      (event) => {
        if (stream.current && current.current && !current.current.ended_at)
          setAudioRoutes(parseAndroidCallRoutes(event));
      },
    );
    const iosRoute = watchIOSCallAudioRoutes(() => {
      const id = current.current?.id;
      if (!id || !stream.current) return;
      void getCallAudioRoutes()
        .then((routes) => {
          if (current.current?.id === id && stream.current)
            setAudioRoutes(routes);
        })
        .catch(() => {});
    });
    const networkState = new CallNetworkState();
    const network = Network.addNetworkStateListener((state) => {
      const { online, changed } = networkState.update(state);
      const c = current.current;
      if (!c || c.ended_at) return;
      if (!online) setError("Network unavailable. Waiting for connection…");
      else if (peer.current?.connectionState === "connected") setError("");
      else if (changed && peer.current?.localDescription)
        handlerRef.current.recoverMedia(c);
    });
    return () => {
      clearInterval(reconcile);

      clearInterval(clock);
      app.remove();
      interruption.remove();
      route.remove();
      iosRoute?.remove();
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
  const activeCallId = call && !call.ended_at ? call.id : null;
  useEffect(() => {
    if (!activeCallId) return;
    const stop = callInterval(() => {
      const c = current.current;
      if (!c || c.ended_at) return;
      if (Date.parse(c.expires_at) <= Date.now()) {
        void handlerRef.current.action("end", c.id);
        return;
      }
      if (["accepted", "connected"].includes(c.status))
        void handlerRef.current
          .action(
            peer.current?.connectionState === "connected" &&
              c.status !== "connected"
              ? "connected"
              : "heartbeat",
            c.id,
          )
          .catch(() =>
            setError(
              "Call heartbeat unavailable. Call will end if the lease expires.",
            ),
          );
    }, 20000);
    return stop;
  }, [activeCallId]);
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
      nativeRingingId !== ringtoneCallId &&
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
  }, [
    incoming,
    ringtoneCallId,
    ringtoneExpiry,
    ringtoneEnded,
    preparing,
    nativeRingingId,
  ]);
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
            audioRoutes={audioRoutes}
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
              mutedRef.current = next;
              setMuted(next);
              if (nativeCallsAvailable && call)
                CallKeep.setMutedCall(callUUID(call.id), next);
            }}
            onCamera={() => {
              local?.getVideoTracks().forEach((track) => {
                track.enabled = !camera;
              });
              setCamera(!camera);
            }}
            onRefreshAudio={async () => {
              const id = call.id;
              await requestCallBluetooth();
              if (current.current?.id !== id || !stream.current) return;
              const routes = await getCallAudioRoutes();
              if (current.current?.id === id && stream.current)
                setAudioRoutes(routes);
            }}
            onAudioRoute={async (route) => {
              const id = call.id;
              const routes = await selectCallAudioRoute(callUUID(id), route);
              if (current.current?.id === id && stream.current)
                setAudioRoutes(routes);
            }}
          />
        )}
      </Modal>
    </Context.Provider>
  );
}
