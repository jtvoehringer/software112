// ESLint 9 Flat Config (KAN-140) – ersetzt `next lint` (in Next.js 16 entfernt).
// Basis: eslint-config-next 16 (core-web-vitals + typescript). `npm run lint` = `eslint .`,
// Teil von `npm run verify` (CI-Job „check“). Nur Errors blockieren, Warnings sind Altbestand
// (Ausgangswerte je Regel in STABILITAET.md) und sollen nur sinken.
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'node_modules/**',
    'next-env.d.ts',
    // Datenbank (SQL, Edge Functions laufen unter Deno) – nicht Teil der App
    'supabase/**',
    // Playwright: Sitzungen und Ergebnisse
    'e2e/.auth/**',
    'e2e/.ergebnisse/**',
    'playwright-report/**',
    'blob-report/**',
    'test-results/**',
    // Claude-Arbeitsordner (Worktrees, Einstellungen) und Ablagen
    '.claude/**',
    '**/scratchpad/**',
    '_to_delete/**',
    '_to_delete_claude_cleanup/**',
    '_xyz/**',
    'eama-export/**',
    'import-daten/**',
    'coverage/**',
    // generiert (supabase gen types)
    'src/lib/types/database.types.ts',
  ]),

  {
    linterOptions: {
      // Bestehende `// eslint-disable-next-line`-Kommentare, die (noch) nichts unterdrücken,
      // nur melden, nicht blockieren.
      reportUnusedDisableDirectives: 'warn',
    },
  },

  {
    rules: {
      // Altbefunde in großer Zahl (Ausgangswerte in STABILITAET.md) – als Warnung sichtbar,
      // blockieren aber nicht. Neue Befunde trotzdem vermeiden, die Zahl soll nur sinken.
      '@typescript-eslint/no-explicit-any': 'warn', // Projektkonvention `(supabase.from(…) as any)`
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Gerade Anführungszeichen/Apostrophe in JSX-Text – rein kosmetisch, rendert korrekt
      'react/no-unescaped-entities': 'warn',
      // <a> statt <Link> für interne Seiten: voller Seiten-Reload statt Client-Navigation,
      // funktional korrekt. Umstellung auf <Link> ist UI-Änderung (Folgeticket).
      '@next/next/no-html-link-for-pages': 'warn',

      // Neue React-Compiler-Regeln aus eslint-plugin-react-hooks 7 (mit eslint-config-next 16).
      // Sie melden Muster, die ohne React Compiler funktionieren (setState in useEffect,
      // Date.now() im Render, ref.current im Render, Komponenten im Render …). Umbau wäre
      // Verhaltensänderung im Produktivcode – daher Warnung, Befunde in STABILITAET.md.
      // react-hooks/rules-of-hooks und exhaustive-deps bleiben wie vorgegeben (Error/Warn).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },

  {
    // Playwright-Fixtures: der Parameter `use` ist Playwrights Fixture-Callback, kein React-Hook
    files: ['e2e/**'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },

  {
    // Node-Skripte in CommonJS (prebuild-Wächter): require() ist dort richtig
    files: ['scripts/**/*.js', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
])
