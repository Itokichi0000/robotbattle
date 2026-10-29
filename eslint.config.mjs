import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'test-results/**',
      'playwright-report/**',
      '**/next-env.d.ts',
      'tools/blender/**',
      // Separate workspace with its own lint config (D-075).
      'sats-wars-earth-defense/**',
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
    // Browser bundles take Zod from shared/validation so its eval-free mode is set before any
    // schema is built (production CSP has no 'unsafe-eval', D-069).
    files: [
      'packages/{shared,ui,three-game}/src/**/*.{ts,tsx}',
      'apps/{web,solo}/src/**/*.{ts,tsx}',
    ],
    ignores: ['packages/shared/src/validation.ts', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message:
                "Import z from packages/shared/src/validation (browsers need Zod's jitless mode, D-069).",
            },
          ],
        },
      ],
    },
  },
);
