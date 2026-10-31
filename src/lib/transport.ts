export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export function protectedUrl(path: string, origin: string) {
  const base = new URL(origin);
  const url = new URL(
    path.startsWith("/") || path.startsWith("http") ? path : `/api/v1/${path}`,
    base,
  );
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Untrusted API URL.");
  return url.toString();
}
export class Client {
  origin: string;
  constructor(origin: string) {
    this.origin = origin;
  }
  token = "";
  onExpired: () => void = () => {};
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = protectedUrl(path, this.origin);
    const requestToken = this.token;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      });
      const data =
        response.status === 204
          ? undefined
          : await response.json().catch(() => ({
              message: `Request failed (${response.status}).`,
            }));
      if (requestToken && this.token !== requestToken)
        throw new ApiError("Session changed. Retry after signing in.", 409);
      if (!response.ok) {
        if (response.status === 401 && this.token === requestToken)
          this.onExpired();
        throw new ApiError(data?.message || "Request failed.", response.status);
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError || signal?.aborted) throw error;
      throw new ApiError(
        controller.signal.aborted
          ? `The chat server at ${this.origin} took too long to respond. Retry when it is reachable.`
          : `Cannot reach the chat server at ${this.origin}. Check the server and your connection. For Android localhost, keep USB/emulator forwarding running.`,
        0,
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
