import { useState } from "react";
import { Alert, Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import type { Message } from "@/lib/contracts";
import { Button, Field, styles } from "@/ui";

export function MessageActions({
  message,
  onChange,
}: {
  message: Message;
  onChange(message: Message): void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <>
      <View style={styles.row}>
        <Button
          icon="edit-2"
          iconOnly
          compact
          soft
          title="Edit message"
          onPress={() => {
            setBody(message.body || "");
            setEditing(true);
          }}
        />
        <Button
          icon="trash-2"
          iconOnly
          compact
          danger
          title="Delete message"
          onPress={() => {
            Alert.alert(
              "Delete message?",
              "This removes the message and its attachments for everyone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => {
                    void api
                      .request<{ data: Message }>(
                        `messages/${message.id}`,
                        "DELETE",
                      )
                      .then(({ data }) => onChange(data))
                      .catch((e) =>
                        Alert.alert("Could not delete message", e.message),
                      );
                  },
                },
              ],
            );
          }}
        />
      </View>
      <Modal
        visible={editing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!saving) setEditing(false);
        }}
      >
        <SafeAreaView style={styles.page}>
          <View style={styles.content}>
            <Text style={styles.title}>Edit message</Text>
            <Field
              accessibilityLabel="Message text"
              multiline
              value={body}
              onChangeText={setBody}
              editable={!saving}
              style={{ minHeight: 120 }}
            />
            <View style={styles.row}>
              <Button
                title="Cancel"
                soft
                disabled={saving}
                onPress={() => setEditing(false)}
              />
              <Button
                title="Save"
                disabled={
                  saving || (!body.trim() && !message.attachments.length)
                }
                onPress={async () => {
                  setSaving(true);
                  try {
                    const { data } = await api.request<{ data: Message }>(
                      `messages/${message.id}`,
                      "PATCH",
                      { body: body.trim() || null },
                    );
                    onChange(data);
                    setEditing(false);
                  } finally {
                    setSaving(false);
                  }
                }}
              />
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
