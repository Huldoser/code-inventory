import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test/fixtures/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      eqeqeq: 'error',
      'no-console': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
