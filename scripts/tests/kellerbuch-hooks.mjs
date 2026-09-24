// Auflösungs-Hooks für scripts/tests/kellerbuch.test.mjs (Node ≥ 22.6, ohne Abhängigkeit)
//
// Die Ladefunktionen unter src/lib/behoerden importieren wie der übrige Code über den
// Alias '@/…' und ohne Dateiendung. Node kann das allein nicht auflösen – diese Hooks
// ergänzen es für die Tests:
//   '@/x'          → src/x.ts | src/x.tsx | src/x/index.ts
//   './x', '../x'  → x.ts | x/index.ts (nur wenn ohne Endung angegeben)
//   'server-only'  → leeres Modul (Next.js löst es im Build selbst auf)

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

function datei(basis) {
  for (const k of [basis + '.ts', basis + '.tsx', path.join(basis, 'index.ts'), basis]) {
    if (existsSync(k) && statSync(k).isFile()) return pathToFileURL(k).href
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true }
  if (specifier.startsWith('@/')) {
    const url = datei(path.join(SRC, specifier.slice(2)))
    if (url) return { url, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const url = datei(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
    if (url) return { url, shortCircuit: true }
  }
  return next(specifier, context)
}
