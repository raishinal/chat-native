/** Count local elapsed time, independent of the server/device clock offset. */
export class MediaClock {
  startedAt: number | null = null;
  private endedAt: number | null = null;
  observe(connection: string, ice: string, now = Date.now()) {
    if (
      this.endedAt === null &&
      (connection === "connected" || ice === "connected" || ice === "completed")
    )
      this.startedAt ??= now;
    return this.startedAt;
  }
  seconds(now = Date.now()) {
    return this.startedAt === null
      ? 0
      : Math.max(
          0,
          Math.floor(((this.endedAt ?? now) - this.startedAt) / 1000),
        );
  }
  stop(now = Date.now()) {
    this.endedAt ??= now;
  }
}

/** Healthy/unknown/duplicate network callbacks are not connection failures. */
export class CallNetwork {
  private offline = false;
  update(state: { isConnected?: boolean; isInternetReachable?: boolean }) {
    const offline =
      state.isConnected === false || state.isInternetReachable === false;
    if (offline && !this.offline) {
      this.offline = true;
      return "offline";
    }
    if (
      this.offline &&
      state.isConnected === true &&
      state.isInternetReachable !== false
    ) {
      this.offline = false;
      return "restored";
    }
    return null;
  }
}

/** Publish SDP first, then send trickled candidates one at a time. */
export class OutgoingIce<T> {
  private queue: T[] = [];
  private ready = false;
  private stopped = false;
  private pending: Promise<void> | null = null;
  private deliver: (candidate: T) => Promise<void>;
  private valid: () => boolean;
  private issue: (error: unknown) => void;
  constructor(
    deliver: (candidate: T) => Promise<void>,
    valid: () => boolean,
    issue: (error: unknown) => void,
  ) {
    this.deliver = deliver;
    this.valid = valid;
    this.issue = issue;
  }
  add(candidate: T) {
    if (this.stopped || !this.valid()) return;
    this.queue.push(candidate);
    void this.flush();
  }
  release() {
    this.ready = true;
    return this.flush();
  }
  stop() {
    this.stopped = true;
    this.queue = [];
  }
  private flush(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.ready || this.stopped || !this.queue.length)
      return Promise.resolve();
    this.pending = (async () => {
      while (this.queue.length && !this.stopped && this.valid()) {
        const candidate = this.queue.shift()!;
        try {
          await this.deliver(candidate);
        } catch (error) {
          if (!this.stopped && this.valid()) this.issue(error);
        }
      }
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
