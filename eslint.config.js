import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.wrangler', '.wrangler/**', '.astro', '.astro/**', '.kilo', '.kilo/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      // Added in react-hooks 7.1. set-state-in-effect flags the load-on-mount
      // pattern across the admin app; refs flags the latest-value ref in
      // useCommandQueue and the Turnstile hook's container ref. Kept visible as
      // warnings until those spots are reworked.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['astro.config.mjs', 'postcss.config.js', 'tailwind.config.js', 'playwright.config.js', 'tests/e2e/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
])
