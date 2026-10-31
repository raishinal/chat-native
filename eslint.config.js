const { defineConfig } = require("eslint/config");
const expo = require("eslint-config-expo/flat");
module.exports = defineConfig([
  expo,
  { ignores: ["dist/**", "scripts/**"] },
  // Session, device and socket effects initialize/reset external lifecycles.
  { rules: { "react-hooks/set-state-in-effect": "off" } },
]);
