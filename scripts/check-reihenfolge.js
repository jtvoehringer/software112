#!/usr/bin/env node
/**
 * check-reihenfolge.js – Wächter „Vorgänge am selben Tag in fester Reihenfolge“ (KAN-384, 28.10.2026)
 *
 * Buchungen haben meist nur ein Datum (Spalte vom Typ date). Sortiert eine Abfrage nur danach, liefert Postgres die
 * Zeilen eines Tages in beliebiger Reihenfolge – im UAT stand das Weinbuch mit vier Vorgängen am selben Tag
 * willkürlich, beim Neuladen auch anders. Regel: nach einer Datumsspalte folgt ein zweiter Schlüssel, in der Regel
 * der Erfassungszeitpunkt und die id: .order('datum').order('erstellt_am' | 'created_at').order('id').
 * Im Code sortierte Listen über nachTagUndZeit() aus src/lib/datum/reihenfolge.ts.
 *
 * Gemeldet: `.order('<Datumsspalte>' …)` unter src/, auf das kein weiteres `.order(` folgt. Datumsspalten =
 * DATUMSSPALTEN (alle Spalten vom Typ date im Schema public, Stand 28.10.2026 – neu erzeugen mit
 *   select string_agg(distinct column_name, ',' order by column_name) from information_schema.columns
 *    where table_schema = 'public' and data_type = 'date';
 * ). Zeitstempel-Spalten (erstellt_am, created_at …) sind eindeutig genug und nicht betroffen.
 * Begründete Ausnahme: // reihenfolge-ok: <Grund, mind. 15 Zeichen> in derselben Zeile oder bis zu vier Zeilen davor
 * (z. B. „höchstens eine Zeile je Tag (Monatsabschluss)“).
 * ALTFAELLE: Dateien, die beim Einführen noch nicht umgestellt waren (Abbau mit KAN-384 PR 2) – dort zählen Funde nur.
 *
 * Aufruf: node scripts/check-reihenfolge.js [--liste]   (Exit 1 bei Funden; --liste zeigt auch die Altfälle)
 * Für Tests: require('./check-reihenfolge.js') → { pruefeText, pruefeWurzel, DATUMSSPALTEN, ALTFAELLE } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')
const { ohneKommentare } = require('./check-loeschen.js')

const AUSNAHME = /reihenfolge-ok\s*:\s*(.*)$/i
const MIN_GRUND = 15

const DATUMSSPALTEN = new Set(('abgabefrist,abgang_am,abgeschlossen_am,abgeschlossen_bis,ama_meldedatum,analyse_datum,'
  + 'anschaffung_am,ausgestellt_am,beginn,bescheid_am,bewirtschaftung_seit,bis_datum,datum,datum_bis,deaktiviert_am,'
  + 'degorgiert_am,ea_betriebsbeginn,einarbeitung_zeitpunkt,eingereicht_am,einheitswert_bescheid,emcs_datum,ende,'
  + 'entzug_am,ernte_datum,ernte_fruehesteins,eroeffnungsdatum,erwartetes_datum,faellig_am,geburtsdatum,gueltig_ab,'
  + 'gueltig_bis,journal_ab,ki_abfragen_reset_datum,leistung_bis,leistung_von,lieferdatum,naechste_faelligkeit,'
  + 'premium_support_bis,premium_support_seit,stichtag,svs_option_seit,tirage_datum,veroeffentlicht_am,zeitraum_bis,'
  + 'zeitraum_von,zulassungsgueltig').split(','))

/** Noch nicht umgestellte Dateien (KAN-384 PR 2 baut die Liste ab) */
const ALTFAELLE = new Set([
  'src/app/(dashboard)/buchhaltung/anlagen/daten.ts',
  'src/app/(dashboard)/buchhaltung/dauerauftraege/page.tsx',
  'src/app/(dashboard)/crm/firmen/[id]/page.tsx',
  'src/app/(dashboard)/crm/gemeinsam/page.tsx',
  'src/app/(dashboard)/crm/kontakte/[id]/page.tsx',
  'src/app/(dashboard)/dashboard/_shared/data.ts',
  'src/app/(dashboard)/dashboard/verkauf/page.tsx',
  'src/app/(dashboard)/hilfe/neuerungen/page.tsx',
  'src/app/(dashboard)/reports/(controlling)/page.tsx',
  'src/app/(dashboard)/weinhandel/page.tsx',
  'src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx',
  'src/app/api/kostenrechnung/route.ts',
  'src/app/api/release-notes/route.ts',
  'src/app/api/verkauf-stammdaten/route.ts',
  'src/lib/morgenbericht/erstellen.ts',
  'src/lib/morgenbericht/lauf.ts',
  'src/lib/wetter/auswertung.ts',
])

