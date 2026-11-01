import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/session";
import { ChatProvider } from "@/chat";
import { CallProvider } from "@/calls";
import { PushRegistration } from "@/push";
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PushRegistration />
        <ChatProvider>
          <CallProvider>
            <Navigator />
          </CallProvider>
        </ChatProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const { user } = useSession();
  return (
    <Stack
      key={user?.id ?? "guest"}
      screenOptions={{
        headerStyle: { backgroundColor: "#f2f5fa" },
        headerTintColor: "#17283c",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#f2f5fa" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Relay", headerShown: false }}
      />
      <Stack.Screen
        name="conversation/[id]"
        options={{ title: "Conversation" }}
      />
      <Stack.Screen name="people" options={{ title: "New conversation" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="profile" options={{ title: "Your profile" }} />
      <Stack.Screen name="admin" options={{ title: "Administration" }} />
      <Stack.Screen name="account" options={{ title: "Account access" }} />
    </Stack>
  );
}
