const { withProjectBuildGradle } = require("expo/config-plugins");

// Ninja on Windows cannot create the long object directories produced by CMake.
// Ask CMake to hash those paths; keep the fix in CNG rather than generated files.
module.exports = function withShortCmakePaths(config) {
  return withProjectBuildGradle(config, (config) => {
    const marker = "// Relay: short Windows CMake object paths";
    if (!config.modResults.contents.includes(marker)) {
      const snippet = `
${marker}
subprojects { nativeProject ->
  nativeProject.afterEvaluate {
    if (System.getProperty('os.name').toLowerCase().contains('windows') &&
        (nativeProject.plugins.hasPlugin('com.android.library') || nativeProject.plugins.hasPlugin('com.android.application'))) {
      nativeProject.android.defaultConfig.externalNativeBuild.cmake.arguments.add('-DCMAKE_OBJECT_PATH_MAX=240')
      // Keep the object directory itself short as well: codegen target names
      // can consume most of Ninja's Windows path limit before hashing begins.
      def cacheRoot = System.getenv('RELAY_CMAKE_BUILD_ROOT') ?: new File(rootProject.projectDir.toPath().root.toFile(), '.relay-cxx').absolutePath
      def checkoutKey = Integer.toUnsignedString(rootProject.projectDir.absolutePath.hashCode(), 36)
      def moduleKey = Integer.toUnsignedString(nativeProject.path.hashCode(), 36)
      nativeProject.android.externalNativeBuild.cmake.buildStagingDirectory = new File(cacheRoot, checkoutKey + '/' + moduleKey)
    }
  }
}
`;
      const anchor = 'apply plugin: "expo-root-project"';
      if (!config.modResults.contents.includes(anchor))
        throw new Error(
          "Expo Android template changed; update the Windows CMake plugin.",
        );
      config.modResults.contents = config.modResults.contents.replace(
        anchor,
        `${snippet}\n${anchor}`,
      );
    }
    return config;
  });
};
