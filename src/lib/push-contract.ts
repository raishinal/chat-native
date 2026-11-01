export function callUUID(id: number) {
  return `00000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`;
}

export function callIdFromUUID(uuid: string) {
  if (!/^00000000-0000-4000-8000-[0-9a-f]{12}$/i.test(uuid)) return null;
  const id = Number.parseInt(uuid.slice(-12), 16);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function liveIncoming(data: Record<string, unknown>, now = Date.now()) {
  return (
    data.status === "ringing" &&
    (!data.ended_at || data.ended_at === "null") &&
    Date.parse(String(data.expires_at)) > now
  );
}
