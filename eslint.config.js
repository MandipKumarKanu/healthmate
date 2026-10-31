// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/array-type': 'off',
      'import/namespace': 'off',
    },
    ignores: ['dist/*', 'node_modules/*'],
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
      },
    },
  },
]);
