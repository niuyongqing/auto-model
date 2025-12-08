// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      '@typescript-eslint/no-unsafe-assignment': 'off',   // 屏蔽 "Unsafe assignment of an `any` value"
      '@typescript-eslint/no-unsafe-member-access': 'off', // 屏蔽对 any 类型属性的访问
      '@typescript-eslint/no-unsafe-call': 'off',          // 屏蔽 "Unsafe construction/call"
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
