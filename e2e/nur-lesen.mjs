// Startet Playwright im Nur-Lesen-Modus (E2E_NUR_LESEN=1 → nur Tests mit @lesend).
// Eigener Starter statt `E2E_NUR_LESEN=1 playwright test`, weil npm-Skripte unter
// Windows (cmd) keine Inline-Variablen kennen. Weitere Argumente werden durchgereicht:
//   npm run test:e2e:lesend -- --project=tenant_admin

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cli = require.resolve('@playwright/test/cli')

const r = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_NUR_LESEN: '1' },
})
process.exit(r.status ?? 1)
