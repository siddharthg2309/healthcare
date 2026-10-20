const { defineConfig, globalIgnores } = require("eslint/config");
const tseslint = require("typescript-eslint");

module.exports = defineConfig([
  globalIgnores(["dist/*", "node_modules/*"]),
  ...tseslint.configs.recommended,
]);
