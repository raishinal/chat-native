import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { File } from "expo-file-system";
import { useAudioPlayer } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Sharing from "expo-sharing";
import { download } from "@/lib/files";
import { api } from "@/lib/api";
import { saveAttachment } from "@/lib/save-attachment";
import type { Attachment } from "@/lib/contracts";
import { Button, Card, colors, styles } from "@/ui";
function Video({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  const view = useRef<VideoView>(null);
  return (
    <>
      <VideoView
        ref={view}
        player={player}
        nativeControls
        fullscreenOptions={{ enable: true }}
        contentFit="contain"
        style={{ width: "100%", height: 200 }}
      />
      <Button
        icon="maximize"
        iconOnly
        soft
        title="View video full screen"
        onPress={() => view.current?.enterFullscreen()}
      />
    </>
  );
}
function ImagePreview({
  uri,
  name,
  onError,
}: {
  uri: string;
  name: string;
  onError(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name} full screen`}
        onPress={() => setExpanded(true)}
      >
        <Image
          accessibilityLabel={name}
          source={{ uri }}
          resizeMode="contain"
          style={{ width: "100%", height: 200 }}
          onError={onError}
        />
      </Pressable>
      <Modal
        visible={expanded}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setExpanded(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
          <View style={{ alignItems: "flex-end", padding: 12 }}>
            <Button
              icon="x"
              iconOnly
              title="Close image preview"
              onPress={() => setExpanded(false)}
            />
          </View>
          <Image
            accessibilityLabel={name}
            source={{ uri }}
            resizeMode="contain"
            style={{ flex: 1, width: "100%" }}
            onError={onError}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
function Audio({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  return (
    <>
      <Button
        icon="play"
        soft
        title="Play audio"
        onPress={() => player.play()}
      />
      <Button
        icon="pause"
        soft
        title="Pause audio"
        onPress={() => player.pause()}
      />
    </>
  );
}
export function FileAttachment({ attachment: a }: { attachment: Attachment }) {
  const [uri, setUri] = useState<string | null>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [saved, setSaved] = useState(false);
  const token = api.token;
  const previewable = a.previewable && /^(image|video|audio)\//.test(a.mime);
  const localFile = useMemo(() => {
    let cached: string | null = null;
    let pending: Promise<string> | null = null;
    return async () => {
      if (api.token !== token) throw new Error("Session changed.");
      if (cached && new File(cached).exists) return cached;
      // Preview, Save and Share reuse the same authenticated fetch.
      pending ||= download({ name: a.name, download_url: a.download_url })
        .then((local) => {
          cached = local;
          return local;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    };
  }, [a.name, a.download_url, token]);
  useEffect(() => {
    let active = true;
    setUri(null);
    setError("");
    setSaved(false);
    if (previewable)
      void localFile()
        .then((local) => {
          if (active) setUri(local);
        })
        .catch(() => {
          if (active)
            setError(
              "Preview unavailable. You can still download or share this file.",
            );
        });
    return () => {
      active = false;
    };
  }, [localFile, previewable]);
  return (
    <Card>
      <Text style={styles.text}>{a.name}</Text>
      <Text style={styles.subtitle}>
        {a.mime} · {(a.size / 1024).toFixed(1)} KB
      </Text>
      {uri &&
        previewable &&
        !error &&
        (a.mime.startsWith("image/") ? (
          <ImagePreview
            name={a.name}
            uri={uri}
            onError={() =>
              setError("Preview unavailable. Download or share the file.")
            }
          />
        ) : a.mime.startsWith("video/") ? (
          <Video uri={uri} />
        ) : a.mime.startsWith("audio/") ? (
          <Audio uri={uri} />
        ) : null)}
      {previewable && !uri && !error && (
        <View
          accessibilityLabel="Loading attachment preview"
          style={{
            minHeight: a.mime.startsWith("audio/") ? 60 : 180,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            backgroundColor: "#f2f5fa",
            borderRadius: 12,
          }}
        >
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.subtitle}>Loading preview…</Text>
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.row}>
        <Button
          icon="download"
          iconOnly
          soft
          title="Download"
          disabled={working}
          onPress={async () => {
            setWorking(true);
            setSaved(false);
            try {
              setSaved(await saveAttachment(a, localFile));
            } finally {
              setWorking(false);
            }
          }}
        />
        <Button
          icon="share-2"
          iconOnly
          soft
          title="Share"
          disabled={working}
          onPress={async () => {
            setWorking(true);
            const token = api.token;
            try {
              if (!(await Sharing.isAvailableAsync()))
                throw new Error("Sharing is unavailable on this device.");
              const local = await localFile();
              if (api.token !== token) throw new Error("Session changed.");
              await Sharing.shareAsync(local, {
                mimeType: a.mime,
                dialogTitle: a.name,
              });
            } finally {
              setWorking(false);
            }
          }}
        />
      </View>
      {saved && (
        <Text accessibilityLiveRegion="polite" style={styles.badge}>
          Saved to your selected location
        </Text>
      )}
    </Card>
  );
}
