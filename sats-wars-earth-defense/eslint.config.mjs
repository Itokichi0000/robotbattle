import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'test-results/**',
      'playwright-report/**',
      'tools/blender/**',
      'data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Browser bundles never import Zod: input validation is the server's job, and Zod's JIT
    // trips a strict CSP. Schemas live in @swed/shared/schemas (server only).
    files: ['apps/{display,pilot,operator}/src/**/*.{ts,tsx}', 'packages/ui-tokens/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'zod', message: 'Browsers do not validate with Zod; the server does.' }],
          patterns: [{ group: ['@swed/shared/schemas'], message: 'Server-only module.' }],
        },
      ],
    },
  },
);
