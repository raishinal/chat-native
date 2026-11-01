import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Redirect,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/session";
import { useChat } from "@/chat";
import { useCalls } from "@/calls";
import { api } from "@/lib/api";
import { upload } from "@/lib/files";
import { realtimeConfigured } from "@/lib/realtime";
import type { Conversation, Message, PickedFile } from "@/lib/contracts";
import { MessageContent } from "@/components/message-content";
import Feather from "@expo/vector-icons/Feather";
import { Button, colors, Field, styles } from "@/ui";

export default function ConversationScreen() {
  const insets = useSafeAreaInsets();
  const { id: param } = useLocalSearchParams<{ id: string }>(),
    id = Number(param),
    { user } = useSession(),
    chat = useChat(),
    calls = useCalls();
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [draft, setDraft] = useState(""),
    [files, setFiles] = useState<PickedFile[]>([]),
    [progress, setProgress] = useState<number | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [olderLoading, setOlderLoading] = useState(false),
    [olderError, setOlderError] = useState(false),
    [deleted, setDeleted] = useState(false),
    [typing, setTyping] = useState(0),
    [tick, setTick] = useState(() => Date.now()),
    [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false);
  const abort = useRef<AbortController | null>(null),
    list = useRef<FlatList<Message>>(null),
    followLatest = useRef(true),
    olderInFlight = useRef(false),
    roomId = useRef(id),
    sentTyping = useRef(0),
    focused = useRef(false),
    messages = chat.messages[id] || [],
    historyRef = useRef(chat.history),
    read = useRef(0),
    readAttempt = useRef(0),
    sending = useRef(false);
  useEffect(() => {
    historyRef.current = chat.history;
  });
  const selected = chat.conversations.find((c) => c.id === id) || conversation;
  const setFocus = chat.setFocus;
  useEffect(() => {
    let active = true;
    roomId.current = id;
    read.current = 0;
    followLatest.current = true;
    olderInFlight.current = false;
    setOlderLoading(false);
    setDeleted(false);
    setLoading(true);
    void Promise.all([
      api.request<{ data: Conversation }>(`conversations/${id}`),
      historyRef.current(id),
    ])
      .then(([c, cursor]) => {
        if (active) {
          setConversation(c.data);
          setCursor(cursor);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      roomId.current = -1;
      abort.current?.abort();
    };
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setFocus(id);
      setTick(Date.now());
      const app = AppState.addEventListener("change", (state) => {
        if (state === "active" && focused.current) {
          setFocus(id);
          setTick(Date.now());
        }
      });
      return () => {
        focused.current = false;
        setFocus(null);
        app.remove();
      };
    }, [id, setFocus]),
  );
  const latest = messages.reduce((max, m) => Math.max(max, m.id), 0);
  useEffect(() => {
    if (
      latest > read.current &&
      Date.now() - readAttempt.current > 10000 &&
      focused.current &&
      AppState.currentState === "active"
    ) {
      readAttempt.current = Date.now();
      void api
        .request(`conversations/${id}/read`, "POST", { message_id: latest })
        .then(() => {
          read.current = latest;
        })
        .catch((e) => setError(e.message));
    }
  }, [id, latest, tick]);
  const listenRef = useRef(chat.listen);
  useEffect(() => {
    listenRef.current = chat.listen;
  });
  useEffect(
    () =>
      listenRef.current((e) => {
        if (
          e.event === "v1.conversation.deleted" &&
          (e.data as { conversation_id: number }).conversation_id === id
        )
          setDeleted(true);
        if (e.event === "v1.typing") {
          const d = e.data as {
            conversation_id: number;
            user_id: number;
            expires_at: string;
          };
          if (d.conversation_id === id && d.user_id !== user?.id)
            setTyping(Date.parse(d.expires_at));
        }
      }),
    [id, user?.id],
  );
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);
  async function loadOlder() {
    if (!cursor || loading || query || olderInFlight.current) return;
    const expectedId = id;
    olderInFlight.current = true;
    setOlderLoading(true);
    setOlderError(false);
    try {
      const next = await historyRef.current(id, cursor);
      if (roomId.current === expectedId) setCursor(next);
    } catch (error) {
      if (roomId.current === expectedId) {
        setError((error as Error).message);
        setOlderError(true);
      }
    } finally {
      if (roomId.current === expectedId) {
        olderInFlight.current = false;
        setOlderLoading(false);
      }
    }
  }
  if (!user || deleted) return <Redirect href="/" />;
  function addFiles(incoming: PickedFile[]) {
    setFiles((old) => [...old, ...incoming]);
  }
  async function send(message?: Message) {
    if (!user || sending.current) return;
    const pending: Message = message || {
      id: -1,
      conversation_id: id,
      sender_id: user.id,
      client_id: Crypto.randomUUID(),
      body: draft.trim(),
      attachments: [],
      created_at: new Date().toISOString(),
      state: "sending",
    };
    const previous = chat.staged(pending.client_id);
    const selections = previous?.files || (!message ? files : []);
    if (!pending.body && !selections.length && !pending.attachments.length)
      return;
    // Server remains authoritative for configured quotas; these are its documented defaults.
    if (selections.length > 5)
      throw new Error(
        "The default server limit is 5 attachments per message. Remove files and retry.",
      );
    if (selections.some((f) => (f.size || 0) > 1024 * 1024 * 1024))
      throw new Error("The default server limit is 1 GiB per file.");
    sending.current = true;
    followLatest.current = true;
    const sendToken = api.token;
    chat.stage(
      pending.client_id,
      previous || {
        ids: pending.attachments.map((a) => a.id),
        files: selections,
      },
    );
    chat.put(id, [{ ...pending, state: "sending" }]);
    setError("");
    abort.current = new AbortController();
    if (!message) {
      setDraft("");
      setFiles([]);
    }
    try {
      let attachmentIds = previous?.ids || pending.attachments.map((a) => a.id);
      if (!attachmentIds.length && selections.length) {
        setProgress(0);
        const uploaded = await upload(
          `conversations/${id}/attachments`,
          selections,
          setProgress,
          abort.current.signal,
        );
        attachmentIds = uploaded.map((a) => a.id);
        if (api.token !== sendToken) return;
        chat.stage(pending.client_id, {
          ids: attachmentIds,
          files: selections,
        });
        pending.attachments = uploaded;
      }
      const result = await api.request<{ data: Message }>(
        `conversations/${id}/messages`,
        "POST",
        {
          client_id: pending.client_id,
          body: pending.body || null,
          attachment_ids: attachmentIds,
        },
        abort.current.signal,
      );
      chat.put(id, [result.data]);
      chat.stage(pending.client_id);
      await chat.refresh();
    } catch (e) {
      if (api.token === sendToken) {
        chat.put(id, [{ ...pending, state: "failed" }]);
        setError((e as Error).message);
      }
    } finally {
      sending.current = false;
      setProgress(null);
      abort.current = null;
    }
  }
  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{ title: selected?.peer.name || "Conversation" }}
      />
      <View style={room.header}>
        <View style={room.contactRow}>
          <View style={room.avatar}>
            <Text style={room.initial}>
              {selected?.peer.name?.trim().slice(0, 1).toUpperCase() || "?"}
            </Text>
            <View
              style={[
                room.presence,
                {
                  backgroundColor: selected?.peer.online
                    ? "#22a477"
                    : "#9aa8bb",
                },
              ]}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={room.name}>
              {selected?.peer.name || "Conversation"}
            </Text>
            <Text style={styles.subtitle}>
              {selected?.peer.online
                ? "Online"
                : selected?.peer.last_seen_at
                  ? `Last seen ${new Date(selected.peer.last_seen_at).toLocaleString()}`
                  : "Offline"}{" "}
              · {chat.connection}
            </Text>
          </View>
          <Button
            icon="search"
            iconOnly
            soft
            title={searching ? "Close search" : "Search messages"}
            onPress={() => {
              setSearching(!searching);
              setQuery("");
            }}
          />
          <Button
            icon="phone"
            iconOnly
            soft
            title="Audio call"
            disabled={!realtimeConfigured || selected?.peer.status !== "active"}
            onPress={() => calls.start(id, "audio")}
          />
          <Button
            icon="video"
            iconOnly
            soft
            title="Video call"
            disabled={!realtimeConfigured || selected?.peer.status !== "active"}
            onPress={() => calls.start(id, "video")}
          />
        </View>
        {!realtimeConfigured && (
          <Text style={styles.subtitle}>
            Configure the public Pusher key and cluster to enable calls.
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {searching && (
          <Field
            autoFocus
            placeholder="Search loaded message history"
            value={query}
            onChangeText={setQuery}
          />
        )}
      </View>
      <FlatList
        ref={list}
        onScroll={(event) => {
          followLatest.current = event.nativeEvent.contentOffset.y < 80;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (followLatest.current)
            list.current?.scrollToOffset({ offset: 0, animated: false });
        }}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 80,
        }}
        onEndReached={() => {
          void loadOlder();
        }}
        onEndReachedThreshold={0.3}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: 16, paddingBottom: 22 }}
        data={[...messages]
          .filter(
            (m) =>
              !query ||
              m.body?.toLowerCase().includes(query.toLowerCase()) ||
              m.attachments.some((a) =>
                a.name.toLowerCase().includes(query.toLowerCase()),
              ),
          )
          .reverse()}
        inverted
        keyExtractor={(m) => m.client_id}
        ListEmptyComponent={
          <Text style={styles.subtitle}>
            {loading ? "Loading messages…" : "No messages to display."}
          </Text>
        }
        ListFooterComponent={
          cursor && olderError ? (
            <Button title="Retry earlier messages" onPress={loadOlder} />
          ) : cursor ? (
            <Text style={styles.subtitle}>
              {olderLoading
                ? "Loading earlier messages…"
                : "Scroll up to load earlier messages"}
            </Text>
          ) : error ? (
            <Button
              title="Reload history"
              onPress={async () => {
                setCursor(await chat.history(id));
                setError("");
              }}
            />
          ) : undefined
        }
        renderItem={({ item: m }) => (
          <View
            style={[
              room.bubble,
              m.sender_id === user.id ? room.own : room.theirs,
            ]}
          >
            <MessageContent
              message={m}
              own={m.sender_id === user.id}
              onChange={(updated) => {
                chat.put(updated.conversation_id, [updated]);
                void chat.refresh();
              }}
            />
            <View style={room.metadata}>
              {m.sender_id === user.id && (
                <Feather
                  name={
                    m.state === "failed"
                      ? "alert-circle"
                      : m.state === "sending"
                        ? "clock"
                        : (selected?.peer_read_id || 0) >= m.id
                          ? "check-circle"
                          : "check"
                  }
                  size={12}
                  color="#dbe7ff"
                />
              )}
              <Text
                style={[
                  room.timestamp,
                  m.sender_id === user.id && { color: "#dbe7ff" },
                ]}
              >
                {new Date(m.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                ·{" "}
                {m.state ||
                  (m.sender_id === user.id
                    ? (selected?.peer_read_id || 0) >= m.id
                      ? "Read"
                      : "Sent"
                    : "Received")}
              </Text>
            </View>
            {m.state === "failed" && (
              <Button
                icon="refresh-cw"
                title="Retry message"
                onPress={() => send(m)}
              />
            )}
          </View>
        )}
      />
      <View
        style={[
          room.composer,
          { paddingBottom: Math.max(12, insets.bottom), paddingTop: 5 },
        ]}
      >
        {typing > tick && <Text style={styles.subtitle}>Typing…</Text>}
        {files.map((f, i) => (
          <View key={`${f.uri}-${i}`} style={room.fileChip}>
            <Feather name="file" size={16} color={colors.blue} />
            <Text style={[styles.subtitle, { flex: 1 }]}>{f.name}</Text>
            <Button
              icon="x"
              iconOnly
              soft
              title={`Remove ${f.name}`}
              disabled={progress !== null}
              onPress={() =>
                setFiles((old) => old.filter((_, index) => index !== i))
              }
            />
          </View>
        ))}
        {progress !== null && (
          <View style={styles.row}>
            <Text style={styles.subtitle}>Uploading {progress}%</Text>
            <Button
              icon="x"
              soft
              title="Cancel upload"
              onPress={() => abort.current?.abort()}
            />
          </View>
        )}
        <View style={room.inputShell}>
          <Field
            placeholder="Write a message…"
            value={draft}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              borderWidth: 0,
              backgroundColor: "transparent",
            }}
            maxLength={4000}
            onChangeText={(text) => {
              setDraft(text);
              if (Date.now() - sentTyping.current > 6000) {
                sentTyping.current = Date.now();
                void api
                  .request(`conversations/${id}/typing`, "POST", {})
                  .catch(() => {});
              }
            }}
          />
          <Button
            icon="send"
            iconOnly
            title="Send message"
            disabled={
              progress !== null ||
              (!draft.trim() && !files.length) ||
              selected?.peer.status !== "active"
            }
            onPress={() => send()}
          />
        </View>
        <View style={styles.row}>
          <Button
            icon="paperclip"
            soft
            title="Files"
            disabled={progress !== null}
            onPress={async () => {
              const result = await DocumentPicker.getDocumentAsync({
                multiple: true,
                type: "*/*",
                copyToCacheDirectory: true,
              });
              if (!result.canceled) addFiles(result.assets);
            }}
          />
          <Button
            icon="image"
            soft
            title="Photos / videos"
            disabled={progress !== null}
            onPress={async () => {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images", "videos"],
                allowsMultipleSelection: true,
              });
              if (!result.canceled)
                addFiles(
                  result.assets.map((a) => ({
                    uri: a.uri,
                    name: a.fileName || `media-${Date.now()}`,
                    mimeType: a.mimeType,
                    size: a.fileSize,
                  })),
                );
            }}
          />
        </View>
        {selected?.peer.status !== "active" && (
          <Text style={styles.subtitle}>
            Messaging is unavailable until both accounts are active.
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const room = StyleSheet.create({
  header: {
    padding: 14,
    gap: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e4eaf4",
  },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#e8edff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 3,
  },
  initial: { color: colors.blue, fontSize: 21, fontWeight: "800" },
  presence: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "white",
  },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  bubble: {
    maxWidth: "92%",
    padding: 13,
    borderRadius: 20,
    gap: 8,
    marginVertical: 5,
  },
  own: {
    alignSelf: "flex-end",
    backgroundColor: "#315dd5",
    borderBottomRightRadius: 5,
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: "#e2e8f2",
  },
  metadata: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 5,
  },
  timestamp: { fontSize: 11, color: colors.muted },
  composer: {
    padding: 12,
    gap: 8,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e4eaf4",
  },
  inputShell: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 5,
    borderRadius: 26,
    backgroundColor: "#f1f4fa",
    borderWidth: 1,
    borderColor: "#e4eaf4",
  },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#eef3fd",
    paddingLeft: 12,
    borderRadius: 14,
  },
  typing: { flexDirection: "row", alignItems: "center", gap: 6 },
});
