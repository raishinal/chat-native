import { useState } from "react";
import Feather from "@expo/vector-icons/Feather";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from "react-native";
export const colors = {
  bg: "#f2f5fa",
  ink: "#17283c",
  muted: "#65758a",
  blue: "#245edb",
  border: "#dce3ed",
  red: "#b72b42",
};
export function Button({
  title,
  onPress,
  disabled,
  danger = false,
  icon,
  iconOnly = false,
  compact = false,
  soft = false,
}: {
  title: string;
  onPress(): void | Promise<unknown>;
  disabled?: boolean;
  danger?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
  iconOnly?: boolean;
  compact?: boolean;
  soft?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={iconOnly ? title : undefined}
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      hitSlop={compact ? 6 : undefined}
      style={[
        styles.button,
        { flexDirection: "row", gap: 8 },
        soft && { backgroundColor: "#e9effb" },
        iconOnly && {
          width: 44,
          height: 44,
          paddingHorizontal: 0,
          borderRadius: 22,
        },
        iconOnly && compact && {
          width: 32,
          height: 32,
          minHeight: 32,
          paddingVertical: 0,
          borderRadius: 16,
        },
        danger && { backgroundColor: colors.red },
        (disabled || busy) && { opacity: 0.45 },
      ]}
      onPress={() => {
        setBusy(true);
        Promise.resolve()
          .then(onPress)
          .catch((e) => Alert.alert("Relay", e.message || "Please retry."))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? (
        <ActivityIndicator color="white" />
      ) : (
        <>
          {icon && (
            <Feather
              name={icon}
              size={compact ? 15 : 19}
              color={soft && !danger ? colors.blue : "white"}
            />
          )}
          {!iconOnly && (
            <Text
              style={[
                styles.buttonText,
                soft && !danger && { color: colors.blue },
              ]}
            >
              {title}
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}
export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      accessibilityLabel={props.placeholder}
      {...props}
      style={[styles.field, props.style]}
    />
  );
}
export function Card(props: ViewProps) {
  return <View {...props} style={[styles.card, props.style]} />;
}
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 18, gap: 12, paddingBottom: 40 },
  title: { color: colors.ink, fontSize: 28, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  text: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  button: {
    minHeight: 44,
    backgroundColor: colors.blue,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  field: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: "#fff",
    color: colors.ink,
    padding: 12,
    fontSize: 16,
  },
  error: { color: colors.red, lineHeight: 21 },
  badge: { color: colors.blue, fontWeight: "700" },
  bubble: {
    maxWidth: "90%",
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#fff",
    gap: 8,
    marginVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  own: { alignSelf: "flex-end", backgroundColor: "#e5edff" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#dce8ff",
  },
  banner: {
    padding: 10,
    backgroundColor: "#e3eafb",
    color: colors.ink,
    fontSize: 12,
  },
});
