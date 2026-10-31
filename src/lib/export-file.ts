export function safeDownloadName(name: string) {
  return (
    name
      .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, "_")
      .replace(/^\.+/, "_")
      .trim() || "attachment"
  );
}

// Select before fetching: cancelling the system prompt never starts a download.
export async function exportFile<T>(options: {
  select(): Promise<T | null>;
  load(): Promise<string>;
  current(): boolean;
  copy(source: string, destination: T): Promise<void>;
}) {
  const destination = await options.select();
  if (destination === null) return false;
  if (!options.current()) throw new Error("Session changed.");
  const source = await options.load();
  if (!options.current()) throw new Error("Session changed.");
  await options.copy(source, destination);
  return true;
}
