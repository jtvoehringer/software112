// Rückmeldung 30.09.2026: Behandlungsprotokoll – Rieden je einmal, alphabetisch, Lage nur bei abweichendem Namen
// (riedenMitLage in lib/behoerden/psm.ts).
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/protokoll-rieden.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; läuft auch über npm run test:csv)
//
// Resolve-Hook wie in pflanzenschutz.test.mjs: '@/'-Aliase und endungslose Importe → src/…/*.ts.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
if (hooksMoeglich) {
  nodeModule.registerHooks({
    resolve(spezifizierer, kontext, weiter) {
      if (spezifizierer === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
      let basis = null
      if (spezifizierer.startsWith('@/')) basis = path.join(SRC, spezifizierer.slice(2))
      else if (/^\.\.?\//.test(spezifizierer) && !path.extname(spezifizierer) && kontext.parentURL?.startsWith('file:')) {
        basis = path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), spezifizierer)
      }
      if (basis) {
        for (const kandidat of [basis + '.ts', basis + '.tsx', path.join(basis, 'index.ts')]) {
          if (existsSync(kandidat)) return weiter(pathToFileURL(kandidat).href, kontext)
        }
      }
      return weiter(spezifizierer, kontext)
    },
  })
}

const laden = async (rel) => import(pathToFileURL(path.join(SRC, rel)).href)
const psm = hooksMoeglich ? await laden('lib/behoerden/psm.ts') : null
const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

const gst = (weingarten, ried) => ({ weingarten, ried })

describe('Behandlungsprotokoll: Rieden (Rückmeldung 30.09.2026)', () => {
  test('je Ried einmal, alphabetisch; Lage nur, wenn sie anders heißt als die Ried', nurMitHooks, () => {
    const b = { grundstuecke: [
      gst('GENDL II', 'GENDL II'), gst('AUSSATZEN / MODLER', 'aussatzen / modler'), gst('GENDL II', 'GENDL II'),
      gst('Gendl 10', 'Gendl 10'), gst('Pfaffenberg Riesling', 'Pfaffenberg'), gst('Gendl 9', null), gst(null, 'X'),
    ] }
    assert.deepEqual(psm.riedenMitLage(b), ['AUSSATZEN / MODLER', 'Gendl 9', 'Gendl 10', 'GENDL II', 'Pfaffenberg Riesling (Pfaffenberg)'])
    assert.deepEqual(psm.riedenMitLage({ grundstuecke: [] }), [])
  })
})
