import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useSession } from "@/session";
import { api } from "@/lib/api";
import type { User } from "@/lib/contracts";
import { Button, Card, Field, styles } from "@/ui";
type AdminUser = User & { email: string; updated_at?: string };
type Data = {
  metrics: Record<string, number>;
  users: {
    data: AdminUser[];
    next_page_url: string | null;
    prev_page_url: string | null;
  };
};
type Audit = {
  data: {
    id: number;
    actor_id: number;
    subject_id: number;
    action: string;
    created_at: string;
  }[];
  next_page_url: string | null;
  prev_page_url: string | null;
};
function UserEditor({
  initial,
  reload,
  selfId,
}: {
  initial: AdminUser;
  selfId: number;
  reload(): Promise<void>;
}) {
  const [name, setName] = useState(initial.name),
    [email, setEmail] = useState(initial.email),
    [role, setRole] = useState(initial.role),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [deleteEmail, setDeleteEmail] = useState("");
  async function save(status?: string) {
    try {
      await api.request(`admin/users/${initial.id}`, "PATCH", {
        name,
        email,
        role,
        ...(status
          ? { status }
          : initial.status === "pending"
            ? { status: "active" }
            : {}),
        ...(password ? { password, password_confirmation: confirmation } : {}),
      });
      await reload();
    } finally {
      setPassword("");
      setConfirmation("");
    }
  }
  return (
    <Card>
      <Text style={styles.text}>
        #{initial.id} · {initial.status}
      </Text>
      <Field placeholder="Name" value={name} onChangeText={setName} />
      <Field
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Field
        placeholder="New password (blank keeps current)"
        secureTextEntry
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
      />
      <Field
        placeholder="Confirm new password"
        secureTextEntry
        autoCapitalize="none"
        value={confirmation}
        onChangeText={setConfirmation}
      />
      <Text style={styles.subtitle}>
        A password change signs this user out on all devices.
      </Text>
      <View style={styles.row}>
        <Button
          title={`Role: ${role} (change)`}
          onPress={() => setRole(role === "admin" ? "user" : "admin")}
        />
        <Button title="Save account" onPress={() => save()} />
        {initial.status !== "pending" && (
          <Button
            title={initial.status === "suspended" ? "Reactivate" : "Suspend"}
            danger={initial.status !== "suspended"}
            onPress={() =>
              new Promise<void>((resolve) =>
                Alert.alert(
                  "Confirm account change",
                  `${initial.status === "suspended" ? "Reactivate" : "Suspend"} ${initial.name}?`,
                  [
                    { text: "Cancel", style: "cancel", onPress: resolve },
                    {
                      text: "Confirm",
                      onPress: () => {
                        void save(
                          initial.status === "suspended"
                            ? "active"
                            : "suspended",
                        )
                          .catch((e) => Alert.alert("Relay", e.message))
                          .finally(resolve);
                      },
                    },
                  ],
                ),
              )
            }
          />
        )}
      </View>
      {initial.id !== selfId && (
        <>
          <Text style={styles.subtitle}>
            Permanent deletion removes shared conversations, messages and files
            for both participants. Type this account’s email to enable deletion.
          </Text>
          <Field
            placeholder={initial.email}
            autoCapitalize="none"
            value={deleteEmail}
            onChangeText={setDeleteEmail}
          />
          <Button
            title="Delete permanently"
            danger
            disabled={deleteEmail !== initial.email}
            onPress={() =>
              new Promise<void>((resolve) =>
                Alert.alert(
                  "Delete permanently?",
                  `Delete ${initial.email} and all shared chat history and files? This cannot be undone.`,
                  [
                    { text: "Cancel", style: "cancel", onPress: resolve },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => {
                        void api
                          .request(`admin/users/${initial.id}`, "DELETE", {
                            confirmation: deleteEmail,
                          })
                          .then(reload)
                          .catch((error) => Alert.alert("Relay", error.message))
                          .finally(resolve);
                      },
                    },
                  ],
                ),
              )
            }
          />
        </>
      )}
    </Card>
  );
}
export default function Admin() {
  const { user } = useSession(),
    [query, setQuery] = useState(""),
    [data, setData] = useState<Data | null>(null),
    [audit, setAudit] = useState<Audit | null>(null),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<"admin" | "user">("user"),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  async function load(path = `admin/users?q=${encodeURIComponent(query)}`) {
    const result = await api.request<Data>(path);
    setData(result);
    setError("");
  }
  useEffect(() => {
    if (user?.role !== "admin") return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void api
        .request<Data>(
          `admin/users?q=${encodeURIComponent(query)}`,
          "GET",
          undefined,
          abort.signal,
        )
        .then(setData)
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, user?.role]);
  if (user?.role !== "admin") return <Redirect href="/" />;
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Workspace administration</Text>
      <Text style={styles.subtitle}>
        Private conversations and attachments remain restricted to their
        participants.
      </Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button title="Refresh" onPress={() => load()} />
      <Card>
        <Text style={styles.text}>Workspace metrics</Text>
        {data ? (
          Object.entries(data.metrics).map(([key, value]) => (
            <Text key={key} style={styles.subtitle}>
              {key.replaceAll("_", " ")}: {value.toLocaleString()}
            </Text>
          ))
        ) : (
          <Text style={styles.subtitle}>Loading…</Text>
        )}
      </Card>
      <Card>
        <Text style={styles.text}>Create user</Text>
        <Field placeholder="Name" value={name} onChangeText={setName} />
        <Field
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          placeholder="Password (at least 8 characters)"
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
        />
        <Field
          placeholder="Confirm password"
          secureTextEntry
          autoCapitalize="none"
          value={confirmation}
          onChangeText={setConfirmation}
        />
        <Button
          title={`Role: ${role} (change)`}
          onPress={() => setRole(role === "admin" ? "user" : "admin")}
        />
        <Button
          title="Create user"
          onPress={async () => {
            try {
              await api.request("admin/users", "POST", {
                name,
                email,
                role,
                password,
                password_confirmation: confirmation,
              });
              setName("");
              setEmail("");
              await load();
            } finally {
              setPassword("");
              setConfirmation("");
            }
          }}
        />
      </Card>
      <Field
        placeholder="Search accounts by name or email"
        value={query}
        onChangeText={setQuery}
      />
      {data?.users.data.map((u) => (
        <UserEditor
          key={`${u.id}-${u.status}-${u.updated_at || ""}`}
          initial={u}
          selfId={user.id}
          reload={() => load()}
        />
      ))}
      {data && (
        <View style={styles.row}>
          <Button
            title="Previous users"
            disabled={!data.users.prev_page_url}
            onPress={() => load(data.users.prev_page_url!)}
          />
          <Button
            title="Next users"
            disabled={!data.users.next_page_url}
            onPress={() => load(data.users.next_page_url!)}
          />
        </View>
      )}
      <Button
        title="Load audit history"
        onPress={async () => setAudit(await api.request<Audit>("admin/audit"))}
      />
      {audit?.data.map((a) => (
        <Card key={a.id}>
          <Text style={styles.text}>{a.action}</Text>
          <Text style={styles.subtitle}>
            Actor #{a.actor_id} · Member #{a.subject_id} ·{" "}
            {new Date(a.created_at).toLocaleString()}
          </Text>
        </Card>
      ))}
      {audit && (
        <View style={styles.row}>
          <Button
            title="Previous audit page"
            disabled={!audit.prev_page_url}
            onPress={async () =>
              setAudit(await api.request<Audit>(audit.prev_page_url!))
            }
          />
          <Button
            title="Next audit page"
            disabled={!audit.next_page_url}
            onPress={async () =>
              setAudit(await api.request<Audit>(audit.next_page_url!))
            }
          />
        </View>
      )}
      <Text style={styles.subtitle}>
        The server protects the last active administrator. Created users can
        sign in immediately with their assigned password.
      </Text>
    </ScrollView>
  );
}
