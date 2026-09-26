// ── Feld-Matrix je Maßnahmenart (bis KAN-143 in NeueBehandlungForm.tsx) ──────────────
//
// Steuert, welche Felder pro Art sichtbar/pflicht sind (siehe "Analyse Maßnahmen.docx", Tabelle 2).
// 'pflicht' | 'bedingt' | 'optional' | 'hidden'. Die Mengenfelder (Spritzbrühe bzw. Düngermenge, Aufwand,
// Konzentration, Wasseraufwand) kommen aus MENGEN_SICHT (mengenFelder.ts) – gemeinsam mit dem
// Bearbeiten-Formular (KAN-133). Der Assistent beschreibt dieselbe Matrix in MASSNAHME_FELD_MATRIX_TEXT
// (lib/assistent/tools/massnahme.ts).
// Laubschneiden (KAN-143): wie Laubarbeit, aber ohne „Art der Laubarbeit“ – BBCH optional, Witterung und
// Temperatur ausgeblendet, keine Mengenfelder.
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

/**
 * Bearbeiten-Formular (BehandlungEditForm): BBCH bei Spritzung, Laubarbeit und Laubschneiden (Feld-Matrix
 * nicht 'hidden') – oder wenn bei der gespeicherten Art schon ein Stadium gespeichert ist; ein
 * ausgeblendetes Feld würde beim Speichern sonst geleert. `gespeichert` nur übergeben, solange die Art
 * nicht gewechselt wurde.
 */
export function bbchBeimBearbeiten(art: string, gespeichert: string | null): boolean {
  return (istMassnahmenArt(art) && FELD_MATRIX[art].bbch !== 'hidden') || !!gespeichert
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
