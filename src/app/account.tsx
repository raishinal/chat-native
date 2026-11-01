import { api } from "@/lib/api";
import { Button, Card, Field, styles } from "@/ui";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
export default function Account() {
  const params = useLocalSearchParams<{
    token?: string;
    invitation?: string;
    email?: string;
  }>();
  const [email, setEmail] = useState(params.email || ""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [message, setMessage] = useState("");
  const invite = !!params.invitation,
    reset = !!params.token;
  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          {invite
            ? "Accept invitation"
            : reset
              ? "Reset password"
              : "Forgot password"}
        </Text>
        <Card>
          {!invite && (
            <Field
              placeholder="Email address"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          )}
          {reset && (
            <>
              <Field
                placeholder="New password (8 characters minimum)"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <Field
                placeholder="Confirm password"
                secureTextEntry
                value={confirmation}
                onChangeText={setConfirmation}
              />
            </>
          )}
          <Button
            title={
              invite
                ? "Activate account"
                : reset
                  ? "Reset password"
                  : "Send reset email"
            }
            onPress={async () => {
              const path = invite
                ? `invitations/${encodeURIComponent(params.invitation!)}/accept`
                : reset
                  ? "reset-password"
                  : "forgot-password";
              const result = await api.request<{ message: string }>(
                path,
                "POST",
                {
                  email,
                  token: params.token,
                  password,
                  password_confirmation: confirmation,
                },
              );
              setMessage(result.message);
              setPassword("");
              setConfirmation("");
            }}
          />
        </Card>
        {!!message && <Text style={styles.text}>{message}</Text>}
        <Button title="Back to sign in" onPress={() => router.replace("/")} />
        <Text style={styles.subtitle}>
          Membership remains controlled by the server. Return to Sign in after
          accepting an invitation or resetting your password.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
