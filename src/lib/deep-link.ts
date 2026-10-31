export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  try {
    const url = new URL(path, "chatappnative://");
    const route = url.pathname.replace(/^\//, "") || url.hostname;
    const invitation =
      route.match(/invitations\/(\d+)/)?.[1] ||
      (url.hostname === "invitations" ? url.pathname.slice(1) : null);
    const resetToken =
      route.match(/reset-password\/([^/]+)/)?.[1] ||
      (url.hostname === "reset-password" ? url.pathname.slice(1) : null);
    if (invitation)
      return `/account?invitation=${encodeURIComponent(invitation)}&token=${encodeURIComponent(url.searchParams.get("token") || "")}`;
    if (resetToken)
      return `/account?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(url.searchParams.get("email") || "")}`;
    return path;
  } catch {
    return "/account";
  }
}
