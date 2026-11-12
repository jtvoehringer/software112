// KAN-413 (11.11.2026) – Sammelmaßnahme im Kellerbuch: dieselbe Behandlung für mehrere Gebinde, Menge und Stoff anteilig
// nach Litern (oder Dosis je hl), alles oder nichts über die RPC s112_kellerbehandlung_sammel.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m = () => laden('lib/kellerbuch/sammelbehandlung.ts')
const c = (liter, i) => ({ chargeId: `c${i}`, behaelterId: `b${i}`, liter })
const chargen = (...liter) => liter.map(c)

describe('KAN-413: Aufteilung nach Litern', nurMitHooks, () => {
  test('35 g auf 1.000/500/250 l → 20/10/5 g', async () => {
    const { verteileNachLitern } = await m()
    assert.deepEqual(verteileNachLitern(35, [1000, 500, 250]), [20, 10, 5])
  })
  test('Rundungsrest geht auf die größte Charge, die Summe stimmt exakt', async () => {
    const { verteileNachLitern } = await m()
    const a = verteileNachLitern(10, [100, 100, 100])
    assert.deepEqual(a, [3.334, 3.333, 3.333])   // gleich groß: Rest auf die erste
    const b = verteileNachLitern(1, [300, 700, 500])
    assert.equal(Number((b[0] + b[1] + b[2]).toFixed(3)), 1)
    assert.deepEqual(b, [0.2, 0.467, 0.333])     // 0,2 + 0,4667 + 0,3333 → Rest 0 nach Rundung
    const d = verteileNachLitern(0.1, [1, 1, 1, 1, 1, 1, 1])
    assert.equal(Number(d.reduce((s, x) => s + x, 0).toFixed(3)), 0.1)
  })
  test('ohne Liter oder ohne Menge lauter Nullen; negative und kaputte Liter zählen als 0', async () => {
    const { verteileNachLitern } = await m()
    assert.deepEqual(verteileNachLitern(5, [0, 0]), [0, 0])
    assert.deepEqual(verteileNachLitern(0, [10, 20]), [0, 0])
    assert.deepEqual(verteileNachLitern(6, [100, -5, NaN, 200]), [2, 0, 0, 4])
  })
  test('Dosis je hl: 2 g/hl auf 1.000/500/250 l → 20/10/5 g', async () => {
    const { mengenAusDosis } = await m()
    assert.deepEqual(mengenAusDosis(2, [1000, 500, 250]), [20, 10, 5])
    assert.deepEqual(mengenAusDosis(2.5, [225]), [5.625])
  })
})

describe('KAN-413: Zeilen und Prüfung', nurMitHooks, () => {
  test('Zeilen: Menge nach Modus, Stoff immer anteilig; ohne Menge/Stoff null', async () => {
    const { sammelZeilen, sammelSumme } = await m()
    const z = sammelZeilen({ chargen: chargen(1000, 500, 250), modus: 'gesamt', menge: 35, stoffGesamt: 0.07 })
    assert.deepEqual(z.map(x => x.menge), [20, 10, 5])
    assert.deepEqual(z.map(x => x.stoffMenge), [0.04, 0.02, 0.01])
    assert.equal(sammelSumme(z, 'menge'), 35)
    assert.equal(sammelSumme(z, 'stoffMenge'), 0.07)
    assert.equal(sammelSumme(z, 'liter'), 1750)
    const d = sammelZeilen({ chargen: chargen(1000, 500), modus: 'dosis', menge: 2, stoffGesamt: null })
    assert.deepEqual(d.map(x => [x.menge, x.stoffMenge]), [[20, null], [10, null]])
    const o = sammelZeilen({ chargen: chargen(1000, 500), modus: 'gesamt', menge: null, stoffGesamt: null })
    assert.deepEqual(o.map(x => x.menge), [null, null])
  })
  test('Fehler: weniger als zwei, doppelt, 0 l, Modus, Menge, zu kleine Anteile, Stoff ohne Menge', async () => {
    const { sammelFehler, SAMMEL_MAX } = await m()
    const ok = { chargen: chargen(1000, 500), modus: 'gesamt', menge: 30, einheit: 'g', stoffId: null, stoffGesamt: null }
    assert.equal(sammelFehler(ok), null)
    assert.match(sammelFehler({ ...ok, chargen: chargen(1000) }), /mindestens zwei Gebinde/)
    assert.match(sammelFehler({ ...ok, chargen: [c(10, 1), c(20, 1)] }), /doppelt/)
    assert.match(sammelFehler({ ...ok, chargen: chargen(1000, 0) }), /keine Menge \(0 L\)/)
    assert.match(sammelFehler({ ...ok, modus: 'x' }), /Gesamtmenge oder als Dosis/)
    assert.match(sammelFehler({ ...ok, menge: null }), /Bitte die Menge angeben/)
    assert.match(sammelFehler({ ...ok, menge: 0 }), /größer als 0/)
    assert.equal(sammelFehler({ ...ok, menge: null, einheit: '-' }), null)   // ohne Mengenangabe
    assert.match(sammelFehler({ ...ok, menge: 0.001, chargen: chargen(1000, 1) }), /Anteil von 0/)
    assert.match(sammelFehler({ ...ok, stoffId: 's1' }), /verwendete Menge des Stoffs/)
    assert.match(sammelFehler({ ...ok, stoffId: 's1', stoffGesamt: 0.001, chargen: chargen(1000, 1) }), /Stoffmenge ist zu klein/)
    assert.equal(sammelFehler({ ...ok, stoffId: 's1', stoffGesamt: 0.5 }), null)
    assert.match(sammelFehler({ ...ok, chargen: Array.from({ length: SAMMEL_MAX + 1 }, (_, i) => c(10, i)) }), /höchstens/)
  })
})

