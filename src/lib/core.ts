import type { Message } from "./contracts.ts";

export function callSeconds(
  start: string | number | null,
  end: string | null,
  now = Date.now(),
): number {
  const from = typeof start === "string" ? Date.parse(start) : start;
  const to = end ? Date.parse(end) : now;
  return from !== null && Number.isFinite(from) && Number.isFinite(to)
    ? Math.max(0, Math.floor((to - from) / 1000))
    : 0;
}

export function shouldSound({
  active,
  inCall,
  muted,
  focused,
  conversation,
  test = false,
}: {
  active: boolean;
  inCall: boolean;
  muted: boolean;
  focused: number | null;
  conversation?: number;
  test?: boolean;
}) {
  return active && !inCall && (test || (!muted && focused !== conversation));
}

/** Canonical server rows replace optimistic UUIDs, including sender echoes. */
export function mergeMessages(old: Message[], incoming: Message[]): Message[] {
  const result = [...old];
  for (const message of incoming) {
    const index = result.findIndex(
      (m) =>
        (m.id > 0 && m.id === message.id) ||
        (m.sender_id === message.sender_id &&
          m.client_id === message.client_id),
    );
    if (index < 0) result.push(message);
    else if (!(message.state && !result[index].state)) result[index] = message;
  }
  return result.sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
  );
}

/** Revisit every loaded server row so reconnects recover edits and tombstones too. */
export function messageHistoryPath(id: number, messages: Message[]): string {
  const canonical = messages.filter((m) => m.id > 0 && !m.state);
  const oldest = canonical.reduce((min, m) => Math.min(min, m.id), Infinity);
  return `conversations/${id}/messages${Number.isFinite(oldest) ? `?after_id=${Math.max(0, oldest - 1)}` : ""}`;
}

export class Once {
  private ids = new Set<string>();
  take(id: string) {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > 2000) this.ids.delete(this.ids.values().next().value!);
    return true;
  }
}

export type Signal = {
  call_id: number;
  type: "offer" | "answer" | "ice";
  signal_id: string;
  index: number;
  total: number;
  chunk: string;
};
export class SignalAssembler {
  private groups = new Map<
    string,
    {
      time: number;
      call: number;
      type: string;
      parts: Map<number, string>;
      total: number;
    }
  >();
  private complete = new Once();
  add(s: Signal, now = Date.now()): string | null {
    for (const [key, group] of this.groups)
      if (now - group.time > 30000) this.groups.delete(key);
    if (
      !Number.isInteger(s.total) ||
      s.total < 1 ||
      s.total > 32 ||
      !Number.isInteger(s.index) ||
      s.index < 0 ||
      s.index >= s.total ||
      s.chunk.length > 6000
    )
      return null;
    let group = this.groups.get(s.signal_id);
    if (!group) {
      group = {
        time: now,
        call: s.call_id,
        type: s.type,
        parts: new Map(),
        total: s.total,
      };
      this.groups.set(s.signal_id, group);
    }
    if (
      group.call !== s.call_id ||
      group.type !== s.type ||
      group.total !== s.total
    )
      return null;
    group.parts.set(s.index, s.chunk);
    if (group.parts.size !== group.total) return null;
    this.groups.delete(s.signal_id);
    if (!this.complete.take(s.signal_id)) return null;
    return Array.from({ length: s.total }, (_, i) => group.parts.get(i)).join(
      "",
    );
  }
}

export class Lifetime {
  generation = 0;
  ended = new Set<number>();
  stop(id?: number) {
    this.generation++;
    if (id) this.ended.add(id);
  }
  valid(generation: number, id?: number) {
    return generation === this.generation && (!id || !this.ended.has(id));
  }
}

/** ICE received before SDP is retained in arrival order and drained only once. */
export class CandidateBuffer {
  private queued: unknown[] = [];
  async add(
    candidate: unknown,
    ready: boolean,
    deliver: (candidate: unknown) => Promise<void>,
  ) {
    if (ready) await deliver(candidate);
    else this.queued.push(candidate);
  }
  async flush(
    deliver: (candidate: unknown) => Promise<void>,
    valid: () => boolean,
  ) {
    while (this.queued.length && valid()) await deliver(this.queued.shift());
  }
  clear() {
    this.queued = [];
  }
}

export async function recoverPages<T>(
  initial: string,
  fetchPage: (
    path: string,
  ) => Promise<{ data: T[]; links?: { next: string | null } }>,
  apply: (rows: T[]) => void,
) {
  let path: string | null = initial;
  const seen = new Set<string>();
  while (path && !seen.has(path)) {
    seen.add(path);
    const page = await fetchPage(path);
    apply(page.data);
    path = page.links?.next ?? null;
  }
}

type Track = { stop(): void };
type Stream = {
  getTracks(): Track[];
  getAudioTracks(): Track[];
  getVideoTracks(): Track[];
  addTrack(track: Track): void;
};
export async function acquireMedia<S extends Stream>(
  video: boolean,
  acquire: (constraints: { audio: boolean; video: boolean }) => Promise<S>,
  valid: () => boolean,
): Promise<S> {
  let audio: S;
  try {
    audio = await acquire({ audio: true, video: false });
  } catch {
    throw new Error(
      "Microphone access is required. Enable microphone permission in Settings and retry.",
    );
  }
  if (!valid()) {
    audio.getTracks().forEach((t) => t.stop());
    throw new Error("Call cancelled.");
  }
  if (!audio.getAudioTracks().length) {
    audio.getTracks().forEach((t) => t.stop());
    throw new Error(
      "No microphone is available. Connect a microphone and retry.",
    );
  }
  if (video) {
    let camera: S | undefined;
    try {
      camera = await acquire({ audio: false, video: true });
      if (valid()) camera.getVideoTracks().forEach((t) => audio.addTrack(t));
      else camera.getTracks().forEach((t) => t.stop());
    } catch {
      /* A camera is optional. */
    }
  }
  if (!valid()) {
    audio.getTracks().forEach((t) => t.stop());
    throw new Error("Call cancelled.");
  }
  return audio;
}
