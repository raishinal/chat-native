const { withAndroidManifest } = require("expo/config-plugins");

// CAMERA permission otherwise implies required camera hardware in Play filtering.
module.exports = function withOptionalCamera(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const features = manifest["uses-feature"] || [];
    for (const name of [
      "android.hardware.camera",
      "android.hardware.camera.any",
      "android.hardware.camera.front",
      "android.hardware.camera.autofocus",
    ]) {
      const existing = features.find(
        (feature) => feature.$["android:name"] === name,
      );
      if (existing) existing.$["android:required"] = "false";
      else
        features.push({
          $: { "android:name": name, "android:required": "false" },
        });
    }
    manifest["uses-feature"] = features;
    return config;
  });
};
