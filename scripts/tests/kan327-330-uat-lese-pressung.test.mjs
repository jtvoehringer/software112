// UAT 11.10.2026, Block 3 (Lese und Pressung):
//  KAN-327: Stichtag/Abgabe der Erntemeldung erst sichtbar, wenn eine Meldung angelegt war; Lese-Nummer in den
//           Lesedaten nur bei mehreren Lesen. Jetzt: Rahmen immer (Jahrgangsliste, AMA-Karte), Lese-Kopfzeile immer.
//  KAN-328: Mostgewicht rutschte bei Platzmangel unter die fixierte Aktionsspalte – Mostgewicht/Qualität vor die Notizen.
//  KAN-329: Pressungsformular in der Reihenfolge des Arbeitsablaufs (Eingaben vor den berechneten Angaben).
//  KAN-330: Umbenannte Charge ging beim Klick auf „Abstufen“ (Link im Formular) ohne Rückfrage verloren.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { erntemeldungRahmen, erntemeldungRahmenText } from '../../src/lib/wein/lesen.ts'
import { ausserFuerLink, offeneAenderungen, VERLAESST_ATTR } from '../../src/lib/ui/ungespeichert.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(ROOT, ...p.split('/')), 'utf8')

describe('KAN-327: Erntemeldung – Stichtag und Abgabe immer sichtbar, Lese-Nummer in den Lesedaten', () => {
  test('Stichtag 30.11., Abgabe bis 15.12. des Jahrgangs', () => {
    assert.deepEqual(erntemeldungRahmen(2026), { stichtag: '2026-11-30', abgabefrist: '2026-12-15' })
    assert.equal(erntemeldungRahmenText(2026), 'Erntemeldung: Stichtag 30.11.2026 · Abgabe bis 15.12.2026')
  })

  test('der Server-Stichtag (Erntemeldung, AMA) nutzt dieselbe Quelle', () => {
    const e = quelle('src/lib/behoerden/erntemeldung.ts')
    assert.match(e, /return erntemeldungRahmen\(jahrgang\)\.stichtag/)
  })

  test('Jahrgangsliste und AMA-Karte (ohne Meldung) zeigen den Rahmen', () => {
    assert.match(quelle('src/app/(dashboard)/erntemeldung/JahrgaengeClient.tsx'), /\{erntemeldungRahmenText\(j\.jahrgang\)\}/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/AmaMeldungKarte.tsx'), /\{!amaMeldung && <p[^>]*>\{erntemeldungRahmenText\(jahrgang\)\}<\/p>\}/)
  })

  test('Lesedaten-Tabelle: Kopfzeile „Lese 2026/1 …“ auch bei nur einer Lese', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    assert.match(k, /\{\(i === 0 \|\| tabellenZeilen\[i - 1\]\.lese_nr !== p\.lese_nr\) && \(/)
    assert.doesNotMatch(k, /\{mehrereLesen && \(i === 0 \|\| tabellenZeilen\[i - 1\]\.lese_nr !== p\.lese_nr\)/)
  })
})

describe('KAN-328: Lesedaten – Mostgewicht rutscht nicht mehr unter die Aktionsspalte', () => {
  test('Notizen schmal begrenzt (Reihenfolge nach KAN-144 bleibt), Mostgewicht und Qualität ohne Umbruch', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    const kopf = k.slice(k.indexOf('>Ried</th>'), k.indexOf('</thead>'))
    assert.match(kopf, /<th className="text-left px-3 py-2 font-semibold w-48 max-w-48">Notizen<\/th>/)
    assert.match(kopf, /<th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Mostgewicht<\/th>/)
    assert.match(kopf, /<th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Qualität<\/th>/)
    assert.match(k, /<td className="px-3 py-2 text-xs text-s112-text-2 w-48 max-w-48">\s*<NotizZelle text=\{p\.notizen\} \/>/)
    assert.match(k, /<td className="px-3 py-2 text-right whitespace-nowrap">\s*<MostgewichtAnzeige wert=\{\{ kmw: p\.klosterneuburger/)
  })

  // 2. Anlauf (UAT 11.10.2026, Screenshot): Breitenbegrenzung allein reichte nicht – die am rechten Rand fixierte
  // Aktionsspalte überdeckte bei Platzmangel weiter Mostgewicht und Qualität (samt Spaltenköpfen)
  test('Aktionsspalte nicht fixiert, Mostgewicht nur in der bevorzugten Einheit (beide Werte im Tooltip)', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    const a = k.indexOf('<table className="w-full text-sm min-w-[700px]')
    const tabelle = k.slice(a, k.indexOf('</table>', a))
    assert.ok(a >= 0, 'Lesedaten-Tabelle fehlt')
    assert.doesNotMatch(tabelle, /sticky/)
    assert.match(tabelle, /<MostgewichtAnzeige wert=\{\{ kmw: p\.klosterneuburger, oechsle: p\.oechsle, einheit: p\.mostgewicht_einheit \}\} nurBevorzugt \/>/)
  })
})

describe('KAN-329: Pressungsformular in der Reihenfolge des Arbeitsablaufs', () => {
  test('Datum → gelesene GST (kg, Lesedatum, Mostgewicht) → Mostausbeute → Ø Mostgewicht/Qualität/Bezeichnung → Gebinde', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
    const form = k.slice(k.indexOf("{pressung ? 'Pressung bearbeiten' : 'Pressung erfassen'}"))
    const pos = [
      'aria-label="Datum"',
      '>Gelesene GST</label>',
      'aria-label={`Lesedatum Traubenzeile',
      'label="Mostgewicht" startwert={row.mgStart}',
      'aria-label="Mostausbeute gesamt (L)"',
      'Faustregel: 70 %',
      '>Mostgewicht & Qualitätsstufe</label>',
      'aria-label="Bezeichnung (z.B. Gemischter Satz – optional)"',
      'Most in Behälter/Charge *',
    ].map(t => { const i = form.indexOf(t); assert.ok(i >= 0, `fehlt: ${t}`); return i })
    for (let i = 1; i < pos.length; i++) assert.ok(pos[i - 1] < pos[i], `Reihenfolge an Stelle ${i}`)
  })
})

describe('KAN-330: Link „Abstufen“ im Charge-Formular fragt bei ungespeicherten Eingaben nach', () => {
  // Attrappe: Formular mit Link darin; Dokument mit genau diesem geänderten Formular
  function aufbau(mitAttr) {
    const attrs = new Set(mitAttr ? [VERLAESST_ATTR] : [])
    const link = { hasAttribute: n => attrs.has(n) }
    const form = { contains: n => n === link }
    const doc = { querySelectorAll: () => [form] }
    return { link, form, doc }
  }

  test('Link mit data-verlaesst-formular: das eigene geänderte Formular zählt als offen (Rückfrage)', () => {
    const { link, form, doc } = aufbau(true)
    assert.deepEqual(offeneAenderungen(doc, ausserFuerLink(link)), [form])
  })

  test('Link ohne Attribut im Formular („Abbrechen“): keine Rückfrage für das eigene Formular', () => {
    const { link, doc } = aufbau(false)
    assert.deepEqual(offeneAenderungen(doc, ausserFuerLink(link)), [])
  })

  test('der Schutz nutzt ausserFuerLink, der Abstufen-Link trägt das Attribut', () => {
    assert.match(quelle('src/components/UngespeichertSchutz.tsx'), /offeneAenderungen\(document, ausserFuerLink\(a\)\)/)
    assert.match(quelle('src/components/kellerbuch/WeinausbauForm.tsx'), /href=\{`\/kellerbuch\/weinausbau\/\$\{weinausbau\.id\}\/abstufen`\} data-verlaesst-formular/)
    assert.equal(VERLAESST_ATTR, 'data-verlaesst-formular')
  })
})