function pruefeText(text) {
  const code = ohneKommentare(text)
  const zeilen = text.split('\n')
  const funde = []
  let ausnahmen = 0, geprueft = 0, m
  // ohneKommentare leert Zeichenketten (gleiche Länge) – den Spaltennamen daher aus dem Originaltext an derselben Stelle
  const re = /\.order\(\s*(['"`])/g
  while ((m = re.exec(code))) {
    const spalte = /^[a-z_]+(?=['"`])/.exec(text.slice(m.index + m[0].length))
    if (!spalte || !DATUMSSPALTEN.has(spalte[0])) continue
    m[2] = spalte[0]
    geprueft++
    // Ende des Aufrufs suchen (Klammern zählen), danach muss ein weiteres .order( folgen
    let tiefe = 0, i = m.index + '.order'.length
    for (; i < code.length; i++) {
      if (code[i] === '(') tiefe++
      else if (code[i] === ')') { tiefe--; if (tiefe === 0) break }
    }
    if (/^\s*\.order\(/.test(code.slice(i + 1, i + 200))) continue
    const zeile = code.slice(0, m.index).split('\n').length
    const marker = zeilen.slice(Math.max(0, zeile - 5), zeile).reverse().map(r => AUSNAHME.exec(r.replace(/\r$/, ''))).find(Boolean)
    if (marker && marker[1].trim().length >= MIN_GRUND) { ausnahmen++; continue }
    funde.push({ zeile, text: marker
      ? `„reihenfolge-ok“ ohne ausreichende Begründung (mind. ${MIN_GRUND} Zeichen)`
      : `.order('${m[2]}') ohne zweiten Schlüssel – Vorgänge desselben Tages stehen beliebig; .order('erstellt_am' bzw. 'created_at').order('id') anhängen` })
  }
  return { funde, ausnahmen, geprueft }
}

function* dateien(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* dateien(p) }
    else if (/\.tsx?$/.test(e.name)) yield p
  }
}

function pruefeWurzel(root, altfaelle = ALTFAELLE) {
  const funde = [], alt = []
  let dateienAnzahl = 0, ausnahmen = 0, geprueft = 0
  for (const f of dateien(path.join(root, 'src'))) {
    const r = path.relative(root, f).split(path.sep).join('/')
    const e = pruefeText(fs.readFileSync(f, 'utf8'))
    dateienAnzahl++; ausnahmen += e.ausnahmen; geprueft += e.geprueft
    for (const x of e.funde) (altfaelle.has(r) ? alt : funde).push(`${r}:${x.zeile}  ${x.text}`)
  }
  const ungenutzt = [...altfaelle].filter(a => !alt.some(x => x.startsWith(`${a}:`)))
  return { funde, alt, ungenutzt, dateien: dateienAnzahl, ausnahmen, geprueft }
}

module.exports = { pruefeText, pruefeWurzel, DATUMSSPALTEN, ALTFAELLE }

if (require.main === module) {
  const ROOT = process.env.S112_GUARD_ROOT ? path.resolve(process.env.S112_GUARD_ROOT) : path.resolve(__dirname, '..')
  const e = pruefeWurzel(ROOT)
  if (process.argv.includes('--liste')) for (const x of e.alt) console.log('  (Altfall) ' + x)
  if (e.funde.length || e.ungenutzt.length) {
    if (e.funde.length) {
      console.error(`\n✖ check-reihenfolge: ${e.funde.length} Fund(e) – Sortierung nur nach einem Datum:\n`)
      for (const x of e.funde) console.error('  ' + x)
      console.error('\nZweiten Schlüssel anhängen (.order(\'erstellt_am\').order(\'id\')) – oder begründen:')
      console.error('  // reihenfolge-ok: <Grund ≥ 15 Zeichen>   (dieselbe Zeile oder bis zu vier Zeilen davor)\n')
    }
    if (e.ungenutzt.length) console.error(`✖ check-reihenfolge: ALTFAELLE ohne Fund – aus der Liste nehmen: ${e.ungenutzt.join(', ')}\n`)
    process.exit(1)
  }
  console.log(`✓ check-reihenfolge: ${e.dateien} Dateien, ${e.geprueft} Sortierungen nach einem Datum, außer den Altfällen alle mit zweitem Schlüssel; ${e.ausnahmen} begründete Ausnahme(n), ${e.alt.length} Altfall-Stelle(n) in ${ALTFAELLE.size} Datei(en).`)
}
