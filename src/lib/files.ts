import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { api, ApiError, protectedUrl } from "./api";
import type { Attachment, PickedFile } from "./contracts";

const root = () => new Directory(Paths.cache, "relay-private");
export function clearPrivateFiles() {
  const dir = root();
  if (dir.exists) dir.delete();
}
export async function download(a: Pick<Attachment, "name" | "download_url">) {
  const token = api.token;
  const dir = root();
  dir.create({ intermediates: true, idempotent: true });
  const extension = a.name.match(/\.[a-z0-9]{1,10}$/i)?.[0] || "";
  const file = new File(dir, `${Crypto.randomUUID()}${extension}`);
  try {
    const result = await File.downloadFileAsync(
      protectedUrl(a.download_url),
      file,
      { headers: { Authorization: `Bearer ${token}`, Accept: "*/*" } },
    );
    if (api.token !== token) {
      if (result.exists) result.delete();
      throw new Error("Session changed.");
    }
    return result.uri;
  } catch (e) {
    if (file.exists) file.delete();
    throw e;
  }
}
export function upload(
  path: string,
  files: PickedFile[],
  progress: (value: number) => void,
  signal: AbortSignal,
  field = "files[]",
  extra: Record<string, string> = {},
) {
  return new Promise<Attachment[]>((resolve, reject) => {
    const requestToken = api.token;
    const xhr = new XMLHttpRequest(),
      form = new FormData();
    files.forEach((file) =>
      form.append(field, {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || "application/octet-stream",
      } as unknown as Blob),
    );
    Object.entries(extra).forEach(([key, value]) => form.append(key, value));
    xhr.open("POST", protectedUrl(path));
    xhr.timeout = 120000;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${api.token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    const abort = () => xhr.abort();
    const done = () => signal.removeEventListener("abort", abort);
    xhr.onload = () => {
      done();
      if (api.token !== requestToken) {
        reject(new Error("Session changed."));
        return;
      }
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error(`Upload failed (${xhr.status}).`));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.data);
      else {
        if (xhr.status === 401) api.onExpired();
        reject(new ApiError(data.message || "Upload rejected.", xhr.status));
      }
    };
    xhr.onerror = xhr.ontimeout = () => {
      done();
      reject(new Error("Upload interrupted. Retry with your selected files."));
    };
    xhr.onabort = () => {
      done();
      reject(new Error("Upload cancelled. Your files are still selected."));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      done();
      reject(new Error("Upload cancelled."));
      return;
    }
    xhr.send(form);
  });
}
