/** Only temporary TURN credentials cross the authenticated Laravel boundary. */
export type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};
export type CallConnectivity = {
  ice_servers: IceServer[];
  expires_in: number;
  expires_at: string;
};
type Options = {
  /** The Laravel origin, e.g. https://chat.example.com (not Cloudflare's URL). */
  apiOrigin: string;
  /** Obtain from the mobile login flow / platform secure storage, never public env. */
  accessToken: string;
  signal?: AbortSignal;
};

export async function fetchCallConnectivity({
  apiOrigin,
  accessToken,
  signal,
}: Options): Promise<CallConnectivity> {
  const origin = new URL(apiOrigin);
  if (
    origin.username ||
    origin.password ||
    !["https:", "http:"].includes(origin.protocol)
  ) {
    throw new Error("Invalid chat API origin.");
  }
  if (!accessToken) throw new Error("Sign in before starting a call.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(
      new URL("/api/v1/ice-servers", origin.origin).toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        // Credentials remain in memory for this call; do not write them to storage/logs.
        signal: controller.signal,
      },
    ).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      throw new Error(
        controller.signal.aborted
          ? `Call connectivity request to ${origin.origin} timed out. Check the chat server and retry.`
          : `Cannot reach the chat server at ${origin.origin} for call connectivity. Check the server and Android localhost forwarding.`,
      );
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Your account cannot start calls. Sign in again or contact your administrator."
          : "Call connectivity is unavailable. Please retry.",
      );
    }
    const config: CallConnectivity = await response.json();
    if (
      !Array.isArray(config.ice_servers) ||
      !config.ice_servers.length ||
      !config.ice_servers.every(
        (server) =>
          Array.isArray(server.urls) &&
          server.urls.length > 0 &&
          server.urls.every(
            (url) =>
              typeof url === "string" &&
              /^(stun|stuns|turn|turns):[^\s]+$/.test(url),
          ),
      ) ||
      !Number.isFinite(config.expires_in) ||
      config.expires_in <= 0 ||
      Date.parse(config.expires_at) <= Date.now() ||
      !Number.isFinite(Date.parse(config.expires_at))
    ) {
      throw new Error("Invalid call connectivity configuration.");
    }
    return config;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * The native call entry point: the supplied react-native-webrtc constructor/factory
 * is invoked only after fresh authenticated ICE configuration has been fetched.
 * Use for both outgoing calls and incoming acceptance. Pusher still signals SDP/ICE.
 */
export async function createCallPeerConnection<T>(
  options: Options,
  createPeer: (configuration: { iceServers: IceServer[] }) => T,
): Promise<T> {
  const config = await fetchCallConnectivity(options);
  if (options.signal?.aborted) throw new Error("Call cancelled.");
  return createPeer({ iceServers: config.ice_servers });
}
