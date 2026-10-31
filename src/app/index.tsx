import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useSession } from "@/session";
import { useChat } from "@/chat";
import { api, protectedUrl } from "@/lib/api";
import { Button, Card, Field, styles } from "@/ui";
export default function Home() {
  const { user, ready, error, login, refresh: refreshSession } = useSession(),
    chat = useChat();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [query, setQuery] = useState("");
  if (!ready)
    return (
      <SafeAreaView style={styles.page}>
        <ActivityIndicator accessibilityLabel="Restoring session" />
      </SafeAreaView>
    );
  if (!user)
    return (
      <SafeAreaView style={styles.page}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={[styles.content, { paddingTop: 60 }]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.badge}>PRIVATE CONVERSATIONS</Text>
            <Text style={[styles.title, { fontSize: 44 }]}>
              Welcome to Relay.
            </Text>
            <Text style={styles.subtitle}>
              A quiet space for your team to stay connected.
            </Text>
            <Card>
              <Text style={styles.text}>Sign in to your account</Text>
              <Field
                placeholder="Email address"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <Field
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
              />
              <Button
                title="Sign in"
                onPress={() => login(email.trim(), password)}
              />
              <Button
                title="Forgot password"
                onPress={() => router.push("/account")}
              />
            </Card>
            {!!error && <Text style={styles.error}>{error}</Text>}
            {!!error && api.token && (
              <Button title="Retry saved session" onPress={refreshSession} />
            )}
            <Text style={styles.subtitle}>
              Accounts are created by an administrator. Contact yours for
              access.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  const visible = chat.conversations.filter(
    (c) =>
      c.peer.name.toLowerCase().includes(query.toLowerCase()) ||
      c.latest_message?.body?.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
      <FlatList
        data={visible}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.content}
        refreshing={false}
        onRefresh={chat.refresh}
        ListFooterComponent={
          chat.hasMoreConversations ? (
            <Button
              title="Load more conversations"
              onPress={chat.moreConversations}
            />
          ) : undefined
        }
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View style={styles.row}>
              <Text style={[styles.title, { flex: 1 }]}>Relay</Text>
              <Button title="New chat" onPress={() => router.push("/people")} />
            </View>
            <Text style={styles.subtitle}>Hello, {user.name}</Text>
            <View style={styles.row}>
              <Button
                title={`Notifications${chat.notices.some((n) => !n.read_at) ? " •" : ""}`}
                onPress={() => router.push("/notifications")}
              />
              <Button title="Profile" onPress={() => router.push("/profile")} />
              {user.role === "admin" && (
                <Button title="Admin" onPress={() => router.push("/admin")} />
              )}
            </View>
            <Text style={styles.banner}>{chat.connection}</Text>
            {!!chat.error && (
              <>
                <Text style={styles.error}>{chat.error}</Text>
                <Button title="Retry connection" onPress={chat.refresh} />
              </>
            )}
            <Field
              placeholder="Search loaded chats and latest messages"
              value={query}
              onChangeText={setQuery}
            />
            <Text style={styles.subtitle}>CONVERSATIONS</Text>
          </View>
        }
        ListEmptyComponent={
          <Card>
            <Text style={styles.subtitle}>
              No conversations yet. Start a new chat.
            </Text>
          </Card>
        }
        renderItem={({ item: c }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Chat with ${c.peer.name}, ${c.unread_count} unread`}
            onPress={() => router.push(`/conversation/${c.id}`)}
            style={{ marginVertical: 5 }}
          >
            <Card>
              <View style={styles.row}>
                {c.peer.avatar_url ? (
                  <Image
                    style={styles.avatar}
                    source={{
                      uri: protectedUrl(c.peer.avatar_url),
                      headers: { Authorization: `Bearer ${api.token}` },
                    }}
                  />
                ) : (
                  <View
                    style={[
                      styles.avatar,
                      { alignItems: "center", justifyContent: "center" },
                    ]}
                  >
                    <Text style={styles.badge}>{c.peer.name.slice(0, 1)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.text, { fontWeight: "700" }]}>
                    {c.peer.name}
                  </Text>
                  <Text style={styles.subtitle}>
                    {c.peer.online
                      ? "Online"
                      : c.peer.last_seen_at
                        ? `Seen ${new Date(c.peer.last_seen_at).toLocaleString()}`
                        : "Offline"}
                  </Text>
                </View>
                {c.unread_count > 0 && (
                  <Text style={styles.badge}>{c.unread_count}</Text>
                )}
              </View>
              <Text numberOfLines={2} style={styles.subtitle}>
                {(c.latest_message?.deleted_at
                  ? "Message deleted"
                  : c.latest_message?.body) ||
                  (c.latest_message?.attachments.length
                    ? "Attachment"
                    : "Say hello")}
              </Text>
            </Card>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
