// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['eslint.config.mjs']
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	eslintPluginPrettierRecommended,
	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.jest
			},
			ecmaVersion: 5,
			sourceType: 'module',
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		}
	},
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/recommended-type-checked': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
			'@typescript-eslint/no-namespace': 'off',
			'@typescript-eslint/interface-name-prefix': 'off',
			'@typescript-eslint/explicit-function-return-type': 'warn',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					ignoreRestSiblings: true,
					varsIgnorePattern: '_',
					caughtErrors: 'none'
				}
			],
			'prettier/prettier': [
				'warn',
				{
					useTabs: true,
					indentSize: 4,
					singleQuote: true,
					trailingComma: 'none',
					printWidth: 120,
					semi: true,
					bracketSpacing: true,
					bracketSameLine: true,
					arrowParens: 'always',
					parser: 'typescript',
					endOfLine: 'lf'
				}
			]
		}
	}
);
