// KAN-107 (07.10.2026) – Besondere Konten: Stoffkonto im Kellerbuch (Stoffe vom Betrieb angelegt, Einheit kg oder l –
// Entscheidung Jörgen 06.10.2026), Buchungen append-only, Verwendung aus der Kellerbehandlung, Meldung je
// Weinwirtschaftsjahr.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 59 (append-only, Vorzeichen, Storno einmal, Stempel, Stoff mit Buchungen nicht löschbar).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan107_stoffkonto.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan107_stoffkonto.sql')
}
const k = () => laden('lib/kellerbuch/stoffkonto.ts')

describe('KAN-107: Kontoauszug', nurMitHooks, () => {
  test('chronologisch mit laufendem Saldo, Storno gekennzeichnet, Warnung bei negativem Bestand', async () => {
    const { kontoauszug } = await k()
    const a = kontoauszug([
      { id: 'v', datum: '2026-09-20', art: 'verwendung', menge: -12.5, erstellt_am: '2026-09-20T10:00:00Z' },
      { id: 'z', datum: '2026-09-01', art: 'zugang', menge: 25, erstellt_am: '2026-09-01T08:00:00Z' },
      { id: 's', datum: '2026-09-21', art: 'storno', menge: 12.5, storno_von_id: 'v', erstellt_am: '2026-09-21T08:00:00Z' },
      { id: 'w', datum: '2026-09-22', art: 'verwendung', menge: -30, erstellt_am: '2026-09-22T08:00:00Z' },
    ])
    assert.deepEqual(a.zeilen.map(z => [z.id, z.saldo, z.storniert]), [['z', 25, false], ['v', 12.5, true], ['s', 25, false], ['w', -5, false]])
    assert.equal(a.saldo, -5)
    assert.match(a.warnungen[0], /Negativer Bestand ab 22\.09\.2026/)
  })
  test('Mengen mit Vorzeichen, Inventurdifferenz, Saldo zum Stichtag', async () => {
    const { buchungsMenge, inventurDifferenz, saldoBis } = await k()
    assert.deepEqual(buchungsMenge('zugang', 10), { menge: 10 })
    assert.deepEqual(buchungsMenge('verwendung', 2.5), { menge: -2.5 })
    assert.match(buchungsMenge('zugang', -1).fehler, /größer als 0/)
    assert.match(buchungsMenge('anfangsbestand', null).fehler, /Menge/)
    assert.deepEqual(buchungsMenge('inventur', -0.4), { menge: -0.4 })
    assert.equal(inventurDifferenz(9.6, 10), -0.4)
    assert.equal(saldoBis([{ id: 'a', datum: '2026-08-01', art: 'zugang', menge: 5 }, { id: 'b', datum: '2026-09-01', art: 'zugang', menge: 3 }], '2026-08-15'), 5)
  })
  test('Stoffkonto-Typen und Weinwirtschaftsjahr', async () => {
    const { istStoffkontoTyp, weinwirtschaftsjahr } = await k()
    for (const t of ['Zuckerung', 'Anreicherung mit RTK', 'KTM-Zugabe', 'Säuerung', 'Entsäuerung']) assert.equal(istStoffkontoTyp(t), true, t)
    for (const t of ['Filtration', 'Schwefelung', null]) assert.equal(istStoffkontoTyp(t), false, String(t))
    assert.deepEqual(weinwirtschaftsjahr('2026-10-07'), { label: '2026/27', von: '2026-08-01', bis: '2027-07-31' })
    assert.deepEqual(weinwirtschaftsjahr('2026-07-31'), { label: '2025/26', von: '2025-08-01', bis: '2026-07-31' })
  })
})

describe('KAN-107: Datenbank und Verdrahtung', () => {
  test('Migration: append-only, Vorzeichen, Storno einmal, Stempel, Einheit kg|l', () => {
    const m = migration()
    assert.match(m, /einheit\s+text NOT NULL CHECK \(einheit IN \('kg', 'l'\)\)/)
    assert.match(m, /REVOKE UPDATE, DELETE ON public\.kellermittel_buchungen FROM authenticated/)
    assert.match(m, /CONSTRAINT kellermittel_buchungen_vorzeichen CHECK/)
    assert.match(m, /CREATE UNIQUE INDEX kellermittel_buchungen_storno_einmal/)
    assert.match(m, /CREATE TRIGGER a_stempel BEFORE INSERT ON public\.kellermittel_buchungen/)
    assert.match(m, /kellermittel_id      uuid NOT NULL REFERENCES public\.kellermittel\(id\) ON DELETE RESTRICT/)
    for (const sp of ['kellermittel_id', 'keller_behandlung_id', 'weinausbau_id', 'behaelter_id', 'storno_von_id']) {
      assert.match(m, new RegExp(`CREATE TRIGGER z_fremdverweis_${sp} `), sp)
    }
  })
  test('Kellerbehandlung bucht die Verwendung, Storno die Gegenbuchung; Pflicht bei Stoffkonto-Typen', () => {
    const a = quelle(`${D}/kellerbuch/actions.ts`)
    assert.match(a, /art: 'verwendung', menge: -Math\.round\(stoff\.menge \* 1000\) \/ 1000/)
    assert.match(a, /\} else if \(istStoffkontoTyp\(typ\.name as string\)\) \{/)
    assert.match(a, /art: 'storno', menge: -Number\(b\.menge\),\n\s+storno_von_id: b\.id, keller_behandlung_id: id/)
    const f = quelle(`${D}/kellerbuch/behaelter/[id]/behandlungen/page.tsx`)
    assert.match(f, /if \(!editId && formStoffId\) \{ fd\.set\('kellermittel_id', formStoffId\)/)
    assert.match(f, /required=\{pflicht\}/)
  })
  test('Seite, Meldung „besondere-konten“ (Weinwirtschaftsjahr), Navigation', () => {
    assert.match(quelle(`${D}/kellerbuch/besondere-konten/page.tsx`), /^\/\/ behoerdenmeldung: besondere-konten/)
    assert.match(quelle('src/lib/behoerden/katalog/kellerbuch.ts'), /'besondere-konten': \{[\s\S]{0,200}zugriff: 'betriebsleitung'/)
    assert.match(quelle('src/lib/behoerden/register/kellerbuch.ts'), /if \(!\/\^\\d\{4\}\$\/\.test\(j\)\)/)
    assert.match(quelle('src/lib/navigation/index.ts'), /href: '\/kellerbuch\/besondere-konten'/)
    const act = quelle(`${D}/kellerbuch/besondere-konten/actions.ts`)
    assert.doesNotMatch(act, /\.update\([^)]*\)[^\n]*kellermittel_buchungen|kellermittel_buchungen'\) as R\)\.(update|delete)/)
  })
})
