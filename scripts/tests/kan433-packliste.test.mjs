// KAN-433 (12.11.2026): Weinexport Teil B – Packliste, Warenbeschreibung, Mustersendung (Epic KAN-431).
// Befund (ÖWM-Leitfaden „Begleitdokumente für den Weinexport“): Die Packliste fehlte ganz, die Dokumente nannten zur
// Position nur die Bezeichnung, die Dokumentarten standen an drei Stellen. Jetzt: eine Liste der Dokumentarten,
// Packliste als Standard-Dokument mit fortlaufenden Kartonnummern, zweite Zeile der Warenbeschreibung in EUR.1, CMR,
// Ursprungszeugnis, Lieferschein und Rechnung; fehlende Werte stehen als „–“, nie geschätzt.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXPORT_DOKUMENTE, EXPORT_DOKUMENT_ARTEN, EXPORT_DOKUMENT_LABEL, EXPORT_STANDARD_DOKUMENTE, EXPORT_WAEHLBARE_DOKUMENTE,
  MUSTERSENDUNG_VERMERK, anbruchFlaschen, farbeGroesse, flascheText, hatDruckansicht, kartonAufschluesselung, kartonNummern,
  kartonText, kartonsGesamt, warenbeschreibung, zahlDe,
} from '../../src/lib/export/dokumente.ts'
import { exportKopf } from '../../src/lib/export/auftragEingabe.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}
const ROUTE = 'src/app/api/weinexport/[id]/dokument/[art]/route.ts'

