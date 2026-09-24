// Modul-Auflösung für scripts/tests/ernte.test.mjs (node:test, ohne zusätzliche Abhängigkeit)
//
// Die Ladefunktionen unter src/lib/behoerden importieren mit dem Next-Alias '@/…' und ohne
// Dateiendung. Dieser Hook (module.register) bildet das für Node nach:
//   '@/lib/csv'   → src/lib/csv/index.ts
//   './typen'     → ./typen.ts
//   'server-only' → leeres Modul (nur im Test; Next löst es im Build selbst auf)

import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

function kandidat(basis) {
  for (const p of [basis, `${basis}.ts`, `${basis}.tsx`, path.join(basis, 'index.ts')]) {
    if (existsSync(p) && statSync(p).isFile()) return pathToFileURL(p).href
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { url: 'data:text/javascript,export%20%7B%7D', shortCircuit: true }
  }
  if (specifier.startsWith('@/')) {
    const url = kandidat(path.join(SRC, specifier.slice(2)))
    if (url) return { url, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') && !path.extname(specifier)) {
    const url = kandidat(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
    if (url) return { url, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
