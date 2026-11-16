// ── Behördenmeldungen nach Stelle (KAN-471, BKI-Sitzung 16.11.2026) ────────────────────────────────────────────────
//
// Die Übersicht „Behördenmeldungen“ (Auswertungen › Behörden, Dashboard › Fristen) war nach Themen gegliedert
// (Ernte & Lese, Kellerbuch …); gesucht wird aber nach der Stelle, die das Dokument verlangt: „Was will die BKI,
// was die Bio-Kontrollstelle?“. Jede Meldung steht unter genau EINER Stelle – der Hauptempfängerin; weitere
// Empfänger nennt weiterhin der Text `behoerde` des Katalog-Eintrags in der Zeile.
//
// Isomorph (ohne Laufzeit-Importe): nutzbar in Server- und Client-Komponenten und in node:test.
// Neue Meldung im Katalog → hier eintragen; der Typ Record<MeldungsId, …> lässt die Übersetzung sonst scheitern.

import type { MeldungsId } from './katalog'

export type Stelle = 'bki' | 'bundesamt' | 'ama' | 'bio' | 'pflanzenschutz' | 'finanzamt' | 'zoll' | 'svs'

/** Reihenfolge der Überschriften = Reihenfolge dieser Liste */
export const STELLEN: readonly { id: Stelle; label: string }[] = [
  { id: 'bki', label: 'Bundeskellereiinspektion (BKI)' },
  { id: 'bundesamt', label: 'Bundesamt für Weinbau' },
  { id: 'ama', label: 'AMA' },
  { id: 'bio', label: 'Bio-Kontrollstelle' },
  { id: 'pflanzenschutz', label: 'Pflanzenschutz (Landwirtschaftskammer / Landesbehörde)' },
  { id: 'finanzamt', label: 'Finanzamt' },
  { id: 'zoll', label: 'Zoll' },
  { id: 'svs', label: 'SVS' },
]

export const STELLE_JE_MELDUNG: Record<MeldungsId, Stelle> = {
  // Ernte & Lese
  erntemeldung: 'bki',
  lesedaten: 'bki',
  bestandsmeldung: 'bki',
  bsm: 'bki',
  'bsm-kontrolljournal': 'bki',
  'bki-traubenverkauf': 'bki',
  // Pflanzenschutz & Düngung
  'psm-aufzeichnung': 'pflanzenschutz',
  'psm-uebermittlung': 'pflanzenschutz',
  'psm-mittelverbrauch': 'pflanzenschutz',
  'cu-bilanz': 'bio',
  'cu-bilanz-behandlungen': 'bio',
  naehrstoffbilanz: 'ama',
  'naehrstoffbilanz-weingarten': 'ama',
  'rueckverfolgung-weingarten': 'bio',
  // Weinverkehr & Export
  transportbescheinigung: 'bki',
  transportbescheinigungen: 'bki',
  pruefnummernantrag: 'bundesamt',
  'dac-antraege': 'bundesamt',
  exportauftrag: 'zoll',
  'emcs-datenblatt': 'zoll',
  exportauftraege: 'zoll',
  'zusammenfassende-meldung': 'finanzamt',
  // Kellerbuch
  bewegungsbuch: 'bki',
  'keller-behandlungen': 'bki',
  'keller-behandlungen-alle': 'bki',
  gebindeverzeichnis: 'bki',
  weinbuch: 'bki',
  'weinbuch-sammlung': 'bki',
  'blend-protokoll': 'bki',
  'besondere-konten': 'bki',
  'keller-auswertungen': 'bki',
  rueckverfolgung: 'bki',
  'rueckverfolgung-vorwaerts': 'bki',
  'bki-besondere-konten': 'bki',
  'bki-rv-eingang': 'bki',
  'bki-rv-ausgang': 'bki',
  'bki-verkauf': 'bki',
  'bki-einkauf': 'bki',
  'bki-tbs': 'bki',
  'bki-lagerstand': 'bki',
  'bki-lagerbewegungen': 'bki',
  'bki-betriebsdaten': 'bki',
  'bki-gebindeverzeichnis': 'bki',
  'bki-weingaerten': 'bki',
  'bki-qualitaetsstufen': 'bki',
  'bki-erzeugnisse': 'bki',
  'bki-buchungsarten': 'bki',
  aenderungsprotokoll: 'bki',
  // Buchhaltung & Steuer
  uva: 'finanzamt',
  'ea-journal': 'finanzamt',
  kassabuch: 'finanzamt',
  rechnungsausgangsjournal: 'finanzamt',
  belegverzeichnis: 'finanzamt',
  anlagenverzeichnis: 'finanzamt',
  'svs-einheitswerte': 'svs',
  // Flächen & Kataster
  flaechenverzeichnis: 'ama',
}

export function stelleVon(id: string): Stelle | null {
  return (STELLE_JE_MELDUNG as Record<string, Stelle | undefined>)[id] ?? null
}

/**
 * Einträge nach Stelle gliedern: Reihenfolge der Stellen wie STELLEN, darin Pflichtmeldungen zuerst, sonst die
 * Reihenfolge des Katalogs (stabil). Leere Stellen entfallen. Ein Eintrag ohne Zuordnung (dürfte es wegen des
 * Typs nicht geben) landet unter „Weitere“, damit er nie aus der Übersicht verschwindet.
 */
export function nachStelle<E extends { id: string; pflicht: boolean }>(eintraege: readonly E[]): { gruppe: string; label: string; eintraege: E[] }[] {
  const gruppen = [...STELLEN.map(s => ({ gruppe: s.id as string, label: s.label })), { gruppe: 'weitere', label: 'Weitere' }]
  return gruppen
    .map(g => {
      const liste = eintraege.filter(e => (stelleVon(e.id) ?? 'weitere') === g.gruppe)
      return { ...g, eintraege: [...liste.filter(e => e.pflicht), ...liste.filter(e => !e.pflicht)] }
    })
    .filter(g => g.eintraege.length > 0)
}
