import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import environment from "./environment.cjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = environment.loadEnvironment("preview", { platform: "android" });
if (
  env.EXPO_PUBLIC_API_ORIGIN !== "https://chat.roshanlama.com.np" ||
  env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED !== "true" ||
  !env.EXPO_PUBLIC_PUSHER_KEY ||
  !env.EXPO_PUBLIC_PUSHER_CLUSTER
) {
  throw new Error(
    "The standalone APK requires the live host, Firebase push, and Pusher configuration.",
  );
}
if (!fs.existsSync(path.join(root, "android/app/google-services.json"))) {
  throw new Error(
    "Generate Android with the Firebase-enabled profile before building the APK.",
  );
}
console.log(`Building standalone APK for ${env.EXPO_PUBLIC_API_ORIGIN}`);
// Match the verified native code paths for an internal test installer. Optional
// WebRTC/SLF4J classes in the dependency graph currently prevent R8 shrinking.
const task =
  ":app:assembleRelease -Pandroid.enableMinifyInReleaseBuilds=false -Pandroid.enableShrinkResourcesInReleaseBuilds=false -x lint -x test --no-daemon --stacktrace";
const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", `gradlew.bat ${task}`], {
        cwd: path.join(root, "android"),
        env,
        stdio: "inherit",
        windowsHide: true,
      })
    : spawn("./gradlew", task.split(" "), {
        cwd: path.join(root, "android"),
        env,
        stdio: "inherit",
      });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", async (code) => {
  if (code !== 0) {
    process.exitCode = code || 1;
    return;
  }
  const output = path.join(root, "dist", "relay-live.apk");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(
    path.join(root, "android/app/build/outputs/apk/release/app-release.apk"),
    output,
  );
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(output)) hash.update(chunk);
  fs.writeFileSync(
    `${output}.sha256`,
    `${hash.digest("hex")}  relay-live.apk\n`,
  );
  console.log(`APK ready: ${output}`);
});
