// ── Feld-Matrix je Maßnahmenart (bis KAN-143 in NeueBehandlungForm.tsx) ──────────────
//
// Steuert, welche Felder pro Art sichtbar/pflicht sind (siehe "Analyse Maßnahmen.docx", Tabelle 2).
// 'pflicht' | 'bedingt' | 'optional' | 'hidden'. Die Mengenfelder (Spritzbrühe bzw. Düngermenge, Aufwand,
// Konzentration, Wasseraufwand) kommen aus MENGEN_SICHT (mengenFelder.ts) – gemeinsam mit dem
// Bearbeiten-Formular (KAN-133). Der Assistent beschreibt dieselbe Matrix in MASSNAHME_FELD_MATRIX_TEXT
// (lib/assistent/tools/massnahme.ts).
// Laubschneiden (KAN-143): wie Laubarbeit, aber ohne „Art der Laubarbeit“ – BBCH optional, Witterung und
// Temperatur ausgeblendet, keine Mengenfelder.
// KAN-154 (Entscheidungen Jörgen, 27.09.2026): Sonstiges bietet das Pflanzenschutzmittel optional an (z. B.
// Pheromon-Dispenser) – Bio-Sperre, Wartezeit, Lager und Behandlungsprotokoll wie bei der Spritzung; die
// Bearbeitungstiefe ist generell optional (Mulchen, Mähen), das Gerät bleibt bei Bodenbearbeitung Pflicht.
// Die BBCH-Auswahl (BBCH_OPTIONS, bbchAltwert), Schaderreger bzw. Grund / Anlass (schaderregerFeld) und die
// Witterung liegen ebenfalls hier – gemeinsam für Anlegen und Bearbeiten; welche dieser Felder das Bearbeiten
// zeigt oder unsichtbar mitsendet, entscheidet felderBeimBearbeiten (KAN-152).
// Einarbeitung und Pflichtfelder beim Bearbeiten: einarbeitungBeimBearbeiten, pflichtBeimBearbeiten (KAN-154).
// KAN-155 (Pilotbetrieb, 28.09.2026): BBCH-Stadium und Schaderreger sind bei der Spritzung optional – beim Anlegen,
// Bearbeiten, im Assistenten und in der Server Action (die ohnehin nichts davon verlangt).
// Ohne JSX, damit node:test sie prüfen kann (scripts/tests/massnahmen-arten.test.mjs).

import { istMassnahmenArt, type MassnahmenArt } from '@/lib/behandlungen/arten'
import type { Sicht } from './mengenFelder'

export type Felder = {
  psm: Sicht; duengemittel: Sicht; bbch: Sicht; schaderreger: Sicht; witterung: Sicht; temperatur: Sicht
  einarbeitung: Sicht; bearbeitungstiefe: Sicht; bearbeitungsgeraet: Sicht; schnittart: Sicht; laubarbeitArt: Sicht
}

