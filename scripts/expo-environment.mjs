import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import environment from "./environment.cjs";
import { watchAndroidLocalhost } from "./android-localhost.mjs";

const require = createRequire(import.meta.url);
const [name = "local", command = "start", ...args] = process.argv.slice(2);
try {
  const platform =
    command.endsWith(":ios") ||
    args.includes("--ios") ||
    (args.includes("--platform") &&
      args[args.indexOf("--platform") + 1] === "ios")
      ? "ios"
      : "android";
  const env = environment.loadEnvironment(name, { platform });
  console.log(`Relay ${name}: ${env.EXPO_PUBLIC_API_ORIGIN}`);
  if (command === "--print-config") {
    console.log(
      JSON.stringify(
        {
          environment: env.APP_ENV,
          apiOrigin: env.EXPO_PUBLIC_API_ORIGIN,
          pusherConfigured: !!(
            env.EXPO_PUBLIC_PUSHER_KEY && env.EXPO_PUBLIC_PUSHER_CLUSTER
          ),
        },
        null,
        2,
      ),
    );
  } else {
    const stopForwarding =
      name === "local" &&
      platform === "android" &&
      ["start", "run:android"].includes(command)
        ? watchAndroidLocalhost(env.EXPO_PUBLIC_API_ORIGIN)
        : () => {};
    const expoPackage = require.resolve("expo/package.json");
    const cli = path.resolve(
      path.dirname(expoPackage),
      require(expoPackage).bin.expo,
    );
    const child = spawn(process.execPath, [cli, command, ...args], {
      env,
      stdio: "inherit",
      cwd: fileURLToPath(new URL("../", import.meta.url)),
    });
    child.on("error", (error) => {
      stopForwarding();
      console.error(error.message);
      process.exitCode = 1;
    });
    child.on("exit", (code) => {
      stopForwarding();
      process.exitCode = code ?? 1;
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
