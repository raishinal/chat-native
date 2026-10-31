import { FlatList, Linking, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useSession } from "@/session";
import { useChat } from "@/chat";
import { Button, Card, styles } from "@/ui";
export default function Notifications() {
  const { user } = useSession(),
    chat = useChat();
  if (!user) return <Redirect href="/" />;
  return (
    <FlatList
      style={styles.page}
      contentContainerStyle={styles.content}
      data={chat.notices}
      keyExtractor={(n) => String(n.id)}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <Text style={styles.subtitle}>
            Alerts work while Relay is open. Test sound enables sound permission
            on Android. System sound settings apply.
          </Text>
          <View style={styles.row}>
            <Button
              title={chat.muted ? "Unmute message sound" : "Mute message sound"}
              onPress={chat.toggleMute}
            />
            <Button title="Test sound" onPress={chat.testSound} />
            <Button
              title="Device settings"
              onPress={() => Linking.openSettings()}
            />
            <Button title="Refresh" onPress={chat.refresh} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.subtitle}>You’re all caught up.</Text>
      }
      ListFooterComponent={
        chat.hasMoreNotices ? (
          <Button title="Load more notifications" onPress={chat.moreNotices} />
        ) : undefined
      }
      renderItem={({ item: n }) => (
        <Card>
          <Text style={styles.text}>
            {n.data.sender_name || "Relay"} · {n.kind.replaceAll("_", " ")}
          </Text>
          <Text style={styles.subtitle}>
            {new Date(n.created_at).toLocaleString()} ·{" "}
            {n.read_at ? "Read" : "Unread"}
          </Text>
          <View style={styles.row}>
            <Button
              title="Open conversation"
              onPress={async () => {
                await chat.markNoticeRead(n.id);
                await chat.refresh();
                router.push(`/conversation/${n.data.conversation_id}`);
              }}
            />
            {!n.read_at && (
              <Button
                title="Mark read"
                onPress={async () => {
                  await chat.markNoticeRead(n.id);
                  await chat.refresh();
                }}
              />
            )}
          </View>
        </Card>
      )}
    />
  );
}