export const FELD_MATRIX: Readonly<Record<MassnahmenArt, Felder>> = {
  spritzung:        { psm: 'pflicht',  duengemittel: 'hidden',   bbch: 'optional', schaderreger: 'optional', witterung: 'optional', temperatur: 'optional', einarbeitung: 'hidden',  bearbeitungstiefe: 'hidden',   bearbeitungsgeraet: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  duengung:         { psm: 'hidden',   duengemittel: 'optional', bbch: 'hidden',   schaderreger: 'hidden',   witterung: 'optional', temperatur: 'hidden',   einarbeitung: 'bedingt', bearbeitungstiefe: 'hidden',   bearbeitungsgeraet: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  bodenbearbeitung: { psm: 'hidden',   duengemittel: 'hidden',   bbch: 'hidden',   schaderreger: 'hidden',   witterung: 'optional', temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitungstiefe: 'optional', bearbeitungsgeraet: 'pflicht', schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  schnitt:          { psm: 'hidden',   duengemittel: 'hidden',   bbch: 'hidden',   schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitungstiefe: 'hidden',   bearbeitungsgeraet: 'hidden',  schnittart: 'pflicht', laubarbeitArt: 'hidden'  },
  laubarbeit:       { psm: 'hidden',   duengemittel: 'hidden',   bbch: 'optional', schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitungstiefe: 'hidden',   bearbeitungsgeraet: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'pflicht' },
  laubschneiden:    { psm: 'hidden',   duengemittel: 'hidden',   bbch: 'optional', schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitungstiefe: 'hidden',   bearbeitungsgeraet: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  sonstiges:        { psm: 'optional', duengemittel: 'hidden',   bbch: 'hidden',   schaderreger: 'optional', witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitungstiefe: 'hidden',   bearbeitungsgeraet: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
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
 * freier Code aus dem Assistenten) – das Bearbeiten-Formular bietet es in der BBCH-Auswahl als eigene
 * Option „<Code> (bisherige Angabe)“ an; ohne passende Option wäre „– Auswählen –“ gewählt und Speichern
 * leerte das Stadium. Bekannte Codes und leer → null.
 */
export function bbchAltwert(gespeichert: string | null | undefined): string | null {
  if (!gespeichert?.trim()) return null
  return BBCH_OPTIONS.some(o => o.value === gespeichert) ? null : gespeichert
}

/** Vorschläge im Feld „Schaderreger“ (datalist, nur bei Spritzung) – gemeinsam für Anlegen und Bearbeiten */
export const SCHADERREGER_OPTIONEN = ['Oidium', 'Peronospora', 'Botrytis'] as const

/** Witterung der Maßnahmenformulare – Werte wie behandlungen_witterung_check, Bezeichnung mit Umlaut */
export const WITTERUNG_OPTIONEN = [
  { value: 'sonnig', label: 'Sonnig' },
  { value: 'bewoelkt', label: 'Bewölkt' },
  { value: 'regnerisch', label: 'Regnerisch' },
  { value: 'wind', label: 'Wind' },
] as const

/**
 * Feld `schaderreger` je Art (KAN-152): bei Sonstiges „Grund / Anlass“ (optional, Beispiel „Rodung“, ohne
 * Schaderreger-Vorschläge), sonst „Schaderreger“ – eine Stelle für Anlegen und Bearbeiten.
 */
export function schaderregerFeld(art: string): { label: string; placeholder: string; vorschlaege: boolean } {
  return art === 'sonstiges'
    ? { label: 'Grund / Anlass', placeholder: 'z.B. Rodung', vorschlaege: false }
    : { label: 'Schaderreger', placeholder: 'z.B. Peronospora', vorschlaege: true }
}

/**
 * Bearbeiten-Formular (BehandlungEditForm): BBCH (KAN-143), Schaderreger bzw. Grund / Anlass, Witterung und
 * Temperatur (KAN-152) folgen der Feld-Matrix wie beim Anlegen (und wie FAQ und Handbuch es beschreiben) –
 * ein Eingabefeld gibt es nur, wo das Feld nicht 'hidden' ist:
 *   'sichtbar' – Feld laut Matrix sichtbar, z. B. BBCH bei Spritzung, Laubarbeit und Laubschneiden
 *                (optional, KAN-155; ein Code außerhalb von BBCH_OPTIONS als eigene Option, bbchAltwert), Schaderreger
 *                bei Spritzung (optional, KAN-155) bzw. Grund / Anlass bei Sonstiges (optional; bis KAN-152 zeigte das
 *                Bearbeiten ihn nicht, Speichern leerte ihn), Witterung bei Spritzung, Düngung und
 *                Bodenbearbeitung, Temperatur bei Spritzung
 *   'behalten' – Feld 'hidden', aber Art unverändert (art = startArt): kein Eingabefeld, der gespeicherte Wert
 *                geht unsichtbar mit (<input type="hidden">) – sonst leerte Speichern ihn (Musterhof, SELECT
 *                26.09.2026, bei solchen Arten: 14 Maßnahmen mit BBCH, 12 mit Witterung, 22 mit Temperatur).
 *                Auch nach einem Umweg über eine Art mit sichtbarem Feld der gespeicherte, nicht der dort
 *                eingegebene Wert: bei dieser Art wäre eine Änderung weder sichtbar noch korrigierbar
 *   'keine'    – nach einem Wechsel auf eine Art mit ausgeblendetem Feld: nichts senden, Speichern leert das
 *                Feld (wie beim Anlegen)
 * Die Modi schließen sich aus – je Feld sendet also immer höchstens eine Stelle des Formulars.
 * Unbekannte Arten (z. B. 'lese') gelten als 'hidden'.
 */
export const BEARBEITEN_FELDER = ['bbch', 'schaderreger', 'witterung', 'temperatur'] as const
export type BearbeitenFeld = typeof BEARBEITEN_FELDER[number]
export type FeldBeimBearbeiten = 'sichtbar' | 'behalten' | 'keine'

export function feldBeimBearbeiten(feld: BearbeitenFeld, art: string, startArt: string): FeldBeimBearbeiten {
  if (istMassnahmenArt(art) && FELD_MATRIX[art][feld] !== 'hidden') return 'sichtbar'
  return art === startArt ? 'behalten' : 'keine'
}

/** Alle Modi auf einmal – so verdrahtet das Bearbeiten-Formular die vier Felder */
export function felderBeimBearbeiten(art: string, startArt: string): Record<BearbeitenFeld, FeldBeimBearbeiten> {
  return {
    bbch:         feldBeimBearbeiten('bbch', art, startArt),
    schaderreger: feldBeimBearbeiten('schaderreger', art, startArt),
    witterung:    feldBeimBearbeiten('witterung', art, startArt),
    temperatur:   feldBeimBearbeiten('temperatur', art, startArt),
  }
}

/** Pflicht laut Feld-Matrix (Stern und `required` im Bearbeiten-Formular wie beim Anlegen) */
export function feldPflicht(feld: keyof Felder, art: string): boolean {
  return istMassnahmenArt(art) && FELD_MATRIX[art][feld] === 'pflicht'
}

/**
 * Pflicht beim Bearbeiten (KAN-154): wie beim Anlegen (feldPflicht), aber Altdaten ohne Wert bleiben unverändert
 * speicherbar – Pflicht nur nach einem Artwechsel oder wenn das Feld schon einen Wert hat (dann darf es nicht
 * geleert werden). Für Gerät und Schnittart (BBCH und Schaderreger seit KAN-155 nirgends mehr Pflicht); die Art der Laubarbeit prüft auch der Server
 * (laubarbeitArtFehlt) und bleibt immer Pflicht.
 */
export function pflichtBeimBearbeiten(
  feld: keyof Felder, art: string, startArt: string, gespeichert: string | number | null | undefined,
): boolean {
  if (!feldPflicht(feld, art)) return false
  return art !== startArt || (gespeichert != null && String(gespeichert).trim() !== '')
}

// ── Einarbeitung (Düngung, KAN-154) ──────────────────────────────────────────────
//
// Sichtbar wie beim Anlegen nur bei organischem Dünger (FELD_MATRIX einarbeitung 'bedingt'). Eine nicht
// angehakte Checkbox fehlt in der FormData – damit „nein“ (false) nicht zu „keine Angabe“ (null) wird, sendet
// das Formular neben einer gezeigten bzw. mitgesendeten Einarbeitung das Feld einarbeitung_gesendet
// (einarbeitungAus). Ohne dieses Feld (z. B. Assistent) gilt wie bisher: angehakt → true, sonst null.

/** Verstecktes Feld: die Einarbeitung wurde gesendet – fehlt „einarbeitung“, heißt das „nein“ */
export const EINARBEITUNG_GESENDET = 'einarbeitung_gesendet'

/** Anlegen und Bearbeiten: Checkbox „Eingearbeitet“ nur bei einer Art mit Einarbeitung und organischem Dünger */
export function einarbeitungSichtbar(art: string, duengemittelTyp: string | null | undefined): boolean {
  return istMassnahmenArt(art) && FELD_MATRIX[art].einarbeitung !== 'hidden' && duengemittelTyp === 'organisch'
}

/**
 * Bearbeiten (Muster felderBeimBearbeiten): 'sichtbar' – Checkbox und Zeitpunkt wie beim Anlegen; 'behalten' –
 * ausgeblendet bei unveränderter Art (z. B. mineralischer Dünger mit gespeichertem „nein“): gespeicherte Werte
 * gehen unsichtbar mit; 'keine' – nach einem Artwechsel: nichts senden, Speichern leert beide Felder.
 */
export function einarbeitungBeimBearbeiten(art: string, startArt: string, duengemittelTyp: string | null | undefined): FeldBeimBearbeiten {
  if (einarbeitungSichtbar(art, duengemittelTyp)) return 'sichtbar'
  return art === startArt ? 'behalten' : 'keine'
}

/** Server Actions: Einarbeitung aus der FormData – true, false („gesendet, nicht angehakt“) oder null */
export function einarbeitungAus(fd: FormData): boolean | null {
  const angehakt = fd.get('einarbeitung') === 'on'
  if (fd.has(EINARBEITUNG_GESENDET)) return angehakt
  return fd.has('einarbeitung') ? angehakt : null
}