describe('KAN-433: Dokumentarten an einer Stelle', () => {
  test('Packliste ist Standard (1A), Phytosanitär nicht mehr wählbar (2A), Health Certificate ohne Druckansicht', () => {
    assert.deepEqual([...EXPORT_STANDARD_DOKUMENTE], ['v1v2', 'eur1', 'packliste', 'lieferschein', 'rechnung'])
    assert.ok(!EXPORT_WAEHLBARE_DOKUMENTE.includes('phytosanitaer'))
    assert.ok(EXPORT_DOKUMENT_ARTEN.includes('phytosanitaer'), 'bestehende Einträge bleiben sichtbar')
    assert.equal(EXPORT_DOKUMENT_LABEL.phytosanitaer, 'Phytosanitäres Zertifikat')
    assert.ok(EXPORT_WAEHLBARE_DOKUMENTE.includes('health_certificate') && EXPORT_WAEHLBARE_DOKUMENTE.includes('packliste'))
    assert.equal(hatDruckansicht('packliste'), true)
    assert.equal(hatDruckansicht('health_certificate'), false)
    assert.equal(hatDruckansicht('phytosanitaer'), false)
    assert.equal(hatDruckansicht('gibtsnicht'), false)
    for (const d of EXPORT_DOKUMENTE) assert.ok(d.art.length <= 30, `${d.art}: dokument_art ist varchar(30)`)
    assert.equal(new Set(EXPORT_DOKUMENT_ARTEN).size, EXPORT_DOKUMENT_ARTEN.length)
  })

  test('jede Art mit Druckansicht hat einen Fall in der Route – und umgekehrt', () => {
    const r = quelle(ROUTE)
    const faelle = [...r.matchAll(/^    case '([a-z0-9_]+)':/gm)].map(m => m[1]).sort()
    assert.deepEqual(faelle, EXPORT_DOKUMENTE.filter(d => d.druck).map(d => d.art).sort())
  })

  test('Routen, Liste und Detailseite nehmen die Arten aus dokumente.ts', () => {
    assert.match(quelle('src/app/api/weinexport/route.ts'), /const STANDARD_DOKUMENTE = EXPORT_STANDARD_DOKUMENTE/)
    assert.match(quelle('src/app/api/weinexport/[id]/dokument/route.ts'), /const DOKUMENT_ARTEN: readonly string\[\] = EXPORT_WAEHLBARE_DOKUMENTE/)
    const b = quelle('src/lib/behoerden/exportauftrag.ts')
    assert.match(b, /export const EXPORT_DOK_LABEL: Record<string, string> = EXPORT_DOKUMENT_LABEL/)
    assert.match(b, /export const EXPORT_DOK_ARTEN: readonly string\[\] = EXPORT_DOKUMENT_ARTEN/)
    const c = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')
    assert.match(c, /\{hatDruckansicht\(dok\.dokument_art\) && \(/)
    assert.match(c, /\.filter\(d => d\.waehlbar && !dokumente\.some\(x => x\.dokument_art === d\.art\)\)/)
    assert.doesNotMatch(c, /dok\.dokument_art === 'v1v2'/)
  })
})

describe('KAN-433: Packliste', () => {
  test('Kartonnummern laufen über die Positionen; ohne Kartons keine Nummer', () => {
    const n = kartonNummern([{ kartons: 20 }, { kartons: null }, { kartons: 5 }, { kartons: 1 }, { kartons: 0 }, { kartons: 2.5 }])
    assert.deepEqual(n, [{ von: 1, bis: 20 }, null, { von: 21, bis: 25 }, { von: 26, bis: 26 }, null, null])
    assert.deepEqual(n.map(kartonText), ['01–20', '–', '21–25', '26', '–', '–'])
    assert.equal(kartonText({ von: 99, bis: 120 }), '99–120')
  })

  test('Anbruchkarton wird ausgewiesen, keine Mischkartons (3A)', () => {
    assert.equal(anbruchFlaschen({ flaschen: 147, flaschenJeKarton: 6, kartons: 25 }), 3)
    assert.equal(anbruchFlaschen({ flaschen: 144, flaschenJeKarton: 6, kartons: 24 }), 0)
    assert.equal(anbruchFlaschen({ flaschen: 147, flaschenJeKarton: null, kartons: null }), 0)
    const p = [{ flaschen: 147, flaschenJeKarton: 6, kartons: 25 }, { flaschen: 36, flaschenJeKarton: 12, kartons: 3 }, { flaschen: 12, flaschenJeKarton: 6, kartons: 2 }, { flaschen: 1, flaschenJeKarton: 6, kartons: 1 }]
    assert.equal(kartonAufschluesselung(p), '3 Kartons à 12 Flaschen, 26 Kartons à 6 Flaschen, 1 Karton mit 3 Flaschen, 1 Karton mit 1 Flasche')
    assert.equal(kartonAufschluesselung([{ flaschen: 6, flaschenJeKarton: 6, kartons: 1 }], 'en'), '1 box each 6 bottles')
    assert.equal(kartonAufschluesselung([{ flaschen: 30, flaschenJeKarton: null, kartons: null }]), '')
  })

  test('Kartons gesamt: lose Ware zählt nicht, eine Flaschenposition ohne Kartons macht die Summe unbestimmt', () => {
    assert.equal(kartonsGesamt([{ flaschen: 120, kartons: 20 }, { flaschen: null, kartons: null }, { flaschen: 30, kartons: 5 }]), 25)
    assert.equal(kartonsGesamt([{ flaschen: 120, kartons: 20 }, { flaschen: 30, kartons: null }]), null)
    assert.equal(kartonsGesamt([]), 0)
  })

  test('Zahlen deutsch und ohne überflüssige Nullen; fehlend = „–“', () => {
    assert.deepEqual([zahlDe(22.5), zahlDe(30), zahlDe(0.375, 3), zahlDe(12.5, 1), zahlDe(1.005, 2), zahlDe(null), zahlDe(undefined), zahlDe(NaN)],
      ['22,5', '30', '0,375', '12,5', '1,01', '–', '–', '–'])
    assert.equal(zahlDe(0), '0')
    assert.equal(zahlDe(100), '100', 'Nullen vor dem Komma bleiben')
    assert.equal(flascheText(750), '0,75 l')
    assert.equal(flascheText(1500), '1,5 l')
    assert.equal(flascheText(null), null)
    assert.equal(farbeGroesse({ farbe: 'Weiß', flaschengroesseMl: 750 }), 'Weiß / 0,75 l')
    assert.equal(farbeGroesse({ farbe: null, flaschengroesseMl: 375 }), '0,375 l')
    assert.equal(farbeGroesse({ farbe: null, flaschengroesseMl: null }), '–')
  })
})

describe('KAN-433: Warenbeschreibung', () => {
  test('vollständig: Jahrgang · Farbe · Größe · Alkohol · Prüfnummer · Flaschen in Kartons · Liter', () => {
    assert.equal(
      warenbeschreibung({ jahrgang: '2025', farbe: 'Weiß', flaschengroesseMl: 750, alkohol: 12.5, pruefnummer: 'N 12345/26', flaschen: 30, kartons: 5, liter: 22.5 }),
      '2025 · Weiß · 0,75 l · alc. 12,5 % vol · Prüfnr. N 12345/26 · 30 Fl. in 5 Kartons · 22,5 l')
    assert.equal(warenbeschreibung({ flaschen: 6, kartons: 1, liter: 4.5 }), '6 Fl. in 1 Karton · 4,5 l')
  })
  test('fehlende Angaben fallen weg – nichts wird geschätzt (5A)', () => {
    assert.equal(warenbeschreibung({ jahrgang: '2024', flaschen: 30, kartons: null, liter: null, alkohol: null }), '2024 · 30 Fl.')
    assert.equal(warenbeschreibung({ liter: 200, alkohol: 13 }), 'alc. 13 % vol · 200 l')
    assert.equal(warenbeschreibung({}), '')
  })
})

describe('KAN-433: Druckansichten', () => {
  const r = quelle(ROUTE)
  test('abgeleitete Angaben kommen aus der gemeinsamen Ladefunktion, Reihenfolge wie dort', () => {
    assert.match(r, /erg = await ladeExportauftrag\(supabase, tenantId, \{ id: auftragId \}\)/)
    assert.match(r, /\.eq\('exportauftrag_id', auftragId\)\.order\('sort_order'\)\.order\('id'\)/)
    assert.match(r, /const dz = erg && erg\.zeilen\.length === pos\.length \? erg\.zeilen : \[\]/, 'bei abweichender Anzahl lieber keine Zusatzzeile als die falsche')
  })
  test('Warenbeschreibung in EUR.1, CMR, Ursprungszeugnis, Lieferschein und Rechnung – immer über escHtml', () => {
    assert.equal(r.split('${wb(i)').length - 1, 5)
    assert.match(r, /return text \? `<div class="wb">\$\{e\(text\)\}<\/div>` : ''/)
    assert.match(r, /<td style="text-align:right">\$\{e\(dz\[i\]\?\.kartons \?\? '–'\)\}<\/td>/, 'CMR: Anzahl Pakete = Kartons')
  })
  test('Hinweisleiste nur am Bildschirm, ohne Link (Sandbox), Texte escaped', () => {
    assert.match(r, /@media print\{body\{padding:0\}@page\{margin:15mm\}\.hinweis-leiste\{display:none\}\}/)
    assert.match(r, /fehlt\.slice\(0, 8\)\.map\(text => `<li>\$\{e\(text\)\}<\/li>`\)/)
    const leiste = r.slice(r.indexOf('const hinweisLeiste ='), r.indexOf('const leiste ='))
    assert.doesNotMatch(leiste, /<a |href=/)
    assert.equal(r.split('${leiste}').length - 1, 6, 'alle Dokumente außer V1/V2')
    assert.equal(r.split('${druckleiste()}').length - 1, 1, 'V1/V2 bleibt bis KAN-435 unverändert')
  })
  test('Packliste: Kartonnummern, Summen, Liter nach Farbe, Ursprungsland', () => {
    const p = r.slice(r.indexOf("case 'packliste': {"), r.indexOf('    default:'))
    assert.ok(p.length > 500)
    for (const teil of ['kartonText(nummern[i] ?? null)', 'kartonAufschluesselung(dz)', 'summen?.literWeiss', 'summen?.literRot', 'Ursprungsland / Country of Origin', 'PACKING LIST', '${muster}', 'gew.positionen[i]?.bruttoKg']) {
      assert.ok(p.includes(teil), `Packliste ohne ${teil}`)
    }
    // Werte aus der Datenbank stehen nie ungeschützt im HTML
    assert.doesNotMatch(p, /\$\{(a|b|p|auftrag|dz\[i\]|summen)\??\.[\w?.]+\}/)
  })
  test('Mustersendung: Vermerk auf Packliste und Rechnung, sonst nirgends', () => {
    assert.equal(MUSTERSENDUNG_VERMERK, 'Mustersendung – ohne Handelswert / Samples – no commercial value')
    assert.match(r, /const muster = a\.mustersendung \? `<div class="muster">\$\{e\(MUSTERSENDUNG_VERMERK\)\}<\/div>` : ''/)
    assert.equal(r.split('${muster}').length - 1, 2)
    const rechnung = r.slice(r.indexOf("case 'rechnung':"), r.indexOf("case 'packliste': {"))
    assert.ok(rechnung.includes('${muster}'))
  })
})

describe('KAN-433: Mustersendung am Auftrag (4B)', () => {
  test('Eingabe: nur ein ausdrückliches Ja zählt', () => {
    const basis = { datum: '2026-11-12', destination_land: 'DE' }
    assert.equal(exportKopf({ ...basis, mustersendung: true }, 'DE').mustersendung, true)
    assert.equal(exportKopf({ ...basis, mustersendung: 'true' }, 'DE').mustersendung, true)
    for (const v of [false, 'false', '', null, undefined, 1, 'ja']) assert.equal(exportKopf({ ...basis, mustersendung: v }, 'DE').mustersendung, false, String(v))
  })
  test('Migration: Spalte mit Vorgabe nein, RPC nimmt das Kennzeichen an genau einer Stelle', () => {
    const m = migration('kan433_mustersendung')
    assert.match(m, /ADD COLUMN mustersendung boolean NOT NULL DEFAULT false;/)
    assert.match(m, /mustersendung       = coalesce\(p_kopf ->> ''mustersendung'', ''''\) = ''true''/)
    assert.match(m, /<> 1 THEN\n    RAISE EXCEPTION 'KAN-433: s112_exportauftrag_aendern – Ankerstelle nicht genau einmal gefunden'/)
    assert.doesNotMatch(m, /CREATE TRIGGER|s112_freeze\(/, 'Positivliste bleibt – die Spalte ist ab „Versendet“ gesperrt')
  })
  test('Anlegen, Bearbeiten, Formular und Schema kennen die Spalte', () => {
    assert.match(quelle('src/app/api/weinexport/route.ts'), /mustersendung:\s+kopfNeu\.mustersendung,/)
    assert.match(quelle('src/app/(dashboard)/weinexport/[id]/bearbeiten/page.tsx'), /kunde_uid, mustersendung'\)/)
    const f = quelle('src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx')
    assert.match(f, /useState\(alt\?\.mustersendung === true\)/)
    assert.match(f, /<input type="checkbox" checked=\{mustersendung\} onChange=\{e => setMustersendung\(e\.target\.checked\)\}/)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    assert.ok(schema.exportauftraege.includes('mustersendung'))
  })
})
