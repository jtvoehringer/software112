// CRM › Kontakte: Felder „Position“ und „Quelle“ samt Quelle-Filter (Hotfix 02.10.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Geprüft wird die Verdrahtung: URL-Parameter ?quelle= (inkl. Sonderwert „ohne Quelle“),
// serverseitiger Filter in ladeKontakteSeite (.eq bzw. .is null), Zählung je Quelle ohne RPC,
// Server Actions lesen beide Felder (trimmen, leer → null, Längenprüfung), Formular, Liste,
// Detailseite und CSV-Export kennen die Spalten. lib/crm/liste.ts hat keine Importe und wird
// direkt geladen; Seiten und Actions per Quelltext-Prüfung (Server Components/Actions mit Supabase).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as liste from '../../src/lib/crm/liste.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/** Abfrage-Attrappe: zeichnet alle Builder-Aufrufe auf und liefert leere Daten */
function attrappe() {
  const aufrufe = []
  const builder = new Proxy({}, {
    get(_, name) {
      if (name === 'then') return (res) => res({ data: [], count: 0, error: null })
      return (...args) => { aufrufe.push([name, ...args]); return builder }
    },
  })
  return { client: { from: (t) => { aufrufe.push(['from', t]); return builder } }, aufrufe }
}

describe('Filterparameter ?quelle=', () => {
  test('filterAusParams liest quelle (getrimmt, auf QUELLE_MAX gekürzt), Firmen ignorieren ihn', () => {
    assert.equal(liste.filterAusParams({ quelle: '  Messe  ' }, 'kontakt').quelle, 'Messe')
    assert.equal(liste.filterAusParams({}, 'kontakt').quelle, '')
    assert.equal(liste.filterAusParams({ quelle: 'x'.repeat(200) }, 'kontakt').quelle.length, liste.QUELLE_MAX)
    assert.equal(liste.filterAusParams({ quelle: 'Messe' }, 'firma').quelle, '')
  })

  test('paramsAusFilter schreibt quelle nur, wenn gesetzt; Sonderwert „ohne“ bleibt erhalten', () => {
    assert.equal(liste.paramsAusFilter({ quelle: '' }), '')
    assert.equal(liste.paramsAusFilter({ quelle: 'Wein & Co' }), '?quelle=Wein+%26+Co')
    const ohne = liste.paramsAusFilter({ quelle: liste.QUELLE_OHNE })
    assert.equal(liste.filterAusParams(Object.fromEntries(new URLSearchParams(ohne.slice(1))), 'kontakt').quelle, liste.QUELLE_OHNE)
  })

  test('ladeKontakteSeite: .eq(quelle) bzw. .is(quelle, null), Spalten position und quelle im Select', async () => {
    const f = liste.filterAusParams({ quelle: 'Messe' }, 'kontakt')
    const a = attrappe()
    await liste.ladeKontakteSeite(a.client, 't1', f)
    assert.ok(a.aufrufe.some(c => c[0] === 'eq' && c[1] === 'quelle' && c[2] === 'Messe'))
    const sel = a.aufrufe.find(c => c[0] === 'select')[1]
    assert.match(sel, /\bposition\b/)
    assert.match(sel, /\bquelle\b/)
    assert.ok(a.aufrufe.some(c => c[0] === 'eq' && c[1] === 'tenant_id' && c[2] === 't1'))

    const b = attrappe()
    await liste.ladeKontakteSeite(b.client, 't1', liste.filterAusParams({ quelle: liste.QUELLE_OHNE }, 'kontakt'))
    assert.ok(b.aufrufe.some(c => c[0] === 'is' && c[1] === 'quelle' && c[2] === null))
    assert.ok(!b.aufrufe.some(c => c[0] === 'eq' && c[1] === 'quelle'))

    const c = attrappe()
    await liste.ladeKontakteSeite(c.client, 't1', liste.filterAusParams({}, 'kontakt'))
    assert.ok(!c.aufrufe.some(x => (x[0] === 'eq' || x[0] === 'is') && x[1] === 'quelle'), 'ohne Filter keine Einschränkung')
  })

  test('zaehleQuellen: Anzahl je Quelle alphabetisch, leere/NULL als „ohne“', () => {
    const z = liste.zaehleQuellen([
      { quelle: 'Website' }, { quelle: 'Messe' }, { quelle: null }, { quelle: 'Messe' }, { quelle: '  ' }, { quelle: 'Ärztekammer' },
    ])
    assert.deepEqual(z.quellen, [
      { quelle: 'Ärztekammer', anzahl: 1 }, { quelle: 'Messe', anzahl: 2 }, { quelle: 'Website', anzahl: 1 },
    ])
    assert.equal(z.ohne, 2)
  })
})

