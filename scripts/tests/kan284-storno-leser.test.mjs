// Sweep 92 (KAN-284, 10.10.2026): Storno-Leser für die übrigen Buchungstabellen mit storniert_am.
// KAN-145/148/150 sichern Umzüge, Verschnitte, Lese/Pressung/Traubenverkauf und die Antragstabellen. Dieselbe Regel gilt
// jetzt für Maßnahmen, Lager- und Stoffbewegungen, Kellerbehandlungen, Verarbeitungen, Zugangskorrekturen, Produktionen,
// Lohnversektungen, Etikettierungen, E&A-Buchungen, Zahlungen, Umbuchungen und Rechnungen: jede LESENDE Abfrage unter
// src/ filtert .is('storniert_am', null) – oder ist begründet mit `// storno-sichtbar: <Grund>` direkt darüber (bis 300
// Zeichen) oder in der Kette (Listen/Druck/Journal zeigen stornierte gekennzeichnet; E&A storniert über eine
// Gegenbuchung, Salden zählen beide Zeilen; Prüfungen werten storniert_am im Code aus; BMD überträgt Stornos).
// Befund: „letzte Maßnahme“ je Gebinde im Dashboard konnte eine stornierte Kellerbehandlung sein.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')
const MARKER = /storno-sichtbar:\s*\S.{10,}/
const TABELLEN = [
  'behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen', 'betriebsmittel_lager_bewegungen',
  'keller_behandlungen', 'keller_verarbeitungen', 'keller_zugangskorrekturen', 'produktionen', 'lohnversektungen', 'fuellung_etikettierungen',
  'ea_transaktionen', 'zahlungen', 'konto_umbuchungen', 'rechnungen',
]

function dateien(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) out.push(...dateien(p))
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

/** Kette ab .from(…)/.q(…) bis zum Ende der Anweisung (wie kan150, längeres Fenster für lange Spaltenlisten) */
function kette(s, i) {
  const rest = s.slice(i, i + 1600)
  const ende = rest.slice(1).search(/;\s*\n|\n\s*\n|\n\s*(?:const |let |var |if |for |return |throw |await |try |\}|\]\)|for\b)|\.from\(|\.q\(/)
  return ende >= 0 ? rest.slice(0, ende + 1) : rest
}

test('jede lesende Abfrage auf die Buchungstabellen filtert stornierte Zeilen oder ist begründet', () => {
  const funde = []
  let geprueft = 0
  const re = new RegExp(String.raw`\.(?:from|q)\('(${TABELLEN.join('|')})'\)`, 'g')
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    let m
    re.lastIndex = 0
    while ((m = re.exec(s))) {
      const k = kette(s, m.index)
      if (/\.(insert|update|delete|upsert)\(/.test(k)) continue   // schreibende Kette
      if (!/\.select\(/.test(k)) continue
      geprueft++
      const vorher = s.slice(Math.max(0, m.index - 300), m.index)
      // Rechnungen: Spalte storniert (bool) neben storniert_am – .eq('storniert', false) filtert ebenso
      if (/\.is\('storniert_am', null\)|\.eq\('storniert', false\)/.test(k) || MARKER.test(vorher) || MARKER.test(k)) continue
      funde.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length} (${m[1]})`)
    }
  }
  assert.ok(geprueft >= 60, `zu wenige Abfragen gefunden (${geprueft}) – Muster prüfen`)
  assert.deepEqual(funde, [], 'ohne .is(\'storniert_am\', null) bzw. // storno-sichtbar: <Grund>')
})

test('Dashboard: letzte Maßnahme je Gebinde ohne stornierte Kellerbehandlungen', () => {
  const d = readFileSync(path.join(SRC, 'app/(dashboard)/dashboard/_shared/data.ts'), 'utf8')
  assert.match(d, /ctx\.q\('keller_behandlungen'\)\.select\('behaelter_id, datum, typ_name_snapshot, menge, einheit'\)\.in\('behaelter_id', b\)\.is\('storniert_am', null\)/)
})
