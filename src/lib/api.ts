import * as SecureStore from "expo-secure-store";
import type { User } from "./contracts";
import { Client, ApiError, protectedUrl as resolveUrl } from "./transport";
import { sessionStorageKey } from "./session-key";
export { ApiError } from "./transport";
export const origin = (
  process.env.EXPO_PUBLIC_API_ORIGIN || "http://localhost:8000"
).replace(/\/$/, "");
export const protectedUrl = (path: string) => resolveUrl(path, origin);
export const api = new Client(origin);
const TOKEN_KEY = sessionStorageKey(origin);
export const tokenStorage = {
  read: () => SecureStore.getItemAsync(TOKEN_KEY),
  write: (token: string) =>
    SecureStore.setItemAsync(TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};
export async function validateSession() {
  const { data } = await api.request<{ data: User }>("me");
  if (data.status !== "active")
    throw new ApiError(
      "This account is not active. Contact your administrator.",
      403,
    );
  return data;
}
