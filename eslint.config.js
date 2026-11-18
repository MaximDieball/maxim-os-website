import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '**/dist/**',
      '**/node_modules/**',
      'artifacts/**',
      'e2e/__snapshots__/**',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Sicherheitsregel 1: Der Server startet niemals Prozesse.
    files: ['apps/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['child_process', 'node:child_process', 'cluster', 'node:cluster'],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'binding', message: 'Nicht erlaubt.' },
      ],
    },
  },
);
