// KAN-101 (04.10.2026): Füllung – die Server Action schreibt nach dem Speichern nur Spalten der Positivliste des
// Freeze-Triggers (sonst lehnte die Datenbank jedes Speichern mit 42501 ab); Bearbeiten-Seite zeigt die Sperre.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan101-fuellung-freeze.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

// Eingespielte Migration (supabase/migrations/<version>_kan101_fuellung_freeze.sql), bis dahin der Entwurf
function migration() {
  const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(x => x.endsWith('_kan101_fuellung_freeze.sql'))
  return quelle(f ? 'supabase/migrations/' + f : 'supabase/entwurf/kan101_fuellung_freeze.sql')
}

function erlaubteSpalten() {
  const m = /CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public\.fuellungen[\s\S]*?\$\$,\n\s+'([^']*)'/.exec(migration())
  assert.ok(m, 'Positivliste im Freeze-Trigger gefunden')
  return m[1].split(',')
}

describe('KAN-101 Freeze der Füllung', () => {
  test('Positivliste wie im Ticket: Name, Preise, MwSt., KN-Code, Notizen, aktiv, Änderungszeit, Storno', () => {
    assert.deepEqual(erlaubteSpalten().sort(), ['aktiv', 'aktualisiert_am', 'einstandspreis', 'mwst_pct', 'name', 'notizen',
      'storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund', 'vk_preis_brutto', 'zolltarifnummer'].sort())
  })
  test('updateFuellung schreibt nur Spalten der Positivliste', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const upd = s.slice(s.indexOf('export async function updateFuellung'), s.indexOf('export async function pruefnummerNachtragen'))
    const block = /const payload: AR = \{([\s\S]*?)\n  \}/.exec(upd)?.[1]
    assert.ok(block, 'payload gefunden')
    const spalten = [...block.matchAll(/^\s+(\w+):/gm)].map(m => m[1])
    assert.ok(spalten.length >= 5)
    const erlaubt = erlaubteSpalten()
    for (const sp of spalten) assert.ok(erlaubt.includes(sp), `${sp} ist gesperrt`)
    assert.doesNotMatch(upd, /payload\.\w+\s*=/, 'keine nachträglich ergänzten Spalten')
  })
  test('Bestandsbuchungen heben die Sperre nur für ihr UPDATE auf', () => {
    const m = migration()
    for (const fn of ['fuellung_bestand_buchen', 's112_fuellung_verkauf_buchen']) {
      const rumpf = m.slice(m.indexOf(`FUNCTION public.${fn}(`), m.indexOf('$function$;', m.indexOf(`FUNCTION public.${fn}(`)))
      assert.match(rumpf, /set_config\('s112\.freeze_frei', 'fuellungen', true\);\n\s+UPDATE public\.fuellungen\n\s+SET bestand_flaschen = v_neu::integer\n[^\n]*\n\s+PERFORM set_config\('s112\.freeze_frei', '', true\)/, fn)
    }
  })
  test('Bearbeiten-Seite: Hinweis, Merkmale und Abfüllung schreibgeschützt, Prüfnummer-Nachtrag', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx')
    assert.match(p, /<GesperrtHinweis grund="Füllung gespeichert"/)
    assert.equal((p.match(/<fieldset disabled /g) ?? []).length, 2)
    assert.match(p, /<PruefnummerNachtragen /)
  })
})
