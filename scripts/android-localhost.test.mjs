import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardLocalhost } from "./android-localhost.mjs";
test("localhost forwarding handles connected devices and skips offline/unauthorized devices", async () => {
  const calls = [];
  const run = async (_binary, args) => {
    calls.push(args);
    return {
      stdout:
        args[0] === "devices"
          ? "List of devices attached\nemulator-5554\tdevice\nusb-phone\tdevice\nlocked\tunauthorized\nsleeping\toffline\n"
          : "",
    };
  };
  assert.deepEqual(await forwardLocalhost("adb", "8000", run), [
    "emulator-5554",
    "usb-phone",
  ]);
  assert.deepEqual(calls, [
    ["devices"],
    ["-s", "emulator-5554", "reverse", "--list"],
    ["-s", "emulator-5554", "reverse", "tcp:8000", "tcp:8000"],
    ["-s", "usb-phone", "reverse", "--list"],
    ["-s", "usb-phone", "reverse", "tcp:8000", "tcp:8000"],
  ]);
});
test("no connected device is harmless and a custom backend port is forwarded", async () => {
  assert.deepEqual(
    await forwardLocalhost("adb", "9000", async () => ({
      stdout: "List of devices attached\n",
    })),
    [],
  );
  const calls = [];
  await forwardLocalhost("adb", "9000", async (_binary, args) => {
    calls.push(args);
    return { stdout: args[0] === "devices" ? "phone\tdevice\n" : "" };
  });
  assert.deepEqual(calls[2], [
    "-s",
    "phone",
    "reverse",
    "tcp:9000",
    "tcp:9000",
  ]);
});
test("existing forwarding is retained without rebinding active backend connections", async () => {
  const calls = [];
  await forwardLocalhost("adb", "8000", async (_binary, args) => {
    calls.push(args);
    return {
      stdout:
        args[0] === "devices"
          ? "phone\tdevice\n"
          : "UsbFfs tcp:8000 tcp:8000\n",
    };
  });
  assert.deepEqual(calls, [["devices"], ["-s", "phone", "reverse", "--list"]]);
});
