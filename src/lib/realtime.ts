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
  private active = true;
  constructor(
    private event: (event: PusherEvent) => void,
    private state: (state: string) => void,
    private recover: () => void,
  ) {}
  async start(user: number) {
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
      onAuthorizer: (channel_name, socket_id) =>
        api.request("broadcasting/auth", "POST", { channel_name, socket_id }),
      onEvent: (e) => {
        if (this.active) this.event(e);
      },
      onConnectionStateChange: (state) => {
        if (!this.active) return;
        this.state(state.toLowerCase());
        if (state === "CONNECTED") this.recover();
      },
      onError: () => {
        if (this.active) this.state("Reconnecting · API refresh active");
      },
      onSubscriptionError: (channel) => {
        this.channels.delete(channel);
        void this.pusher.unsubscribe({ channelName: channel }).catch(() => {});
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
    for (const id of ids)
      await this.subscribe(`private-v1.conversations.${id}`);
  }
  async reconnect(user: number) {
    if (!this.active || !realtimeConfigured) return;
    await this.subscribe(`private-v1.users.${user}`);
    await this.subscribe("presence-v1.presence");
    await this.pusher.connect();
  }
  stop() {
    this.active = false;
    const task = (async () => {
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
