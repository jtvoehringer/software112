// Sweep 8 (07.10.2026) – KAN-174 Kellerbuch (A Suche, B Umziehen vorbelegt, C Gebinde-Auswahl „Inhalt – Charge | frei“,
// D Schwund nur mit Begründung, E eine Zeile je Gebinde mit Füllkreis, F LP-Pickerl) und KAN-175 Herkunft bei der Pressung.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 58 (behaelter.lp_pickerl, lade_behaelter).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan174_lp_pickerl.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan174_lp_pickerl.sql')
}

describe('KAN-174: Anzeige-Bausteine', nurMitHooks, () => {
  const g = () => laden('lib/keller/gebindeAnzeige.ts')
  test('C: Gebinde-Auswahl „Name · Inhalt – Charge | frei“ ohne Kapazität', async () => {
    const { gebindeOption } = await g()
    assert.equal(gebindeOption({ name: 'T5', inhaltLiter: 800, chargen: ['GV Kellerberg'], volumenLiter: 1000 }), 'T5 · 800 L GV Kellerberg | frei 200 L')
    assert.equal(gebindeOption({ name: 'T6', inhaltLiter: 0, volumenLiter: 1500 }), 'T6 · leer | frei 1.500 L')
    assert.equal(gebindeOption({ name: 'Fass', inhaltLiter: 225, chargen: ['ZW'], volumenLiter: null }), 'Fass · 225 L ZW')
    assert.equal(gebindeOption({ name: 'T7', inhaltLiter: 0, volumenLiter: 500, pickerl: 'Huber' }), 'T7 · leer | frei 500 L · LP + Huber')
    assert.doesNotMatch(gebindeOption({ name: 'T5', inhaltLiter: 800, volumenLiter: 1000 }), /Kap/)
  })
  test('E: Kreisfarbe nach der Weinart mit den meisten Litern', async () => {
    const { vorherrschendeWeinart, WEINART_FARBE } = await g()
    assert.equal(vorherrschendeWeinart([{ weinart: 'weiss', liter: 300 }, { weinart: 'rot', liter: 700 }]), 'rot')
    assert.equal(vorherrschendeWeinart([{ weinart: 'rose', liter: 10 }]), 'rose')
    assert.equal(vorherrschendeWeinart([{ weinart: null, liter: 10 }]), 'unbekannt')
    assert.equal(vorherrschendeWeinart([]), 'unbekannt')
    for (const w of ['weiss', 'rot', 'rose', 'unbekannt']) assert.match(WEINART_FARBE[w], /^#[0-9A-F]{6}$/i)
  })
  test('A: Suche über Name, Keller, Charge, Rebsorte – Groß-/Kleinschreibung egal', async () => {
    const { gebindePasst } = await g()
    assert.equal(gebindePasst('', ['T5']), true)
    assert.equal(gebindePasst('t5', ['T5', 'Keller Süd']), true)
    assert.equal(gebindePasst('süd', ['T5', 'Keller Süd']), true)
    assert.equal(gebindePasst('riesling', ['T5', null, 'Grüner Veltliner']), false)
  })
  test('D: Schwund nur mit Begründung; F: Pickerl 1–60 Zeichen', async () => {
    const { schwundGrundFehler, pickerlFehler, pickerlText } = await g()
    assert.match(schwundGrundFehler(''), /Begründung/)
    assert.match(schwundGrundFehler(' x '), /Begründung/)
    assert.equal(schwundGrundFehler('ausgelaufen'), null)
    assert.equal(pickerlFehler(''), null)
    assert.match(pickerlFehler('x'.repeat(61)), /höchstens 60 Zeichen/)
    assert.equal(pickerlText(' Huber '), 'LP + Huber')
    assert.equal(pickerlText(null), null)
  })
})

describe('KAN-175: Herkunft bei Sortenverschnitt in der Pressung', nurMitHooks, () => {
  test('Gebiet mit Sortenspiegel → Bundesland, Bundesland bleibt', async () => {
    const { herkunftFuerSortenverschnitt, minHerkunft } = await laden('lib/herkunft.ts')
    assert.deepEqual(herkunftFuerSortenverschnitt('thermenregion_gebietswein'), { code: 'wlnoe', abgestuft: true })
    assert.deepEqual(herkunftFuerSortenverschnitt('thermenregion_riedenwein'), { code: 'wlnoe', abgestuft: true })
    assert.deepEqual(herkunftFuerSortenverschnitt('wlnoe'), { code: 'wlnoe', abgestuft: false })
    assert.deepEqual(herkunftFuerSortenverschnitt(null), { code: null, abgestuft: false })
    // WLTH + WLTH = WLTH, WLTH + WLNÖ = WLNÖ (wie bisher über minHerkunft)
    assert.equal(minHerkunft(['thermenregion_gebietswein', 'thermenregion_gebietswein']), 'thermenregion_gebietswein')
    assert.equal(minHerkunft(['thermenregion_gebietswein', 'wlnoe']), 'wlnoe')
  })
  test('Pressung: nach der Sortenermittlung bei mehreren Sorten angewendet', () => {
    const a = quelle(`${D}/erntemeldung/actions.ts`)
    assert.match(a, /if \(uniqueRebsorten\.length > 1\) herkunft = herkunftFuerSortenverschnitt\(herkunft\)\.code/)
    assert.match(a, /if \(unique\.length > 1\) herkunft = herkunftFuerSortenverschnitt\(herkunft\)\.code/)
  })
})

describe('KAN-174: Verdrahtung', () => {
  test('A/E/F Übersicht: Suche, Zeile mit Füllkreis, Pickerl mit Entfernen, keine Weinart-Knöpfe', () => {
    const p = quelle(`${D}/kellerbuch/page.tsx`)
    assert.match(p, /<input type="search" name="q"/)
    assert.match(p, /behaelter\.filter\(b => b\.aktiv && trifft\(b\)\)/)
    assert.match(p, /<FuellKreis pct=\{auslastung\}/)
    assert.doesNotMatch(p, /WEINART_BADGE/)
    assert.match(p, /<PickerlEntfernen behaelterId=\{b\.id\}/)
  })
  test('E (Abnahme 07.10.2026): Gebindename breit genug, voller Name als Tooltip – belegt und leer', () => {
    const p = quelle(`${D}/kellerbuch/page.tsx`)
    assert.equal(p.match(/<span title=\{b\.name\} className="font-(semibold|medium) text-s112-text w-32 sm:w-56 shrink-0 truncate">\{b\.name\}<\/span>/g)?.length, 2)
    assert.doesNotMatch(p, /w-24 shrink-0[^"]*">\{b\.name\}/)
  })
  test('B: „Umziehen“ vom Gebinde mit von=<Behälter>, Quelle vorbelegt', () => {
    assert.match(quelle(`${D}/kellerbuch/behaelter/[id]/umzuege/page.tsx`), /\/kellerbuch\/umziehen\?neu=1&von=\$\{id\}/)
    assert.match(quelle(`${D}/kellerbuch/behaelter/[id]/bewegungen/page.tsx`), /\/kellerbuch\/umziehen\?neu=1&von=\$\{id\}/)
    assert.match(quelle(`${D}/kellerbuch/umziehen/page.tsx`), /vonBehaelter=\{vonBehaelter\}/)
    assert.match(quelle(`${D}/kellerbuch/umziehen/UmziehenClient.tsx`), /quellen\.find\(q => q\.behaelter_id === vonBehaelter\)\?\.charge_id/)
  })
  test('C: alle Gebinde-Auswahlen über gebindeOption', () => {
    for (const f of [`${D}/kellerbuch/umziehen/UmziehenClient.tsx`, 'src/components/kellerbuch/UmziehenWidget.tsx',
      `${D}/erntemeldung/[id]/PressungSection.tsx`, `${D}/weinhandel/zukauf/neu/page.tsx`, `${D}/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx`]) {
      const s = quelle(f)
      assert.match(s, /gebindeOption\(\{/, f)
      assert.doesNotMatch(s, / Kap · /, f)
    }
  })
  test('D: Begründung in Formular und Server Action', () => {
    assert.match(quelle(`${D}/kellerbuch/weinausbau/[id]/SchwundBuchenForm.tsx`), /Begründung \*/)
    assert.match(quelle(`${D}/kellerbuch/actions.ts`), /const gf = schwundGrundFehler\(notiz\)/)
  })
  test('F: Pickerl in Formular, Actions, Lader und Migration', () => {
    assert.match(quelle('src/components/kellerbuch/BehaelterForm.tsx'), /name="lp_pickerl"/)
    const a = quelle(`${D}/kellerbuch/actions.ts`)
    assert.equal((a.match(/\.\.\.pickerlAusFormular\(formData\)/g) ?? []).length, 2)
    assert.match(a, /export async function pickerlEntfernen/)
    assert.match(quelle('src/lib/keller/behaelter.ts'), /lp_pickerl: r\.lp_pickerl \?\? null/)
    const m = migration()
    assert.match(m, /CHECK \(lp_pickerl IS NULL OR length\(btrim\(lp_pickerl\)\) BETWEEN 1 AND 60\)/)
    assert.match(m, /fremd_betrieb text, lp_pickerl text\)/)
    assert.match(m, /GRANT EXECUTE ON FUNCTION public\.lade_behaelter\(uuid\) TO authenticated, service_role/)
  })
})
