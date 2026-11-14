// ── Lesebereich je Seite (KAN-456, 13.11.2026) ─────────────────────────────────────────────────────────────────────
//
// Mitarbeiter mit Profil („Vertrieb“, „Extern“) lesen nur ihre Lesebereiche (docs/Leserechte.md). Diese Liste ordnet
// jeder Seite unter src/app/(dashboard) ihren Bereich zu – eine Stelle für
//   • die Navigation und die Befehlspalette (buildNav blendet Einträge gesperrter Bereiche aus),
//   • die Seiten-Guards (requireLesen in layout.tsx bzw. page.tsx, src/lib/auth/lesen.ts),
//   • den Wächter scripts/check-lesebereich-seiten.js (jede Seite hat eine Regel und einen passenden Guard).
// Der längste passende Pfad gewinnt; Pfade wie in der Adresszeile (ohne Routen-Gruppen in Klammern).
// „allgemein“ = jedes Mitglied (kein Guard). Neue Seite in einem neuen Verzeichnis → hier eintragen.
// Isomorph, ohne '@/'-Importe (node:test).

import type { Lesebereich } from '../auth/lesebereiche.ts'

export const SEITEN_BEREICH: ReadonlyArray<readonly [string, Lesebereich]> = [
  // Allgemeines: Start, Hilfe, Profil, Verwaltung des Betriebs (eigene Rollen-Guards)
  ['/', 'allgemein'],
  ['/dashboard', 'allgemein'],
  ['/hilfe', 'allgemein'],
  ['/profil', 'allgemein'],
  ['/admin', 'allgemein'],
  ['/benutzer', 'allgemein'],
  ['/betrieb', 'allgemein'],
  // Sichten des Dashboards
  ['/dashboard/kellerbuch', 'keller'],
  ['/dashboard/verkauf', 'verkauf'],
  ['/dashboard/weingarten', 'rieden'],
  ['/dashboard/fristen', 'betrieb'],
  ['/dashboard/morgenbericht', 'verwaltung'],          // fasst Befunde aller Bereiche zusammen (Keller, Rieden, Verkauf) – keines der Profile
  ['/dashboard/journal', 'verwaltung'],
  // Rieden und Maßnahmen
  ['/weingarten', 'rieden'],
  ['/weingarten/rueckverfolgung', 'betriebsmittel'],   // Maßnahmen samt Mitteln je Lese-Grundstück
  ['/lagen', 'rieden'],
  ['/behandlungen', 'massnahmen'],
  ['/behandlungen/lager', 'betriebsmittel'],
  ['/behandlungen/berichte', 'betriebsmittel'],        // Pflanzenschutz-Aufzeichnung: Mittel und Mengen des Betriebs
  ['/pflanzenschutz', 'betriebsmittel'],
  ['/erntemeldung', 'lese'],
  // Keller
  ['/kellerbuch', 'keller'],
  ['/dac', 'keller'],
  // Warenwirtschaft
  ['/weinhandel', 'lager'],                            // Warenlager (Füllungen)
  ['/weinhandel/fuellungen', 'lager'],
  ['/weinhandel/fuellungen/neu', 'keller'],            // KAN-456: Abfüllen aus einer Kellerbuch-Charge
  ['/weinhandel/sonstige-artikel', 'lager'],
  ['/weinhandel/zukauf', 'lager'],
  ['/weinhandel/transportbescheinigungen', 'lager'],
  ['/weinhandel/uebersicht', 'verkauf'],
  ['/weinhandel/verkauf', 'verkauf'],
  ['/weinhandel/angebote', 'verkauf'],
  ['/weinhandel/auftraege', 'verkauf'],
  ['/weinhandel/rechnungen', 'verkauf'],
  ['/weinhandel/sammelrechnung', 'verkauf'],
  ['/weinhandel/offene-posten', 'verkauf'],
  ['/weinhandel/rabattgruppen', 'verkauf'],
  ['/weinhandel/export', 'verkauf'],
  ['/weinhandel/traubenverkauf', 'lese'],
  ['/weinexport', 'verkauf'],
  // CRM
  ['/crm', 'crm'],
  ['/nachrichten', 'crm'],
  // E&A-Rechnung
  ['/buchhaltung', 'ea'],
  ['/konten', 'ea'],
  ['/controlling/bmd', 'ea'],
  // Controlling, Auswertungen, KI
  ['/controlling', 'controlling'],
  ['/controlling/fristen', 'betrieb'],
  ['/auswertungen', 'controlling'],
  ['/ki', 'ki'],
  ['/reports', 'controlling'],
  ['/reports/keller', 'keller'],
  ['/reports/weinbuecher-sammlung', 'keller'],
  ['/reports/bestandsmeldung-bsm', 'keller'],
  ['/reports/ama', 'lese'],
  ['/reports/behandlungsprotokoll', 'betriebsmittel'],
  ['/reports/cu-bilanz', 'betriebsmittel'],
  ['/reports/naehrstoffbilanz', 'betriebsmittel'],
]

/** Regel einer Seite: [Pfad der Regel, Bereich] – längster passender Pfad; null = keine Regel */
export function seitenRegel(pfad: string): readonly [string, Lesebereich] | null {
  const p = (pfad.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  let treffer: readonly [string, Lesebereich] | null = null
  for (const regel of SEITEN_BEREICH) {
    if (p !== regel[0] && !p.startsWith(regel[0] + '/')) continue
    if (!treffer || regel[0].length > treffer[0].length) treffer = regel
  }
  return treffer
}

/** Lesebereich einer Seite; ohne Regel „verwaltung“ (für jedes Profil gesperrt – der Wächter verhindert den Fall) */
export function seitenBereich(pfad: string): Lesebereich {
  return seitenRegel(pfad)?.[1] ?? 'verwaltung'
}
