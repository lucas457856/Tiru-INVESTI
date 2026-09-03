import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // Server-side: Vercel serverless functions (api/**) rodam em Node.js,
  // então `process` é um global nativo. Sem essa regra, o ESLint
  // marca `process.env.X` como `no-undef`.
  {
    files: ['api/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
