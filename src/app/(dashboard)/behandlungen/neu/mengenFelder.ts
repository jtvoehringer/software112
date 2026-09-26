// ── Mengenfelder der Maßnahmen-Formulare (KAN-133 Soll 8/9, 26.09.2026) ──────
//
// Gemeinsam für Anlegen (NeueBehandlungForm) und Bearbeiten (BehandlungEditForm):
//  • Spritzung: „Spritzbrühe gesamt (l)“ ist die Brühe (Mittel + Wasser) und nie die Mittelmenge.
//    Spritzbrühe gesamt ↔ Wasseraufwand (l/ha) sind über die behandelte Fläche gekoppelt; Pflicht ist
//    eines der beiden sowie die Aufwandmenge. g/hl bzw. ml/hl gelten als Konzentration im Tank.
//  • Düngung: „Düngermenge gesamt“ in kg (l nur bei Düngemitteln in l), Aufwand ohne g/hl und ml/hl.
//  • Mittelmenge, Spritzbrühe, Cu und Reinkupfer rechnet pruefeMassnahmeMengen()
//    (lib/behandlungen/massnahmeMengen.ts) – dieselbe Prüfung wie in der Server Action.
// Ohne JSX und ohne Datenbank; die Anzeige steckt in MengenZusammenfassung.tsx.

import { fmtNum, zahlAus } from '@/lib/format'
import { runden, STELLEN } from '@/lib/csv'
import { STELLEN_MENGE } from '@/lib/behoerden/psm'
import {
  AUFWAND_EINHEITEN, AUFWAND_EINHEITEN_DUENGUNG, pruefeMassnahmeMengen,
  type MassnahmeMengenEingabe, type MassnahmeMengenErgebnis, type MassnahmeMengenWerte,
} from '@/lib/behandlungen/massnahmeMengen'

export type Sicht = 'pflicht' | 'bedingt' | 'optional' | 'hidden'
export type MengenSichten = { mengeGesamt: Sicht; aufwandmenge: Sicht; konzentration: Sicht; wasseraufwand: Sicht }

/**
 * Mengenfelder je Maßnahmenart. Spritzung: Spritzbrühe gesamt ODER Wasseraufwand ('bedingt', geprüft mit
 * bruehePflicht), Aufwand Pflicht. Düngung: Düngermenge Pflicht, Aufwand optional.
 */
