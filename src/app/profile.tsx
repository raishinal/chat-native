import { useState } from "react";
import { Platform, ScrollView, Text } from "react-native";
import { Redirect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSession } from "@/session";
import { pushEnabled, requestNativeCallSetup } from "@/lib/native-push";
import { api, origin } from "@/lib/api";
import type { PickedFile, User } from "@/lib/contracts";
import { Button, Card, Field, styles } from "@/ui";
export default function Profile() {
  const { user, setUser, logout } = useSession(),
    [name, setName] = useState(user?.name || ""),
    [avatar, setAvatar] = useState<PickedFile | null>(null),
    [callSetupMessage, setCallSetupMessage] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [passwordMessage, setPasswordMessage] = useState("");
  if (!user) return <Redirect href="/" />;
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Your profile</Text>
      <Text style={styles.subtitle}>Server: {origin}</Text>
      {!pushEnabled && (
        <Text style={styles.subtitle}>
          Background message and call alerts are not enabled in this version.
        </Text>
      )}
      {pushEnabled && Platform.OS === "android" && (
        <Card>
          <Text style={styles.subtitle}>
            Enable Relay in your phone’s calling accounts to answer calls from
            the lock screen. You can set this up whenever you’re ready.
          </Text>
          <Button
            title="Set up lock-screen calls"
            onPress={async () => {
              const enabled = await requestNativeCallSetup();
              setCallSetupMessage(
                enabled
                  ? "Lock-screen calls are enabled."
                  : "Enable Relay in calling accounts, then return here. You can also do this later.",
              );
            }}
          />
          {!!callSetupMessage && (
            <Text style={styles.subtitle}>{callSetupMessage}</Text>
          )}
        </Card>
      )}
      <Card>
        <Field
          placeholder="Display name"
          value={name}
          onChangeText={setName}
          maxLength={100}
        />
        <Text style={styles.subtitle}>
          {avatar?.name || "Avatar: JPEG, PNG or WebP, up to 2 MiB"}
        </Text>
        <Button
          title="Choose avatar"
          onPress={async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsEditing: true,
              quality: 0.8,
            });
            if (!result.canceled) {
              const a = result.assets[0];
              if ((a.fileSize || 0) > 2 * 1024 * 1024)
                throw new Error("Avatar must be at most 2 MiB.");
              setAvatar({
                uri: a.uri,
                name: a.fileName || "avatar.jpg",
                mimeType: a.mimeType || "image/jpeg",
              });
            }
          }}
        />
        <Button
          title="Save profile"
          onPress={async () => {
            const form = new FormData();
            form.append("name", name);
            if (avatar)
              form.append("avatar", {
                uri: avatar.uri,
                name: avatar.name,
                type: avatar.mimeType,
              } as unknown as Blob);
            const result = await api.request<{ data: User }>(
              "profile",
              "POST",
              form,
            );
            setUser(result.data);
            setAvatar(null);
          }}
        />
      </Card>
      <Card>
        <Text style={styles.title}>Change password</Text>
        <Field
          accessibilityLabel="Current password"
          placeholder="Current password"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={currentPassword}
          onChangeText={setCurrentPassword}
        />
        <Field
          accessibilityLabel="New password"
          placeholder="New password (at least 8 characters)"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={password}
          onChangeText={setPassword}
        />
        <Field
          accessibilityLabel="Confirm new password"
          placeholder="Confirm new password"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={confirmation}
          onChangeText={setConfirmation}
        />
        <Text style={styles.subtitle}>
          Other devices will be signed out. This device stays signed in.
        </Text>
        <Button
          title="Change password"
          disabled={
            !currentPassword || password.length < 8 || password !== confirmation
          }
          onPress={async () => {
            setPasswordMessage("");
            try {
              const result = await api.request<{ message: string }>(
                "profile/password",
                "PUT",
                {
                  current_password: currentPassword,
                  password,
                  password_confirmation: confirmation,
                },
              );
              setPasswordMessage(result.message);
            } finally {
              setCurrentPassword("");
              setPassword("");
              setConfirmation("");
            }
          }}
        />
        {!!passwordMessage && (
          <Text accessibilityRole="alert" style={styles.text}>
            {passwordMessage}
          </Text>
        )}
      </Card>
      <Button title="Sign out and revoke this token" danger onPress={logout} />
      <Text style={styles.subtitle}>
        Signing out requires a server connection so this device’s token can be
        revoked. Retry if you are offline.
      </Text>
    </ScrollView>
  );
}
