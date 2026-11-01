const {
  AndroidConfig,
  withAndroidManifest,
  withAppDelegate,
  withEntitlementsPlist,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// Generate native integration during prebuild; generated platform folders stay disposable.
function modifyAppDelegate(contents) {
  if (contents.includes("// relay-pushkit")) return contents;
  if (!contents.includes("ExpoAppDelegate"))
    throw new Error("Relay PushKit requires the Expo Swift AppDelegate.");
  contents =
    "import PushKit\nimport RNCallKeep\nimport RNVoipPushNotification\n" +
    contents;
  contents = contents.replace(
    /class AppDelegate: ([^{]+)\{/,
    "class AppDelegate: $1, PKPushRegistryDelegate {",
  );
  const anchor = "    let delegate = ReactNativeDelegate()";
  if (!contents.includes(anchor))
    throw new Error(
      "Relay PushKit launch anchor changed. Review AppDelegate before building.",
    );
  contents = contents.replace(
    anchor,
    `    // relay-pushkit
    RNCallKeep.setup(["appName": "Relay", "supportsVideo": true, "maximumCallGroups": 1, "maximumCallsPerCallGroup": 1, "includesCallsInRecents": false])
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    relayPushRegistry = registry
${anchor}`,
  );
  const classStart = /class AppDelegate: [^{]+\{/.exec(contents);
  const start = classStart.index + classStart[0].length;
  contents =
    contents.slice(0, start) +
    `
  private var relayPushRegistry: PKPushRegistry?
  var relayCallRootView: UIView?

  public func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(credentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    let data = payload.dictionaryPayload
    let uuid = data["uuid"] as? String ?? UUID().uuidString
    let name = data["caller_name"] as? String ?? "Relay"
    // Report immediately, before waiting for React, login restoration, or networking.
    RNCallKeep.reportNewIncomingCall(uuid, handle: String(describing: data["call_id"] ?? "Relay"), handleType: "generic", hasVideo: data["kind"] as? String == "video", localizedCallerName: name, supportsHolding: false, supportsDTMF: false, supportsGrouping: false, supportsUngrouping: false, fromPushKit: true, payload: data, withCompletionHandler: completion)
    // SDK 58 starts React from the scene. PushKit can launch without a scene,
    // so retain a root here and transfer it to the scene when the user opens Relay.
    if window == nil && relayCallRootView == nil, let factory = reactNativeFactory {
      relayCallRootView = factory.rootViewFactory.view(withModuleName: "main", initialProperties: nil, launchOptions: nil)
    }
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
    // A native expiry also removes the call UI if JS never starts.
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let expiry = formatter.date(from: data["expires_at"] as? String ?? "") ?? Date().addingTimeInterval(30)
    DispatchQueue.main.asyncAfter(deadline: .now() + max(0, expiry.timeIntervalSinceNow)) {
      if !RNCallKeep.isCallActive(uuid) { RNCallKeep.endCall(withUUID: uuid, reason: 3) }
    }
  }
` +
    contents.slice(start);
  return contents;
}

module.exports = function withNativeCalls(config) {
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults["aps-environment"] = "development";
    return mod;
  });
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift")
      throw new Error("Relay PushKit supports the Swift AppDelegate.");
    mod.modResults.contents = modifyAppDelegate(mod.modResults.contents);
    return mod;
  });
  config = withDangerousMod(config, [
    "ios",
    (mod) => {
      const filename = path.join(
        mod.modRequest.platformProjectRoot,
        mod.modRequest.projectName,
        "SceneDelegate.swift",
      );
      if (!fs.existsSync(filename))
        throw new Error(
          "Relay requires the SDK 58 SceneDelegate. Review the generated iOS project.",
        );
      const contents = fs.readFileSync(filename, "utf8");
      fs.writeFileSync(filename, modifySceneDelegate(contents));
      return mod;
    },
  ]);
  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    configureAndroidCallService(app);
    return mod;
  });
};
function configureAndroidCallService(app) {
  app.service ??= [];
  let service = app.service.find(
    (item) =>
      item.$["android:name"] === "io.wazo.callkeep.VoiceConnectionService",
  );
  // Expo runs composed manifest mods in reverse registration order. Create the
  // declaration when needed; CallKeep then preserves it when its mod runs.
  if (!service) {
    service = {
      $: {
        "android:name": "io.wazo.callkeep.VoiceConnectionService",
        "android:permission":
          "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
        "android:exported": "true",
      },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "android.telecom.ConnectionService" } },
          ],
        },
      ],
    };
    app.service.push(service);
  }
  service.$["android:label"] = "Relay";
  service.$["android:foregroundServiceType"] = "phoneCall|microphone";
}
module.exports.configureAndroidCallService = configureAndroidCallService;
module.exports.modifyAppDelegate = modifyAppDelegate;
function modifySceneDelegate(contents) {
  if (contents.includes("// relay-call-scene")) return contents;
  return contents.replace(
    "class SceneDelegate: ExpoAppSceneDelegate {",
    `class SceneDelegate: ExpoAppSceneDelegate {
  // relay-call-scene: reuse the mounted call providers instead of mounting twice.
  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    if let app = UIApplication.shared.delegate as? AppDelegate,
       let root = app.relayCallRootView, let windowScene = scene as? UIWindowScene {
      let window = UIWindow(windowScene: windowScene)
      let controller = UIViewController()
      controller.view = root
      window.rootViewController = controller
      self.window = window
      app.window = window
      app.relayCallRootView = nil
      window.makeKeyAndVisible()
      return
    }
    super.scene(scene, willConnectTo: session, options: connectionOptions)
  }
`,
  );
}
module.exports.modifySceneDelegate = modifySceneDelegate;
