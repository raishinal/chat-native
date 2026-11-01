import type { Call } from "./contracts";

/** Recover missed call updates without overlapping requests or reviving old calls. */
export class CallStateSync {
  private busy = false;

  async refresh(
    id: number,
    load: () => Promise<Call[]>,
    valid: () => boolean,
    receive: (call: Call) => void,
  ) {
    if (this.busy) return;
    this.busy = true;
    try {
      const calls = await load();
      if (!valid()) return;
      const call = calls.find((item) => item.id === id);
      if (call) receive(call);
    } finally {
      this.busy = false;
    }
  }
}
