// Push is opt-in until Firebase / Apple credentials have been provisioned.
const fs = require("node:fs");
module.exports = ({ config }) => {
  const enabled = process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === "true";
  const firebasePlugins = [
    "@react-native-firebase/app",
    "@react-native-firebase/messaging",
  ];
  config.plugins = config.plugins.filter(
    (plugin) =>
      !firebasePlugins.includes(
        typeof plugin === "string" ? plugin : plugin[0],
      ),
  );
  if (enabled) {
    config.plugins.push(...firebasePlugins, "./plugins/with-native-calls");
    config.android.googleServicesFile =
      process.env.GOOGLE_SERVICES_JSON || "./google-services.json";
    const iosServices =
      process.env.GOOGLE_SERVICES_PLIST || "./GoogleService-Info.plist";
    // Android-only setup must also produce a valid public manifest for Metro.
    // Firebase's iOS plugin will require this file when iOS is actually built.
    if (process.env.GOOGLE_SERVICES_PLIST || fs.existsSync(iosServices)) {
      config.ios.googleServicesFile = iosServices;
    } else {
      delete config.ios.googleServicesFile;
    }
    config.ios.infoPlist.UIBackgroundModes = [
      "audio",
      "voip",
      "remote-notification",
    ];
    config.android.permissions = [
      ...new Set([
        ...config.android.permissions,
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
        "android.permission.FOREGROUND_SERVICE_MICROPHONE",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.RECORD_AUDIO",
      ]),
    ];
  }
  config.plugins = config.plugins.map((plugin) =>
    plugin === "expo-build-properties"
      ? [
          plugin,
          {
            ios: { useFrameworks: "static" },
            ...(process.env.APP_ENV === "staging"
              ? {
                  android: {
                    enableMinifyInReleaseBuilds: false,
                    enableShrinkResourcesInReleaseBuilds: false,
                  },
                }
              : {}),
          },
        ]
      : plugin,
  );
  return config;
};
