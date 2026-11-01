import {
  Pusher,
  type PusherEvent,
} from "@pusher/pusher-websocket-react-native";
import { api } from "./api";

export const realtimeConfigured = !!(
  process.env.EXPO_PUBLIC_PUSHER_KEY && process.env.EXPO_PUBLIC_PUSHER_CLUSTER
);
export class Realtime {
  private static teardown = Promise.resolve();
  private pusher = Pusher.getInstance();
  private channels = new Set<string>();
  private failedChannels = new Set<string>();
  private active = true;
  private connected = false;
  private userSubscribed = false;
  private user?: number;
  private starting?: Promise<void>;
  private reconnecting?: Promise<void>;
  private callError = "";
  async readyForCalls() {
    if (!realtimeConfigured)
      throw new Error(
        "Calls are unavailable because Pusher configuration is missing. Rebuild the app with its Pusher key and cluster.",
      );
    await this.starting;
    if (!this.connected || !this.userSubscribed) {
      if (this.user !== undefined) await this.reconnect(this.user);
    }
    const deadline = Date.now() + 15000;
    while (this.active && Date.now() < deadline) {
      if (this.connected && this.userSubscribed) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      this.callError ||
        "Call signaling could not connect. Check your internet connection and retry.",
    );
  }
  constructor(
    private event: (event: PusherEvent) => void,
    private state: (state: string) => void,
    private recover: () => void,
  ) {}
  start(user: number) {
    this.user = user;
    return (this.starting ??= this.initialize(user));
  }
  private async initialize(user: number) {
    await Realtime.teardown;
    if (!this.active) return;
    if (!realtimeConfigured) {
      this.state("Live updates unavailable · API refresh active");
      return;
    }
    await this.pusher.init({
      apiKey: process.env.EXPO_PUBLIC_PUSHER_KEY!,
      cluster: process.env.EXPO_PUBLIC_PUSHER_CLUSTER!,
      useTLS: true,
      onAuthorizer: async (channel_name, socket_id) => {
        try {
          return await api.request("broadcasting/auth", "POST", {
            channel_name,
            socket_id,
          });
        } catch (error) {
          if (this.active) this.failedChannels.add(channel_name);
          if (this.active && channel_name === `private-v1.users.${user}`) {
            this.userSubscribed = false;
            this.callError =
              error instanceof Error
                ? error.message
                : "Call channel authorization failed.";
            this.state(this.callError);
          }
          // Android waits on a native semaphore for this callback. Rejecting it
          // leaves the Pusher thread blocked, preventing all later reconnects.
          return {};
        }
      },
      onEvent: (e) => {
        if (this.active) this.event(e);
      },
      onConnectionStateChange: (state) => {
        if (!this.active) return;
        if (__DEV__) console.info("[realtime] connection", state);
        this.connected = state.toUpperCase() === "CONNECTED";
        if (!this.connected) this.userSubscribed = false;
        this.state(state.toLowerCase());
        if (this.connected) this.recover();
      },
      onError: () => {
        if (__DEV__) console.warn("[realtime] connection error");
        if (this.active) this.state("Reconnecting · API refresh active");
      },
      onSubscriptionSucceeded: (channel) => {
        if (!this.active) return;
        this.failedChannels.delete(channel);
        if (channel === `private-v1.users.${user}`) {
          this.userSubscribed = true;
          this.callError = "";
        }
        if (__DEV__ && this.active)
          console.info("[realtime] subscribed", channel);
      },
      onSubscriptionError: (channel) => {
        if (!this.active) return;
        this.failedChannels.add(channel);
        if (__DEV__ && this.active)
          console.warn("[realtime] subscription failed", channel);
        if (channel === `private-v1.users.${user}`) this.userSubscribed = false;
        // Keep the registration until retry can unsubscribe and resubscribe
        // sequentially; an unawaited unsubscribe can erase a new subscription.
        if (this.active) this.state("Subscription interrupted · retrying");
      },
      onMemberAdded: () => this.recover(),
      onMemberRemoved: () => this.recover(),
    });
    if (!this.active) return;
    await this.subscribe(`private-v1.users.${user}`);
    await this.subscribe("presence-v1.presence");
    if (this.active) await this.pusher.connect();
  }
  async subscribe(channel: string) {
    if (!this.active || !realtimeConfigured || this.channels.has(channel))
      return;
    this.channels.add(channel);
    try {
      await this.pusher.subscribe({ channelName: channel });
    } catch (e) {
      this.channels.delete(channel);
      throw e;
    }
  }
  async conversations(ids: number[]) {
    await this.starting;
    for (const id of ids)
      await this.subscribe(`private-v1.conversations.${id}`);
  }
  async reconnect(user: number) {
    await this.starting;
    if (!this.active || !realtimeConfigured) return;
    if (this.reconnecting) return this.reconnecting;
    const task = (async () => {
      for (const channelName of [...this.failedChannels]) {
        await this.pusher.unsubscribe({ channelName });
        this.channels.delete(channelName);
        this.failedChannels.delete(channelName);
        await this.subscribe(channelName);
      }
      await this.subscribe(`private-v1.users.${user}`);
      await this.subscribe("presence-v1.presence");
      if (this.active && !this.connected) await this.pusher.connect();
    })();
    this.reconnecting = task;
    try {
      await task;
    } finally {
      if (this.reconnecting === task) this.reconnecting = undefined;
    }
  }
  stop() {
    this.active = false;
    const task = (async () => {
      await this.starting?.catch(() => {});
      await this.reconnecting?.catch(() => {});
      for (const channelName of this.channels)
        await this.pusher.unsubscribe({ channelName }).catch(() => {});
      this.channels.clear();
      await this.pusher.disconnect();
      await this.pusher.reset();
    })();
    Realtime.teardown = task.catch(() => {});
    return Realtime.teardown;
  }
}
