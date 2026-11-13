// ── Lesebereich je Behördenmeldung (KAN-455, 13.11.2026) ───────────────────────────────────────────────────────────
//
// Mitarbeiter mit Profil („Vertrieb“, „Extern“) lesen nur ihre Lesebereiche (docs/Leserechte.md). Eine Meldung fasst
// Daten eines Bereichs zusammen – wer den Bereich nicht lesen darf, bekommt weder die CSV noch den Eintrag in den
// Übersichten (zugriffsFehler in zugriff.ts). Der Bereich kommt aus der Gruppe; Meldungen, die fachlich woanders
// liegen, tragen im Katalog ein eigenes Feld `bereich`.
// Entscheidung (Jira KAN-455, Frage 4, Vorschlag A): „Extern“ exportiert keine Meldung – auch nicht die
// Pflanzenschutz-Aufzeichnung, sie enthält Mittel und Mengen des Betriebs.
// Isomorph, ohne '@/'-Importe (node:test).

import type { Lesebereich } from '../auth/lesebereiche.ts'

export type MeldungsGruppeName = 'ernte' | 'pflanzenschutz' | 'verkehr' | 'kellerbuch' | 'buchhaltung' | 'flaechen'

export const GRUPPEN_BEREICH: Record<MeldungsGruppeName, Lesebereich> = {
  ernte: 'lese',
  pflanzenschutz: 'betriebsmittel',
  verkehr: 'verkauf',
  kellerbuch: 'keller',
  buchhaltung: 'ea',
  flaechen: 'rieden',
}

/** Lesebereich einer Meldung: eigenes Feld `bereich`, sonst der Bereich ihrer Gruppe */
export function meldungsBereich(e: { gruppe: string; bereich?: Lesebereich }): Lesebereich {
  return e.bereich ?? GRUPPEN_BEREICH[e.gruppe as MeldungsGruppeName] ?? 'verwaltung'
}
