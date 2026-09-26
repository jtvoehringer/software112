// ── Feld-Matrix je Maßnahmenart (bis KAN-143 in NeueBehandlungForm.tsx) ──────────────
//
// Steuert, welche Felder pro Art sichtbar/pflicht sind (siehe "Analyse Maßnahmen.docx", Tabelle 2).
// 'pflicht' | 'bedingt' | 'optional' | 'hidden'. Die Mengenfelder (Spritzbrühe bzw. Düngermenge, Aufwand,
// Konzentration, Wasseraufwand) kommen aus MENGEN_SICHT (mengenFelder.ts) – gemeinsam mit dem
// Bearbeiten-Formular (KAN-133). Der Assistent beschreibt dieselbe Matrix in MASSNAHME_FELD_MATRIX_TEXT
// (lib/assistent/tools/massnahme.ts).
// Laubschneiden (KAN-143): wie Laubarbeit, aber ohne „Art der Laubarbeit“ – BBCH optional, Witterung und
// Temperatur ausgeblendet, keine Mengenfelder.
// Die BBCH-Auswahl (BBCH_OPTIONS, bbchAltwert) liegt ebenfalls hier – gemeinsam für Anlegen und Bearbeiten.
// Ohne JSX, damit node:test sie prüfen kann (scripts/tests/massnahmen-arten.test.mjs).

import { istMassnahmenArt, type MassnahmenArt } from '@/lib/behandlungen/arten'
import type { Sicht } from './mengenFelder'

export type Felder = {
  psm: Sicht; duengemittel: Sicht; bbch: Sicht; schaderreger: Sicht; witterung: Sicht; temperatur: Sicht
  einarbeitung: Sicht; bearbeitung: Sicht; schnittart: Sicht; laubarbeitArt: Sicht
}

export const FELD_MATRIX: Readonly<Record<MassnahmenArt, Felder>> = {
  spritzung:        { psm: 'pflicht', duengemittel: 'hidden',   bbch: 'pflicht',  schaderreger: 'pflicht',  witterung: 'optional', temperatur: 'optional', einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  duengung:         { psm: 'hidden',  duengemittel: 'optional', bbch: 'hidden',   schaderreger: 'hidden',   witterung: 'optional', temperatur: 'hidden',   einarbeitung: 'bedingt', bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  bodenbearbeitung: { psm: 'hidden',  duengemittel: 'hidden',   bbch: 'hidden',   schaderreger: 'hidden',   witterung: 'optional', temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'pflicht', schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  schnitt:          { psm: 'hidden',  duengemittel: 'hidden',   bbch: 'hidden',   schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'pflicht', laubarbeitArt: 'hidden'  },
  laubarbeit:       { psm: 'hidden',  duengemittel: 'hidden',   bbch: 'optional', schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'pflicht' },
  laubschneiden:    { psm: 'hidden',  duengemittel: 'hidden',   bbch: 'optional', schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  sonstiges:        { psm: 'hidden',  duengemittel: 'hidden',   bbch: 'hidden',   schaderreger: 'optional', witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
}

/** BBCH-Auswahl der Maßnahmenformulare (Anlegen und Bearbeiten) – eine Liste für beide */
export const BBCH_OPTIONS = [
  { value: '09', label: '09 – Knospenaufbruch' },
  { value: '11', label: '11 – 1. Blatt entfaltet' },
  { value: '53', label: '53 – Traubenanlage sichtbar' },
  { value: '55', label: '55 – Einzelblüten sichtbar' },
  { value: '57', label: '57 – Blütenstand gestreckt' },
  { value: '61', label: '61 – Beginn Blüte (10%)' },
  { value: '65', label: '65 – Vollblüte (50%)' },
  { value: '69', label: '69 – Ende Blüte' },
  { value: '71', label: '71 – Fruchtansatz' },
  { value: '73', label: '73 – Erbsengröße' },
  { value: '75', label: '75 – Haselnussgröße' },
  { value: '77', label: '77 – Trauben schließen sich' },
  { value: '81', label: '81 – Beginn Reife' },
  { value: '85', label: '85 – Weichwerden' },
  { value: '89', label: '89 – Vollreife' },
] as const

/**
 * Gespeichertes BBCH-Stadium außerhalb von BBCH_OPTIONS (z. B. „68“ oder „83“ im Demo-Betrieb, oder ein
 * freier Code aus dem Assistenten) – das Bearbeiten-Formular bietet es in beiden BBCH-Auswahlen als eigene
 * Option „<Code> (bisherige Angabe)“ an; ohne passende Option wäre „– Auswählen –“ gewählt und Speichern
 * leerte das Stadium. Bekannte Codes und leer → null.
 */
export function bbchAltwert(gespeichert: string | null | undefined): string | null {
  if (!gespeichert?.trim()) return null
  return BBCH_OPTIONS.some(o => o.value === gespeichert) ? null : gespeichert
}

/**
 * Bearbeiten-Formular (BehandlungEditForm): BBCH folgt der Feld-Matrix wie beim Anlegen (und wie FAQ und
 * Handbuch es beschreiben) – eine Auswahl gibt es nur, wo BBCH nicht 'hidden' ist:
 *   'auswahl'  – Spritzung (Pflicht), Laubarbeit und Laubschneiden (optional): BBCH-Auswahl, ein Code
 *                außerhalb von BBCH_OPTIONS als eigene Option (bbchAltwert)
 *   'behalten' – Art mit BBCH 'hidden' (Düngung, Bodenbearbeitung, Schnitt, Sonstiges), aber unverändert
 *                (art = startArt): keine Auswahl, das gespeicherte Stadium geht unsichtbar mit
 *                (<input type="hidden">) – sonst leerte Speichern es (Musterhof: 14 solche Maßnahmen mit BBCH).
 *                Auch nach einem Umweg über eine Art mit Auswahl das gespeicherte, nicht die dortige Auswahl:
 *                bei dieser Art wäre eine Änderung weder sichtbar noch korrigierbar
 *   'keine'    – nach einem Wechsel auf eine Art mit BBCH 'hidden': nichts senden, Speichern leert das
 *                Stadium (wie beim Anlegen)
 * Unbekannte Arten (z. B. 'lese') gelten als 'hidden'.
 */
export type BbchBeimBearbeiten = 'auswahl' | 'behalten' | 'keine'

export function bbchBeimBearbeiten(art: string, startArt: string): BbchBeimBearbeiten {
  if (istMassnahmenArt(art) && FELD_MATRIX[art].bbch !== 'hidden') return 'auswahl'
  return art === startArt ? 'behalten' : 'keine'
}

/**
 * Bearbeiten-Formular: Witterung und Temperatur zeigt es bei den bisherigen Arten wie bisher immer.
 * Laubschneiden (KAN-143) folgt der Feld-Matrix (ausgeblendet) – außer es ist schon ein Wert gespeichert
 * (z. B. über den Assistenten), der beim Speichern sonst verloren ginge.
 */
export function wetterBeimBearbeiten(
  art: string,
  gespeichert: { witterung: string | null; temperatur_c: number | null } | null,
): boolean {
  if (art !== 'laubschneiden') return true
  return FELD_MATRIX.laubschneiden.witterung !== 'hidden'
    || gespeichert?.witterung != null || gespeichert?.temperatur_c != null
}
