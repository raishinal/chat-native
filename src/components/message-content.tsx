import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/lib/api";
import type { Attachment, Message } from "@/lib/contracts";
import { FileAttachment } from "@/components/attachment";
import { Button, Field, styles } from "@/ui";

export function MessageContent({
  message,
  own,
  onChange,
}: {
  message: Message;
  own: boolean;
  onChange(message: Message): void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(message.body ?? "");
  const [confirmation, setConfirmation] = useState<
    "message" | Attachment | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (message.deleted_at) {
      setEditing(false);
      setConfirmation(null);
    }
  }, [message.deleted_at]);

  async function mutate(action: "edit" | "delete", attachment?: Attachment) {
    if (inFlight.current || !own || message.state || message.deleted_at) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const token = api.token;
    try {
      let updated: Message;
      if (attachment) {
        await api.request(`attachments/${attachment.id}`, "DELETE");
        const attachments = message.attachments.filter(
          (a) => a.id !== attachment.id,
        );
        updated = {
          ...message,
          attachments,
          deleted_at:
            !message.body?.trim() && !attachments.length
              ? new Date().toISOString()
              : message.deleted_at,
        };
      } else {
        const result = await api.request<{ data: Message }>(
          `messages/${message.id}`,
          action === "edit" ? "PATCH" : "DELETE",
          action === "edit" ? { body } : undefined,
        );
        updated = result.data;
      }
      if (!mounted.current || api.token !== token) return;
      onChange(updated);
      setEditing(false);
      setConfirmation(null);
    } catch (e) {
      if (mounted.current && api.token === token)
        setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const textColor = own ? "#fff" : "#17283c";
  if (message.deleted_at)
    return (
      <Text
        style={[
          styles.text,
          { color: textColor, fontStyle: "italic", opacity: 0.75 },
        ]}
      >
        Message deleted
      </Text>
    );
  const canManage = own && !message.state;
  return (
    <>
      {editing ? (
        <View style={{ gap: 8 }}>
          <Field
            accessibilityLabel="Edit message"
            placeholder="Edit message"
            multiline
            autoFocus
            maxLength={4000}
            value={body}
            onChangeText={setBody}
            editable={!busy}
            style={{ minHeight: 80, maxHeight: 180 }}
          />
          <View style={styles.row}>
            <Button
              title={busy ? "Saving…" : "Save"}
              icon="check"
              soft
              disabled={busy || (!body.trim() && !message.attachments.length)}
              onPress={() => mutate("edit")}
            />
            <Button
              title="Cancel"
              soft
              disabled={busy}
              onPress={() => {
                setEditing(false);
                setError("");
              }}
            />
          </View>
        </View>
      ) : (
        !!message.body && (
          <Text selectable style={[styles.text, { color: textColor }]}>
            {message.body}
          </Text>
        )
      )}
      {message.attachments.map((attachment) => (
        <View key={attachment.id} style={{ gap: 6 }}>
          <FileAttachment attachment={attachment} />
          {canManage && (
            <Button
              title="Delete file"
              iconOnly
              compact
              icon="trash-2"
              soft
              disabled={busy || editing || confirmation !== null}
              onPress={() => {
                setError("");
                setConfirmation(attachment);
              }}
            />
          )}
        </View>
      ))}
      {!!message.edited_at && (
        <Text style={{ fontSize: 11, color: textColor, opacity: 0.75 }}>
          Edited
        </Text>
      )}
      {canManage && !editing && !confirmation && (
        <View style={styles.row}>
          <Button
            title="Edit"
            iconOnly
            compact
            icon="edit-2"
            soft
            disabled={busy}
            onPress={() => {
              setBody(message.body ?? "");
              setError("");
              setEditing(true);
            }}
          />
          <Button
            title="Delete"
            iconOnly
            compact
            icon="trash-2"
            soft
            disabled={busy}
            onPress={() => {
              setError("");
              setConfirmation("message");
            }}
          />
        </View>
      )}
      {canManage && confirmation && (
        <View style={{ gap: 8 }}>
          <Text
            accessibilityRole="alert"
            style={[styles.text, { color: textColor }]}
          >
            {confirmation === "message"
              ? "Delete this message and its files for everyone?"
              : `Delete “${confirmation.name}” for everyone?`}
          </Text>
          <View style={styles.row}>
            <Button
              title={busy ? "Deleting…" : "Delete for everyone"}
              danger
              icon="trash-2"
              disabled={busy}
              onPress={() =>
                mutate(
                  "delete",
                  confirmation === "message" ? undefined : confirmation,
                )
              }
            />
            <Button
              title="Cancel"
              soft
              disabled={busy}
              onPress={() => {
                setConfirmation(null);
                setError("");
              }}
            />
          </View>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: textColor }}>
          {error}
        </Text>
      )}
    </>
  );
}
