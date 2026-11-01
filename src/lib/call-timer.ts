import { NativeModules, Platform } from "react-native";

type Timer = {
  setInterval(callback: () => void, delay: number): number;
  clearInterval(id: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
};
// Android pauses standard JS timers when the activity stops. Use native ticks
// only while a call is active; the foreground call service owns background life.
const timer: Timer | null =
  Platform.OS === "android" && NativeModules.RNBackgroundTimer
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react-native-background-timer").default
    : null;

export function callInterval(callback: () => void, delay: number) {
  if (timer) {
    const id = timer.setInterval(callback, delay);
    return () => timer.clearInterval(id);
  }
  const id = setInterval(callback, delay);
  return () => clearInterval(id);
}

export function callTimeout(callback: () => void, delay: number) {
  if (timer) {
    const id = timer.setTimeout(callback, delay);
    return () => timer.clearTimeout(id);
  }
  const id = setTimeout(callback, delay);
  return () => clearTimeout(id);
}