describe('Seiten, Formular und Actions', () => {
  const page = quelle('src/app/(dashboard)/crm/kontakte/page.tsx')
  const client = quelle('src/app/(dashboard)/crm/kontakte/KontakteClient.tsx')
  const detailPage = quelle('src/app/(dashboard)/crm/kontakte/[id]/page.tsx')
  const detail = quelle('src/app/(dashboard)/crm/kontakte/[id]/KontaktDetailClient.tsx')
  const actions = quelle('src/app/(dashboard)/crm/actions.ts')

  test('Kontaktliste zählt Quellen ohne RPC (nur Spalte quelle, Betrieb, aktiv wie die Liste, alle())', () => {
    assert.match(page, /select\('id, quelle'\)\.eq\('tenant_id', tenantId\)/)
    assert.match(page, /if \(!filter\.inaktiv\) q = q\.eq\('aktiv', true\)/)
    assert.match(page, /return alle\(q\.order\('id'\)\)/)
    assert.match(page, /quellenZaehler=\{quellenZaehler\}/)
    assert.doesNotMatch(page, /rpc\([^)]*quelle/)
  })

  test('Formular: Position in der Zeile mit Segment und Firma, Quelle mit „+ Neue Quelle …“', () => {
    const pos = client.indexOf('name="position"')
    assert.ok(pos > 0, 'Feld position')
    assert.ok(pos < client.indexOf('name="segment"') && client.indexOf('name="segment"') < client.indexOf('name="firma_id"'), 'Reihenfolge Position | Segment | Firma')
    assert.match(client, /sm:grid-cols-3/)
    assert.match(client, /name="quelle"/)
    assert.match(client, /\+ Neue Quelle …/)
    assert.ok(client.indexOf('name="zahlungsziel_tage"') < client.indexOf('name="quelle"'), 'Quelle rechts neben dem Zahlungsziel')
    assert.match(client, /maxLength=\{POSITION_MAX\}/)
    assert.match(client, /maxLength=\{QUELLE_MAX\}/)
  })

  test('Liste: Button „Quelle“ öffnet die Werte-Zeile, bei aktivem Filter automatisch offen', () => {
    assert.match(client, /const quelleZeile = quelleOffen \|\| quelleAktiv/)
    assert.match(client, /Alle Quellen/)
    assert.match(client, /ohne Quelle \(\{quellenZaehler\.ohne\}\)/)
    assert.match(client, /setzeFilter\(\{ quelle: filter\.quelle === q\.quelle \? '' : q\.quelle \}\)/)
  })

  test('Actions: createKontakt und updateKontakt lesen position und quelle', () => {
    for (const fn of ['createKontakt', 'updateKontakt']) {
      const start = actions.indexOf(`export async function ${fn}(`)
      const body = actions.slice(start, actions.indexOf('\nexport ', start + 10))
      assert.match(body, /\.\.\.kontaktPositionQuelle\(formData\)/, fn)
    }
    assert.match(actions, /optionalerText\(formData, 'position', 'Position', POSITION_MAX\)/)
    assert.match(actions, /optionalerText\(formData, 'quelle', 'Quelle', QUELLE_MAX\)/)
    assert.match(actions, /if \(!wert\) return null/)
    assert.match(actions, /ist zu lang \(höchstens \$\{max\} Zeichen/)
  })

  test('Detailseite lädt und zeigt Position und Quelle, kein select(*) eingeführt', () => {
    assert.match(detailPage, /zahlungsziel_tage, position, quelle'\)/)
    assert.match(detailPage, /quellen=\{quellen\}/)
    assert.match(detail, /kontakt\.position &&/)
    assert.match(detail, /kontakt\.quelle &&/)
    assert.doesNotMatch(page + detailPage, /from\('kontakte'\)[^\n]*\n?[^\n]*select\('\*'\)/)
  })

  test('CSV-Export Kontakte lädt position und quelle', () => {
    assert.match(quelle('src/app/api/export/kontakte/route.ts'), /erstellt_am, position, quelle'\)/)
  })
})
