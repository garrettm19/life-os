const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-ios/*'],
  },
  {
    // Build and maintenance scripts run in Node.
    files: ['scripts/*.{cjs,mjs}'],
    languageOptions: {
      globals: { __dirname: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
]);