export const MENGEN_SICHT: Record<'spritzung' | 'duengung' | 'bodenbearbeitung' | 'schnitt' | 'laubarbeit' | 'sonstiges', MengenSichten> = {
  spritzung:        { mengeGesamt: 'bedingt', aufwandmenge: 'pflicht',  konzentration: 'optional', wasseraufwand: 'bedingt' },
  duengung:         { mengeGesamt: 'pflicht', aufwandmenge: 'optional', konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  bodenbearbeitung: { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  schnitt:          { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  laubarbeit:       { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  sonstiges:        { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
}

/** Beschriftung der Aufwand-Einheiten; g/hl und ml/hl sind die tatsächliche Konzentration im Tank */
export const AUFWAND_EINHEIT_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl (im Tank)', ml_hl: 'ml/hl (im Tank)', kg: 'kg (gesamt)', l: 'l (gesamt)',
}

/** Beschriftung einer Option der Aufwand-Einheit; unzulässige (z. B. g/hl bei Düngung) gekennzeichnet */
export function aufwandEinheitText(einheit: string, zulaessig: readonly string[]): string {
  const text = AUFWAND_EINHEIT_LABEL[einheit] ?? einheit
  return zulaessig.includes(einheit) ? text : `${text} – nicht zulässig`
}

export function istJeHl(einheit: string | null | undefined): boolean {
  return einheit === 'g_hl' || einheit === 'ml_hl'
}

/** Zulässige Aufwand-Einheiten: Düngung ohne g/hl und ml/hl, l/ha und l nur bei Düngemitteln in l */
export function aufwandEinheiten(art: string, duengerInLiter: boolean): readonly string[] {
  if (art !== 'duengung') return AUFWAND_EINHEITEN
  return AUFWAND_EINHEITEN_DUENGUNG.filter(e => duengerInLiter || (e !== 'l_ha' && e !== 'l'))
}

/** Eingabefeld → Zahl wie in der Server Action (dezimal/zahlAus); leer = null, unlesbar = NaN (die Prüfung meldet „keine gültige Zahl“) */
export function eingabeZahl(s: string): number | null {
  return s.trim() === '' ? null : (zahlAus(s) ?? NaN)
}

/**
 * Zahl → Formularwert mit Dezimalkomma. Die Server Action liest mit dezimal(): „1.125“ wäre dort ein
 * Tausenderpunkt (1125), „1,125“ ist eindeutig. Auch für vorbelegte Eingabefelder.
 */
export function alsFeld(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '' : String(n).replace('.', ',')
}

export type MengenFelderEingaben = {
  art: string
  felder: MengenSichten
  /** Spritzung: Spritzbrühe gesamt (l); Düngung: Düngermenge */
  mengeGesamt: string
  wasseraufwand: string
  /** Welches der Felder Spritzbrühe gesamt / Wasseraufwand zuletzt befüllt wurde – treibt die Kopplung */
  mengeQuelle: 'gesamt' | 'wasser' | null
  aufwandmenge: string
  aufwandmengeEinheit: string
  konzentration: string
  /** Analog für Aufwandmenge / Konzentration (%) */
  aufwandQuelle: 'aufwand' | 'konzentration' | null
  /** Σ Fläche der gewählten bzw. der zugeordneten WI-GST (ha) */
  flaecheHa: number | null
  psmId: string | null
  psm: MassnahmeMengenEingabe['psm']
  duengemittelId: string | null
  duengemittelEinheit: string | null
}

export type MengenFelderWerte = {
  /** behandelte Fläche (ha, 4 Stellen); null = keine */
  ha: number | null
  /** Einheit von „Menge gesamt“: Spritzbrühe immer l, Düngermenge kg bzw. l beim Düngemittel in l */
  mengeEinheit: 'kg' | 'l'
  /** Optionen der Aufwand-Einheit: die zulässigen, dazu eine gewählte unzulässige (siehe aufwandEinheitText) */
  einheiten: readonly string[]
  zulaessig: readonly string[]
  aufwandEinheit: string
  jeHl: boolean
  /** berechnete (gesperrte) Felder; null = Feld frei */
  mengeGesamtBerechnet: number | null
  wasserBerechnet: number | null
  aufwandmengeBerechnet: number | null
  konzentrationBerechnet: number | null
  konzentrationNum: number | null
  konzentrationFehler: string | null
  /** Eingabe für pruefeMassnahmeMengen() – dieselbe Prüfung wie in der Server Action */
  eingabe: MassnahmeMengenEingabe
  /** Prüfung ohne Brühe-Pflicht für die Live-Anzeige; beim Absenden mit { bruehePflicht: true } */
  pruefung: MassnahmeMengenErgebnis
}

// Konzentration (%) aus der Aufwandmenge und umgekehrt: g/hl, ml/hl ÷ 1000 ≈ %; kg/ha, l/ha nur mit
// Wasseraufwand (Konzentration % = Aufwand ÷ Wasseraufwand × 100). Die Mittelmenge rechnet nie aus
// der Konzentration (%) – die Spalte hat nur 2 Nachkommastellen.
function konzentrationAus(aufwand: number | null, einheit: string, wasserLHa: number | null): number | null {
  if (aufwand === null || !Number.isFinite(aufwand)) return null
  if (istJeHl(einheit)) return aufwand / 1000
  if ((einheit === 'kg_ha' || einheit === 'l_ha') && wasserLHa) return (aufwand / wasserLHa) * 100
  return null
}
function aufwandAus(konz: number | null, einheit: string, wasserLHa: number | null): number | null {
  if (konz === null || !Number.isFinite(konz)) return null
  if (istJeHl(einheit)) return runden(konz * 1000, STELLEN_MENGE)
  if ((einheit === 'kg_ha' || einheit === 'l_ha') && wasserLHa) return runden((konz / 100) * wasserLHa, STELLEN_MENGE)
  return null
}

/** Kopplungen der Mengenfelder und Eingabe für die gemeinsame Prüfung (Regeln im Dateikopf) */
export function mengenFelder(e: MengenFelderEingaben): MengenFelderWerte {
  const ha = e.flaecheHa !== null && e.flaecheHa > 0 ? runden(e.flaecheHa, STELLEN.ha) : null
  const istSpritzung = e.art === 'spritzung'
  const duengerInLiter = e.duengemittelEinheit === 'l'
  const mengeEinheit = istSpritzung || duengerInLiter ? 'l' : 'kg'

  // Spritzbrühe gesamt (l) ↔ Wasseraufwand (l/ha) über die Fläche, nur bei Spritzungen: das zuletzt
  // befüllte Feld treibt die Berechnung, das andere wird gesperrt. Die Brühe ist immer in Litern – aus
  // einer Mittelmenge (kg) wird nie eine Brühe.
  const menge = eingabeZahl(e.mengeGesamt)
  const wasser = eingabeZahl(e.wasseraufwand)
  const mengeGesamtBerechnet = istSpritzung && e.mengeQuelle === 'wasser' && wasser !== null && wasser > 0 && ha !== null
    ? runden(wasser * ha, STELLEN_MENGE) : null
  const wasserBerechnet = istSpritzung && e.mengeQuelle === 'gesamt' && menge !== null && menge > 0 && ha !== null
    ? runden(menge / ha, 2) : null
  const mengeNum = mengeGesamtBerechnet ?? menge
  const wasserNum = wasserBerechnet ?? wasser

  // Aufwandmenge ↔ Konzentration (%) – gegenseitige Sperre wie bei der Spritzbrühe. Eine nicht (mehr)
  // zulässige Einheit (z. B. l/ha nach Wechsel auf ein Düngemittel in kg) bleibt stehen und wird von der
  // Prüfung abgelehnt – nie still auf eine andere Einheit umdeuten.
  const zulaessig = aufwandEinheiten(e.art, duengerInLiter)
  const aufwandEinheit = e.aufwandmengeEinheit
  const einheiten = zulaessig.includes(aufwandEinheit) ? zulaessig : [...zulaessig, aufwandEinheit]
  const wasserLHa = wasserNum !== null && wasserNum > 0 ? wasserNum : null
  const konz = eingabeZahl(e.konzentration)
  const konzentrationBerechnet = e.aufwandQuelle === 'aufwand' ? konzentrationAus(eingabeZahl(e.aufwandmenge), aufwandEinheit, wasserLHa) : null
  const aufwandmengeBerechnet = e.aufwandQuelle === 'konzentration' ? aufwandAus(konz, aufwandEinheit, wasserLHa) : null
  const aufwandNum = aufwandmengeBerechnet ?? eingabeZahl(e.aufwandmenge)
  const konzentrationNum = konzentrationBerechnet ?? konz
  const konzentrationFehler = e.felder.konzentration === 'hidden' || konzentrationNum === null ? null
    : !Number.isFinite(konzentrationNum) ? '„Konzentration (%)“ ist keine gültige Zahl.'
    : konzentrationNum < 0 || konzentrationNum > 100 ? '„Konzentration (%)“ muss zwischen 0 und 100 liegen.'
    : null

  const sichtbar = (s: Sicht) => s !== 'hidden'
  const eingabe: MassnahmeMengenEingabe = {
    art: e.art,
    psmId: e.psmId, psm: e.psm,
    duengemittelId: e.duengemittelId, duengemittelEinheit: e.duengemittelEinheit,
    aufwand: sichtbar(e.felder.aufwandmenge) ? aufwandNum : null,
    aufwandEinheit: sichtbar(e.felder.aufwandmenge) ? aufwandEinheit : null,
    mengeGesamt: sichtbar(e.felder.mengeGesamt) ? mengeNum : null,
    mengeEinheit: sichtbar(e.felder.mengeGesamt) ? mengeEinheit : null,
    wasserLHa: sichtbar(e.felder.wasseraufwand) ? wasserNum : null,
    flaecheHa: ha,
  }
  return {
    ha, mengeEinheit, einheiten, zulaessig, aufwandEinheit, jeHl: istJeHl(aufwandEinheit),
    mengeGesamtBerechnet, wasserBerechnet, aufwandmengeBerechnet, konzentrationBerechnet,
    konzentrationNum, konzentrationFehler,
    eingabe, pruefung: pruefeMassnahmeMengen(eingabe),
  }
}

/**
 * Geprüfte Mengen in die FormData – so, wie die Prüfung sie normalisiert hat (Spritzbrühe in l, ergänzter
 * Wasseraufwand …). Gesperrte Felder sind disabled und fehlen sonst in der FormData.
 */
export function mengenInFormData(fd: FormData, felder: MengenSichten, werte: MassnahmeMengenWerte, konzentration: number | null) {
  if (felder.aufwandmenge !== 'hidden') {
    fd.set('aufwandmenge', alsFeld(werte.aufwandmenge))
    fd.set('aufwandmenge_einheit', werte.aufwandmenge_einheit ?? '')
  }
  if (felder.mengeGesamt !== 'hidden') {
    fd.set('menge_gesamt', alsFeld(werte.menge_gesamt))
    fd.set('menge_einheit', werte.menge_einheit ?? '')
  }
  if (felder.wasseraufwand !== 'hidden') fd.set('wasseraufwand_l_ha', alsFeld(werte.wasseraufwand_l_ha))
  if (felder.konzentration !== 'hidden') fd.set('konzentration', alsFeld(konzentration))
}

export type MengenTexte = {
  /** „Mittelmenge“ (Spritzung) bzw. „Düngermenge“ */
  mittelLabel: string
  mittel: string | null
  basis: string | null
  /** Mittelmenge je ha – nur, wenn der Aufwand nicht ohnehin je ha erfasst ist */
  jeHa: string | null
  bruehe: string | null
  cu: string | null
  reinkupfer: string | null
}

/** Anzeigetexte aus der Prüfung; null, solange die Eingaben nicht gültig sind */
export function mengenTexte(art: string, r: MassnahmeMengenErgebnis, ha: number | null): MengenTexte | null {
  if (!r.ok) return null
  const mm = r.mittelmenge
  const mittelLabel = art === 'duengung' ? 'Düngermenge' : 'Mittelmenge'
  const mittel = mm.menge !== null && mm.einheit ? `${fmtNum(mm.menge, { max: 3 })} ${mm.einheit}` : null
  return {
    mittelLabel,
    mittel,
    basis: mittel && mm.basis !== mittelLabel ? mm.basis : null,
    jeHa: mm.menge !== null && mm.einheit && ha !== null && mm.basis !== 'Aufwand × Fläche'
      ? `${fmtNum(mm.menge / ha, { max: 3 })} ${mm.einheit}/ha` : null,
    bruehe: r.spritzbruehe !== null ? `${fmtNum(r.spritzbruehe, { max: 3 })} l` : null,
    cu: r.cuKg !== null ? `${fmtNum(r.cuKg * 1000, { max: 1 })} g Cu` : null,
    reinkupfer: r.werte.reinkupfer_kg_ha !== null ? `${fmtNum(r.werte.reinkupfer_kg_ha, { max: 4 })} kg Cu/ha` : null,
  }
}
