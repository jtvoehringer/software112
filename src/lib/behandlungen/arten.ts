// ── Maßnahmen-Arten (behandlungen.art, saetze_massnahmen.art) – eine Liste für alle (KAN-143, 26.09.2026) ──
//
// Formulare (Anlegen, Bearbeiten), Stundensätze, Liste, Ried-Detail, Assistent, Auswertungen,
// Behördenmeldungen und Rückverfolgung lesen Werte und Bezeichnungen von hier. Die Werte entsprechen
// den DB-CHECKs (Migration 20260926175835_kan143_laubschneiden):
//   behandlungen_art_check       = BEHANDLUNG_ARTEN (mit 'lese')
//   saetze_massnahmen_art_check  = MASSNAHMEN_ARTEN (ohne 'lese')
// Eine neue Art braucht zuerst eine Migration beider CHECKs, danach hier den Wert, die Bezeichnung,
// die Feld-Matrix (behandlungen/neu/feldMatrix.ts), die Mengenfelder (neu/mengenFelder.ts), das
// Symbol (neu/artOptionen.ts) und die Texte für Assistent und KI (scripts/tests/massnahmen-arten.test.mjs
// prüft das).
//
// Laubschneiden (KAN-143) = maschinelles Laubschneiden an Seiten und Gipfel. „Gipfeln“ von Hand bleibt
// Unterart von Laubarbeit (laubarbeit_art); bestehende Einträge werden nicht umgedeutet (Entscheidung
// Jörgen, 26.09.2026).
//
// Isomorph und ohne Abhängigkeiten (Client-Komponenten, Server, node:test).

/** Arten, die Maßnahmenformular, Assistent und Stundensätze anbieten – in der Reihenfolge der Auswahl */
export const MASSNAHMEN_ARTEN = [
  'spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'laubschneiden', 'sonstiges',
] as const
export type MassnahmenArt = (typeof MASSNAHMEN_ARTEN)[number]

/** Alle Werte von behandlungen.art: zusätzlich 'lese' (nicht über das Maßnahmenformular angelegt) */
export const BEHANDLUNG_ARTEN = [
  'spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'laubschneiden', 'lese', 'sonstiges',
] as const
export type BehandlungArt = (typeof BEHANDLUNG_ARTEN)[number]

/** Bezeichnung je Art – Reihenfolge = BEHANDLUNG_ARTEN (Art-Filter in Behandlungsprotokoll und Berichten) */
export const MASSNAHMEN_ART_LABEL: Readonly<Record<BehandlungArt, string>> = {
  spritzung:        'Spritzung',
  duengung:         'Düngung',
  bodenbearbeitung: 'Bodenbearbeitung',
  schnitt:          'Schnitt',
  laubarbeit:       'Laubarbeit',
  laubschneiden:    'Laubschneiden',
  lese:             'Lese',
  sonstiges:        'Sonstiges',
}

/** Hinweis unter der Art-Auswahl der Maßnahmenformulare, wenn Laubschneiden gewählt ist */
export const LAUBSCHNEIDEN_HINWEIS =
  'Maschinelles Laubschneiden an Seiten und Gipfel. Gipfeln von Hand bitte als Laubarbeit mit der Art „Gipfeln“ erfassen.'

/** Unterarten der Laubarbeit (behandlungen.laubarbeit_art) – nur bei art 'laubarbeit' gespeichert */
export const LAUBARBEIT_OPTIONEN = [
  { value: 'entblaettern', label: 'Entblättern' },
  { value: 'ausgeizen',    label: 'Ausgeizen' },
  { value: 'gipfeln',      label: 'Gipfeln' },
  { value: 'heften',       label: 'Heften' },
  { value: 'sonstige',     label: 'Sonstige' },
] as const

export function istMassnahmenArt(x: unknown): x is MassnahmenArt {
  return typeof x === 'string' && (MASSNAHMEN_ARTEN as readonly string[]).includes(x)
}

/** Bezeichnung einer Art; unbekannte Werte bleiben stehen, leer → null */
export function massnahmenArtLabel(art: string | null | undefined): string | null {
  if (!art) return null
  return Object.prototype.hasOwnProperty.call(MASSNAHMEN_ART_LABEL, art)
    ? MASSNAHMEN_ART_LABEL[art as BehandlungArt]
    : art
}

/**
 * laubarbeit_art wird nur bei einer Laubarbeit gespeichert – bei Laubschneiden und allen anderen Arten
 * null (Formular blendet das Feld aus; Assistent oder ein veralteter Tab könnten es trotzdem mitschicken)
 */
export function laubarbeitArtFuer(art: string | null | undefined, laubarbeitArt: string | null): string | null {
  return art === 'laubarbeit' ? laubarbeitArt : null
}
