type Player = {
  startRingtone(
    sound: string,
    vibration: number[],
    category: string,
    seconds: number,
  ): void;
  stopRingtone(): void;
};

/** Keep the incoming alert separate from the microphone's communication session. */
export function createIncomingRingtone(player: Player) {
  let activeId: number | null = null;
  function stop() {
    if (activeId === null) return;
    activeId = null;
    player.stopRingtone();
  }
  function start(id: number, seconds: number) {
    if (activeId === id) return;
    stop();
    activeId = id;
    player.startRingtone(
      "_DEFAULT_",
      [0, 700, 350, 700, 1400],
      "default",
      Math.max(1, Math.min(60, seconds)),
    );
  }
  return { start, stop };
}