describe('KAN-413: Server Action, Seite und Migration', () => {
  test('Server Action: Rechte vor allem, eine Prüfnummer-Rückfrage für alle Chargen, Speichern nur über die RPC', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/sammelbehandlung/actions.ts')
    assert.match(a, /^'use server'/)
    const seite = a.indexOf('pruefeSeitenBetrieb('), sperre = a.indexOf('pruefeSchreibzugriff('), recht = a.indexOf("canWrite(membership, 'kellerbuch')")
    assert.ok(seite > 0 && sperre > seite && recht > sperre, 'Reihenfolge Seitenbetrieb → Schreibsperre → Recht')
    assert.match(a, /sammelFehler\(/)
    assert.match(a, /pruefePruefnummernSchaden\(supabase, tenantId, 'behandlung', ziele, datum\)/)
    assert.match(a, /pn_bestaetigt/)
    assert.match(a, /\.rpc\('s112_kellerbehandlung_sammel'/)
    assert.doesNotMatch(a, /from\('keller_behandlungen'\)[^\n]*\)\s*\.insert/)   // kein Einzel-Insert an der RPC vorbei
    assert.match(a, /export async function storniereSammelbehandlung/)
  })
  test('Seite und Formular: Vorschau rechnet mit demselben Baustein', () => {
    const cl = quelle('src/app/(dashboard)/kellerbuch/sammelbehandlung/SammelClient.tsx')
    assert.match(cl, /sammelZeilen\(/)
    assert.match(cl, /sammelFehler\(/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/sammelbehandlung/page.tsx'), /Sammelmaßnahme/)
    // UAT 12.11.2026: eigener Menüpunkt zwischen Produktion und Kellerplan statt Knopf in der Gebinde-Übersicht
    const nav = quelle('src/lib/navigation/index.ts')
    const p = nav.indexOf("href: '/kellerbuch/produktion'"), s = nav.indexOf("href: '/kellerbuch/sammelbehandlung', label: 'Sammelmaßnahmen'"), k = nav.indexOf("href: '/kellerbuch/kellerplan'")
    assert.ok(p >= 0 && s > p && k > s, `Reihenfolge Produktion ${p} · Sammelmaßnahmen ${s} · Kellerplan ${k}`)
    assert.doesNotMatch(quelle('src/app/(dashboard)/kellerbuch/page.tsx'), /\/kellerbuch\/sammelbehandlung/)
    // nach dem Speichern zurück in die Gebinde-Übersicht; Storno-Formular in der Zelle (nicht schwebend im Scrollbereich)
    assert.match(cl, /if \(r\.hinweis\) router\.refresh\(\)\n\s+else router\.push\('\/kellerbuch'\)/)
    assert.match(cl, /<StornoButton mitText label="Ganze Sammelmaßnahme stornieren"/)
    assert.doesNotMatch(cl, /<StornoButton schwebend/)
  })
  test('Migration: Spalte mit Index, INVOKER-RPC mit Zugriffsprüfung und ohne EXECUTE für anon', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const datei = readdirSync(dir).find(f => /kan413_sammelbehandlung\.sql$/.test(f))
    const entwurf = new URL('../../supabase/entwurf/kan413_sammelbehandlung.sql', import.meta.url)
    // Entwurfsordner ist nicht eingecheckt: vor dem Einspielen gibt es die Datei nur dort, in der CI nur unter migrations/
    if (!datei && !existsSync(entwurf)) return
    const sql = (datei ? readFileSync(new URL(datei, dir), 'utf8') : readFileSync(entwurf, 'utf8')).replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN sammel_id uuid/)
    assert.match(sql, /CREATE INDEX[^;]*sammel_id/)
    assert.match(sql, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin','tenant_admin','winzer'\]\)/)
    assert.match(sql, /SET search_path = public/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_kellerbehandlung_sammel\([^)]*\) FROM PUBLIC, anon/)
    assert.doesNotMatch(sql, /SECURITY DEFINER/)
  })
})

// UAT 12.11.2026 (Nebenbefund): Bei „Gärtemperatur“ fehlte die Einheit °C. Ein Messwert wird nicht nach Litern
// aufgeteilt – jedes Gebinde bekommt denselben Wert.
describe('KAN-413: Messwert in °C', nurMitHooks, () => {
  test('Einheiten wie bei der Einzelbehandlung, samt °C', async () => {
    const { SAMMEL_EINHEITEN, istMesswertEinheit } = await m()
    assert.deepEqual([...SAMMEL_EINHEITEN], ['kg', 'g', 'L', 'mL', 'mg', '°C', '-'])
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx').includes("const EINHEITEN = ['kg', 'g', 'L', 'mL', 'mg', '°C', '-']"))
    assert.equal(istMesswertEinheit('°C'), true)
    for (const e of ['g', 'kg', '-', '', null, undefined]) assert.equal(istMesswertEinheit(e), false, String(e))
  })
  test('°C: derselbe Wert je Gebinde, unabhängig von den Litern; Stoff weiter nach Litern', async () => {
    const { sammelZeilen, sammelModusFuer } = await m()
    assert.equal(sammelModusFuer('°C', 'gesamt'), 'gleich')
    assert.equal(sammelModusFuer('°C', 'dosis'), 'gleich')
    assert.equal(sammelModusFuer('g', 'dosis'), 'dosis')
    assert.equal(sammelModusFuer('g', 'gleich'), 'gesamt')   // „gleich“ nie für Stoffmengen
    const z = sammelZeilen({ chargen: chargen(1000, 500, 250), modus: 'gleich', menge: 18.5, stoffGesamt: 35 })
    assert.deepEqual(z.map(x => x.menge), [18.5, 18.5, 18.5])
    assert.deepEqual(z.map(x => x.stoffMenge), [20, 10, 5])
  })
  test('Prüfung: °C nur als Wert je Gebinde und über 0; Stoffmengen nie als „gleich“', async () => {
    const { sammelFehler } = await m()
    const ok = { chargen: chargen(1000, 500), modus: 'gleich', menge: 18, einheit: '°C', stoffId: null, stoffGesamt: null }
    assert.equal(sammelFehler(ok), null)
    assert.match(sammelFehler({ ...ok, modus: 'gesamt' }), /Temperatur gilt je Gebinde/)
    assert.match(sammelFehler({ ...ok, einheit: 'g' }), /nur für Messwerte/)
    assert.match(sammelFehler({ ...ok, menge: null }), /Temperatur angeben/)
    assert.match(sammelFehler({ ...ok, menge: 0 }), /über 0 °C/)
    assert.match(sammelFehler({ ...ok, menge: -4 }), /Einzelbehandlung/)
    // ein sehr kleiner Wert ist bei °C kein „Anteil von 0“
    assert.equal(sammelFehler({ ...ok, menge: 0.5, chargen: chargen(100000, 1) }), null)
  })
  test('Formular: bei °C ein Feld „Temperatur“, keine Wahl Gesamtmenge/Dosis; Liste zeigt den Wert je Gebinde', () => {
    const cl = quelle('src/app/(dashboard)/kellerbuch/sammelbehandlung/SammelClient.tsx')
    assert.ok(cl.includes('const EINHEITEN: readonly string[] = SAMMEL_EINHEITEN'))
    assert.ok(cl.includes('const modus = sammelModusFuer(einheit, modusWahl)'))
    assert.ok(cl.includes("{einheit !== '-' && !messwert && ("))
    assert.ok(cl.includes('Temperatur ({einheit}) – gilt für jedes gewählte Gebinde'))
    assert.ok(cl.includes('fmtNum(s.menge / (s.anzahl - s.storniert), 1)'))
  })
})
