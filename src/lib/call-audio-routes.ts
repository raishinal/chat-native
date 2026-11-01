export type CallAudioRoute = {
  id: string;
  label: string;
  kind: "phone" | "speaker" | "headset" | "bluetooth";
  selected: boolean;
};

const androidRoutes: Record<string, Pick<CallAudioRoute, "label" | "kind">> = {
  EARPIECE: { label: "Phone", kind: "phone" },
  SPEAKER_PHONE: { label: "Speaker", kind: "speaker" },
  WIRED_HEADSET: { label: "Headset", kind: "headset" },
  BLUETOOTH: { label: "Bluetooth earbuds", kind: "bluetooth" },
};

export function parseAndroidCallRoutes(event: {
  availableAudioDeviceList?: unknown;
  selectedAudioDevice?: unknown;
}): CallAudioRoute[] {
  let devices = event.availableAudioDeviceList;
  if (typeof devices === "string") {
    try {
      devices = JSON.parse(devices);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(devices)) return [];
  return Object.entries(androidRoutes)
    .filter(([id]) => devices.includes(id))
    .map(([id, route]) => ({
      id,
      ...route,
      selected: event.selectedAudioDevice === id,
    }));
}
