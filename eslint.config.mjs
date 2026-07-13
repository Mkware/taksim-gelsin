import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // matching.service.old.ts kasıtlı olarak düzenlenmiyor (bkz. CLAUDE.md) — lint'ten de muaf.
    ignores: ['dist/**', 'node_modules/**', 'src/services/matching.service.old.ts'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
