import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);
export async function forwardLocalhost(adb, port, run = exec) {
  const { stdout } = await run(adb, ["devices"], {
    timeout: 3000,
    windowsHide: true,
  });
  const devices = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial);
  for (const serial of devices) {
    const { stdout: mappings } = await run(
      adb,
      ["-s", serial, "reverse", "--list"],
      { timeout: 3000, windowsHide: true },
    );
    const exists = mappings
      .split(/\r?\n/)
      .some(
        (line) =>
          line.trim().split(/\s+/).slice(-2).join(" ") ===
          `tcp:${port} tcp:${port}`,
      );
    if (!exists)
      await run(adb, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`], {
        timeout: 3000,
        windowsHide: true,
      });
  }
  return devices;
}

export function watchAndroidLocalhost(origin) {
  const url = new URL(origin);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    return () => {};
  const binary = process.platform === "win32" ? "adb.exe" : "adb";
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  ]
    .filter(Boolean)
    .map((root) => path.join(root, "platform-tools", binary));
  const adb = candidates.find((file) => fs.existsSync(file)) || binary;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  let active = true,
    busy = false,
    previous = "",
    warned = false;
  async function check() {
    if (!active || busy) return;
    busy = true;
    try {
      const devices = await forwardLocalhost(adb, port);
      const current = devices.join(",");
      if (active && current && current !== previous)
        console.log(
          `Android localhost:${port} forwarded to the computer for ${current}.`,
        );
      previous = current;
    } catch (error) {
      if (active && !warned) {
        console.warn(
          `Android localhost forwarding unavailable: ${error.message}. Run adb reverse tcp:${port} tcp:${port} after connecting your device.`,
        );
        warned = true;
      }
    } finally {
      busy = false;
    }
  }
  void check();
  // Also catches an emulator launched after Expo starts and reconnecting USB devices.
  const timer = setInterval(() => {
    void check();
  }, 5000);
  timer.unref();
  return () => {
    active = false;
    clearInterval(timer);
  };
}
