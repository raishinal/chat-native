import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, Platform } from "react-native";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { useSession } from "./session";
import { api } from "./lib/api";
import {
  mergeMessages,
  messageHistoryPath,
  Once,
  recoverPages,
  shouldSound,
} from "./lib/core";
import { clearPrivateFiles } from "./lib/files";
import { Realtime } from "./lib/realtime";
import { androidMessageSound, bindAndroidSoundGate } from "./lib/android-sound";
import type {
  Call,
  Conversation,
  Message,
  Notice,
  Page,
  PickedFile,
} from "./lib/contracts";

type Event = { event: string; data: unknown };
type Chat = {
  conversations: Conversation[];
  messages: Record<number, Message[]>;
  notices: Notice[];
  connection: string;
  error: string;
  muted: boolean;
  hasMoreConversations: boolean;
  hasMoreNotices: boolean;
  setFocus(id: number | null): void;
  refresh(): Promise<void>;
  history(id: number, cursor?: string): Promise<string | null>;
  put(id: number, rows: Message[]): void;
  listen(handler: (event: Event) => void): () => void;
  moreConversations(): Promise<void>;
  moreNotices(): Promise<void>;
  toggleMute(): Promise<void>;
  testSound(): Promise<void>;
  setCallAudioActive(active: boolean): void;
  markNoticeRead(id: number): Promise<void>;
  staged(clientId: string): { ids: number[]; files: PickedFile[] } | undefined;
  stage(clientId: string, value?: { ids: number[]; files: PickedFile[] }): void;
};
const Context = createContext<Chat>(null!);
export function ChatProvider({ children }: PropsWithChildren) {
  const { user, refresh: refreshSession } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [messages, setMessages] = useState<Record<number, Message[]>>({}),
    [notices, setNotices] = useState<Notice[]>([]),
    [connection, setConnection] = useState("Connecting"),
    [error, setError] = useState(""),
    [muted, setMuted] = useState(false),
    [hasMoreConversations, setHasMoreConversations] = useState(false),
    [hasMoreNotices, setHasMoreNotices] = useState(false);
  const focus = useRef<number | null>(null),
    rows = useRef(messages),
    live = useRef<Realtime | null>(null),
    handlers = useRef(new Set<(event: Event) => void>()),
    busy = useRef<Promise<void> | null>(null),
    epoch = useRef(0),
    alertIds = useRef(new Once()),
    muteRef = useRef(false),
    nextConversations = useRef<string | null>(null),
    nextNotices = useRef<string | null>(null);
  const outbox = useRef(
    new Map<string, { ids: number[]; files: PickedFile[] }>(),
  );
  useEffect(() => {
    rows.current = messages;
    muteRef.current = muted;
  }, [messages, muted]);
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const callAudioActive = useRef(false);
  const setCallAudioActive = useCallback((active: boolean) => {
    callAudioActive.current = active;
    if (active) player.current?.pause();
  }, []);
  const setFocus = useCallback((id: number | null) => {
    focus.current = id;
  }, []);
  const put = useCallback((id: number, incoming: Message[]) => {
    setMessages((old) => {
      const next = { ...old, [id]: mergeMessages(old[id] || [], incoming) };
      rows.current = next;
      return next;
    });
  }, []);
  async function testSound(interactive = true, conversationId?: number) {
    if (callAudioActive.current)
      throw new Error(
        "Message sounds are paused during calls. Test the sound after hanging up.",
      );
    if (Platform.OS === "android") {
      await androidMessageSound(interactive, conversationId);
      return;
    }
    await setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
    });
    if (!player.current)
      player.current = createAudioPlayer(require("../assets/message.wav"));
    player.current.volume = 1;
    await player.current.seekTo(0);
    if (
      !shouldSound({
        active: AppState.currentState === "active",
        inCall: callAudioActive.current,
        muted: muteRef.current,
        focused: focus.current,
        conversation: conversationId,
        test: interactive,
      })
    )
      return;
    player.current.play();
  }
  async function history(id: number, cursor?: string) {
    const generation = epoch.current;
    const page = await api.request<Page<Message>>(
      `conversations/${id}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (generation === epoch.current) put(id, page.data);
    return page.meta?.next_cursor ?? null;
  }
  async function refresh() {
    if (!user) return;
    if (busy.current) return busy.current;
    const generation = epoch.current;
    const task = (async () => {
      await refreshSession();
      const [cs, ns, calls] = await Promise.all([
        api.request<Page<Conversation>>("conversations"),
        api.request<Page<Notice>>("notifications"),
        api.request<Page<Call>>("calls"),
      ]);
      if (generation !== epoch.current) return;
      setConversations((old) => {
        const map = new Map(old.map((c) => [c.id, c]));
        cs.data.forEach((c) => map.set(c.id, c));
        return [...map.values()].sort((a, b) =>
          b.updated_at.localeCompare(a.updated_at),
        );
      });
      nextConversations.current = cs.links?.next ?? null;
      nextNotices.current = ns.next_page_url ?? null;
      ns.data.forEach((n) => alertIds.current.take(String(n.id)));
      setHasMoreConversations(!!nextConversations.current);
      setHasMoreNotices(!!nextNotices.current);
      setNotices((old) => {
        const map = new Map(old.map((n) => [n.id, n]));
        ns.data.forEach((n) => map.set(n.id, n));
        return [...map.values()].sort((a, b) => b.id - a.id);
      });
      await live.current?.conversations([
        ...new Set([
          ...cs.data.map((c) => c.id),
          ...Object.keys(rows.current).map(Number),
        ]),
      ]);
      for (const [id, messages] of Object.entries(rows.current)) {
        await recoverPages<Message>(
          messageHistoryPath(Number(id), messages),
          (path) => api.request(path),
          (incoming) => {
            if (generation === epoch.current) put(Number(id), incoming);
          },
        );
      }
      if (generation !== epoch.current) return;
      for (const call of calls.data.filter((c) => !c.ended_at))
        handlers.current.forEach((h) =>
          h({ event: "v1.call.recovered", data: call }),
        );
      setError("");
    })()
      .catch((e) => {
        if (generation === epoch.current) {
          setError(e.message);
          setConnection("Offline or unavailable · retry");
        }
      })
      .finally(() => {
        if (busy.current === task) busy.current = null;
      });
    busy.current = task;
    return task;
  }
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    const ownedEpoch = ++epoch.current;
    busy.current = null;
    rows.current = {};
    setMessages({});
    setConversations([]);
    setNotices([]);
    alertIds.current = new Once();
    outbox.current.clear();
    focus.current = null;
    if (!user) {
      clearPrivateFiles();
      return;
    }
    let active = true;
    const releaseSoundGate = bindAndroidSoundGate(
      (test, conversation) =>
        active &&
        !!api.token &&
        shouldSound({
          active: AppState.currentState === "active",
          inCall: callAudioActive.current,
          muted: muteRef.current,
          focused: focus.current,
          conversation,
          test,
        }),
    );
    void SecureStore.getItemAsync("relay.mute").then((v) => {
      if (active) setMuted(v === "yes");
    });
    const rt = new Realtime(
      (e) => {
        if (!active) return;
        try {
          const envelope =
            typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          if (envelope.version !== 1) return;
          const event = { event: e.eventName, data: envelope.data };
          if (event.event === "v1.conversation.deleted") {
            const id = (event.data as { conversation_id: number })
              .conversation_id;
            setConversations((old) =>
              old.filter((conversation) => conversation.id !== id),
            );
            setMessages((old) => {
              const next = { ...old };
              delete next[id];
              return next;
            });
          }
          if (event.event === "v1.message.created") {
            const m = event.data as Message;
            if (m.client_id) put(m.conversation_id, [m]);
          }
          if (event.event === "v1.notification.created") {
            const n = event.data as Notice;
            if (
              alertIds.current.take(String(n.id)) &&
              n.kind !== "incoming_call" &&
              AppState.currentState === "active" &&
              focus.current !== n.data.conversation_id &&
              !muteRef.current
            )
              void testSound(false, n.data.conversation_id).catch(() => {});
          }
          handlers.current.forEach((h) => h(event));
          if (!["v1.typing", "v1.call.signal"].includes(event.event))
            void refreshRef.current();
        } catch {
          setError("A live update could not be read. Refresh to reconcile.");
        }
      },
      (state) => {
        if (active) setConnection(state);
      },
      () => {
        if (active) void refreshRef.current();
      },
    );
    live.current = rt;
    void rt.start(user.id).catch((e) => {
      if (active) setError(e.message);
    });
    void refreshRef.current();
    const wake = () => {
      if (active && AppState.currentState === "active") {
        void rt.reconnect(user.id).catch(() => {});
        void refreshRef.current();
      }
    };
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") wake();
      else focus.current = null;
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected) wake();
      else setConnection("Offline");
    });
    const timer = setInterval(wake, 30000);
    return () => {
      active = false;
      releaseSoundGate();
      epoch.current = ownedEpoch + 1;
      clearInterval(timer);
      app.remove();
      network.remove();
      live.current = null;
      void rt.stop();
      player.current?.remove();
      player.current = null;
      clearPrivateFiles();
    };
    // User identity owns the complete socket and cache lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, put]);
  async function moreConversations() {
    if (!nextConversations.current) return;
    const generation = epoch.current;
    const p = await api.request<Page<Conversation>>(nextConversations.current);
    if (generation !== epoch.current) return;
    nextConversations.current = p.links?.next ?? null;
    setHasMoreConversations(!!nextConversations.current);
    setConversations((old) => [
      ...new Map([...old, ...p.data].map((c) => [c.id, c])).values(),
    ]);
    await live.current?.conversations(p.data.map((c) => c.id));
  }
  async function moreNotices() {
    if (!nextNotices.current) return;
    const generation = epoch.current;
    const p = await api.request<Page<Notice>>(nextNotices.current);
    if (generation !== epoch.current) return;
    nextNotices.current = p.next_page_url ?? null;
    setHasMoreNotices(!!nextNotices.current);
    setNotices((old) => [
      ...new Map([...old, ...p.data].map((n) => [n.id, n])).values(),
    ]);
  }
  async function toggleMute() {
    const value = !muted;
    await SecureStore.setItemAsync("relay.mute", value ? "yes" : "no");
    setMuted(value);
  }
  return (
    <Context.Provider
      value={{
        conversations,
        messages,
        notices,
        connection,
        error,
        muted,
        hasMoreConversations,
        hasMoreNotices,
        setFocus,
        refresh,
        history,
        put,
        listen: (handler) => {
          handlers.current.add(handler);
          return () => {
            handlers.current.delete(handler);
          };
        },
        moreConversations,
        moreNotices,
        toggleMute,
        testSound,
        setCallAudioActive,
        markNoticeRead: async (id) => {
          await api.request(`notifications/${id}/read`, "PATCH", {});
          setNotices((old) =>
            old.map((n) =>
              n.id === id ? { ...n, read_at: new Date().toISOString() } : n,
            ),
          );
        },
        staged: (clientId) => outbox.current.get(clientId),
        stage: (clientId, value) => {
          if (value) outbox.current.set(clientId, value);
          else outbox.current.delete(clientId);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useChat = () => useContext(Context);
