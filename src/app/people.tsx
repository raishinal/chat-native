import { useEffect, useState } from "react";
import { FlatList, Text } from "react-native";
import { Redirect, router } from "expo-router";
import { useSession } from "@/session";
import { api } from "@/lib/api";
import type { Conversation, Page, User } from "@/lib/contracts";
import { Button, Card, Field, styles } from "@/ui";
export default function People() {
  const { user } = useSession(),
    [query, setQuery] = useState(""),
    [people, setPeople] = useState<User[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void api
        .request<Page<User>>(
          `users?q=${encodeURIComponent(query)}`,
          "GET",
          undefined,
          abort.signal,
        )
        .then((p) => {
          setPeople(p.data);
          setNext(p.links?.next || null);
          setError("");
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);
  if (!user) return <Redirect href="/" />;
  async function more() {
    if (!next) return;
    const p = await api.request<Page<User>>(next);
    setPeople((old) => [
      ...new Map([...old, ...p.data].map((u) => [u.id, u])).values(),
    ]);
    setNext(p.links?.next || null);
  }
  return (
    <FlatList
      style={styles.page}
      contentContainerStyle={styles.content}
      data={people}
      keyExtractor={(u) => String(u.id)}
      ListHeaderComponent={
        <>
          <Field
            placeholder="Search people"
            value={query}
            onChangeText={setQuery}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
        </>
      }
      ListEmptyComponent={
        <Text style={styles.subtitle}>
          {loading ? "Searching…" : "No people found."}
        </Text>
      }
      ListFooterComponent={
        next ? <Button title="More people" onPress={more} /> : undefined
      }
      renderItem={({ item }) => (
        <Card>
          <Text style={styles.text}>{item.name}</Text>
          <Text style={styles.subtitle}>
            {item.online ? "Online" : "Offline"}
          </Text>
          <Button
            title="Start conversation"
            onPress={async () => {
              const c = await api.request<{ data: Conversation }>(
                "conversations",
                "POST",
                { user_id: item.id },
              );
              router.replace(`/conversation/${c.data.id}`);
            }}
          />
        </Card>
      )}
    />
  );
}
