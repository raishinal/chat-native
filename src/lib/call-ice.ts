type GatheringPeer = {
  iceGatheringState: string;
  addEventListener(type: "icegatheringstatechange", listener: () => void): void;
  removeEventListener(
    type: "icegatheringstatechange",
    listener: () => void,
  ): void;
};

/** Include TURN candidates in the initial SDP rather than serial HTTP trickles. */
export function gatherEarlyIce(
  peer: GatheringPeer,
  signal?: AbortSignal,
  limit = 1500,
): Promise<void> {
  if (peer.iceGatheringState === "complete" || signal?.aborted)
    return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", changed);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const changed = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, limit);
    peer.addEventListener("icegatheringstatechange", changed);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
