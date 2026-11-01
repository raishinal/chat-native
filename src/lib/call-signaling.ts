export class CallSignalingUnavailable extends Error {}

/** SDP goes first; trickled ICE uses one request at a time instead of flooding the API. */
export class CallSignaling {
  private ice: unknown[] = [];
  private ready = false;
  private draining = false;
  private embeddedIce = new Set<string>();
  private descriptionsInFlight = 0;
  get busy() {
    return !this.ready || this.draining || this.descriptionsInFlight > 0;
  }
  private send: (type: string, payload: unknown) => Promise<unknown>;
  private valid: () => boolean;
  private onIceError: (error: unknown) => void;
  private wait: (ms: number) => Promise<void>;
  constructor(
    send: (type: string, payload: unknown) => Promise<unknown>,
    valid: () => boolean,
    onIceError: (error: unknown) => void,
    wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    this.send = send;
    this.valid = valid;
    this.onIceError = onIceError;
    this.wait = wait;
  }
  private async deliver(type: string, payload: unknown) {
    for (let attempt = 0; attempt < 3 && this.valid(); attempt++) {
      try {
        await this.send(type, payload);
        return;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (!this.valid()) return;
        if (status && status < 500 && status !== 429) throw error;
        if (attempt === 2)
          throw new CallSignalingUnavailable(
            "Call signaling is temporarily unavailable.",
          );
        await this.wait(500 * (attempt + 1));
      }
    }
  }
  async description(type: string, payload: unknown) {
    this.descriptionsInFlight++;
    try {
      await this.deliver(type, payload);
    } finally {
      this.descriptionsInFlight--;
    }
    if (!this.valid()) return;
    const sdp = (payload as { sdp?: string })?.sdp ?? "";
    this.embeddedIce = new Set(
      Array.from(sdp.matchAll(/^a=(candidate:[^\r\n]+)/gm), (match) =>
        match[1].trim(),
      ),
    );
    this.ready = true;
    void this.drain();
  }
  beginDescription() {
    this.ready = false;
    this.ice = [];
  }
  candidate(payload: unknown) {
    if (!this.valid()) return;
    this.ice.push(payload);
    void this.drain();
  }
  private async drain() {
    if (!this.ready || this.draining) return;
    this.draining = true;
    try {
      while (this.ready && this.ice.length && this.valid()) {
        // Emulator/private-network host candidates often cannot reach the phone.
        // Deliver usable relays before spending seconds on each host candidate.
        this.ice.sort((a, b) => icePriority(b) - icePriority(a));
        const candidate = this.ice.shift();
        const line = (candidate as { candidate?: string })?.candidate;
        if (line && this.embeddedIce.has(line.trim())) continue;
        try {
          await this.deliver("ice", candidate);
        } catch (error) {
          this.onIceError(error);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

function icePriority(payload: unknown) {
  const candidate = (payload as { candidate?: string })?.candidate ?? "";
  if (/\btyp relay\b/.test(candidate)) return 3;
  if (/\btyp srflx\b/.test(candidate)) return 2;
  return 1;
}

/** Connectivity notifications can repeat without representing a network change. */
export class CallNetworkState {
  private previous: string | null = null;
  update(state: {
    type?: string;
    isConnected?: boolean;
    isInternetReachable?: boolean;
  }) {
    const online =
      state.isConnected !== false && state.isInternetReachable !== false;
    const next = `${state.type}:${online}`;
    const changed = this.previous !== null && this.previous !== next;
    this.previous = next;
    return { online, changed };
  }
}
