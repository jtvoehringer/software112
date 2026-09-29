// ── Mengenfelder der Maßnahmen-Formulare (KAN-133 Soll 8/9, 26.09.2026) ──────
//
// Gemeinsam für Anlegen (NeueBehandlungForm) und Bearbeiten (BehandlungEditForm):
//  • Spritzung: „Spritzbrühe gesamt (l)“ ist die Brühe (Mittel + Wasser) und nie die Mittelmenge.
//    Spritzbrühe gesamt ↔ Wasseraufwand (l/ha) sind über die behandelte Fläche gekoppelt; Pflicht ist
//    eines der beiden sowie die Aufwandmenge. g/hl bzw. ml/hl gelten als Konzentration im Tank.
//    Aufwand, Konzentration (%) und Wasseraufwand: je zwei bestimmen die dritte (KAN-155, Abschnitt unten).
//  • Düngung: „Düngermenge gesamt“ in der Einheit des Düngemittels (kg, bei Düngemitteln in l nur l),
//    Aufwand ohne g/hl und ml/hl.
//  • Mittelmenge, Spritzbrühe, Cu und Reinkupfer rechnet pruefeMassnahmeMengen()
//    (lib/behandlungen/massnahmeMengen.ts) – dieselbe Prüfung wie in der Server Action.
// Ohne JSX und ohne Datenbank; die Anzeige steckt in MengenZusammenfassung.tsx.

import { fmtNum, zahlAus } from '@/lib/format'
import { runden, STELLEN } from '@/lib/csv'
import { AUFWAND_EINHEIT_LABEL, STELLEN_MENGE, mengeInEinheit } from '@/lib/behoerden/psm'
import {
  AUFWAND_EINHEITEN, AUFWAND_EINHEITEN_DUENGUNG, AUFWAND_EINHEITEN_SONSTIGES, pruefeMassnahmeMengen, wasseraufwandAusKonzentration,
  type MassnahmeMengenEingabe, type MassnahmeMengenErgebnis, type MassnahmeMengenWerte,
} from '@/lib/behandlungen/massnahmeMengen'
import type { MassnahmenArt } from '@/lib/behandlungen/arten'

export type Sicht = 'pflicht' | 'bedingt' | 'optional' | 'hidden'
export type MengenSichten = { mengeGesamt: Sicht; aufwandmenge: Sicht; konzentration: Sicht; wasseraufwand: Sicht }

/**
 * Mengenfelder je Maßnahmenart. Spritzung: Spritzbrühe gesamt ODER Wasseraufwand ('bedingt', geprüft mit
 * bruehePflicht), Aufwand Pflicht. Düngung: Düngermenge Pflicht, Aufwand optional. Laubschneiden (KAN-143)
 * wie Laubarbeit ohne Mengenfelder. Sonstiges (KAN-154): Aufwand 'bedingt' – optional, sobald ein
 * Pflanzenschutzmittel gewählt ist (mengenSicht), damit Lager und Mittelverbrauch es wie bei der Spritzung abziehen.
 */
export const MENGEN_SICHT: Record<MassnahmenArt, MengenSichten> = {
  spritzung:        { mengeGesamt: 'bedingt', aufwandmenge: 'pflicht',  konzentration: 'optional', wasseraufwand: 'bedingt' },
  duengung:         { mengeGesamt: 'pflicht', aufwandmenge: 'optional', konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  bodenbearbeitung: { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  schnitt:          { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  laubarbeit:       { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  laubschneiden:    { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'  },
  sonstiges:        { mengeGesamt: 'hidden',  aufwandmenge: 'bedingt',  konzentration: 'hidden',   wasseraufwand: 'hidden'  },
}

/**
 * Mengenfelder, wie die Formulare sie zeigen: der Aufwand bei Sonstiges ('bedingt') nur mit gewähltem
 * Pflanzenschutzmittel und dann optional, sonst ausgeblendet (nicht gesendet → null). Alle anderen wie MENGEN_SICHT.
 */
export function mengenSicht(art: MassnahmenArt, psmGewaehlt: boolean): MengenSichten {
  const s = MENGEN_SICHT[art]
  if (art !== 'sonstiges') return s
  return { ...s, aufwandmenge: psmGewaehlt ? 'optional' : 'hidden' }
}

/**
 * Beschriftung einer Option der Aufwand-Einheit (AUFWAND_EINHEIT_LABEL wie in psm-aufzeichnung und Druck;
 * g/hl und ml/hl sind die tatsächliche Konzentration im Tank); unzulässige (z. B. g/hl bei Düngung) gekennzeichnet
 */
export function aufwandEinheitText(einheit: string, zulaessig: readonly string[]): string {
  const text = AUFWAND_EINHEIT_LABEL[einheit] ?? einheit
  return zulaessig.includes(einheit) ? text : `${text} – nicht zulässig`
}

export function istJeHl(einheit: string | null | undefined): boolean {
  return einheit === 'g_hl' || einheit === 'ml_hl'
}

/**
 * Zulässige Aufwand-Einheiten: Düngung ohne g/hl und ml/hl, l/ha und l nur bei Düngemitteln in l;
 * Sonstiges ohne g/hl und ml/hl (keine Spritzbrühe, KAN-154)
 */
export function aufwandEinheiten(art: string, duengerInLiter: boolean): readonly string[] {
  if (art === 'sonstiges') return AUFWAND_EINHEITEN_SONSTIGES
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

/** Einheit der Düngermenge: l nur bei Düngemitteln in l, sonst kg – ohne Dichte-Annahme (KAN-133 Entscheidung 1) */
export function duengermengeEinheit(duengemittelEinheit: string | null | undefined): 'kg' | 'l' {
  return duengemittelEinheit === 'l' ? 'l' : 'kg'
}

/**
 * Vorbelegung von „Menge gesamt“ beim Bearbeiten in der Einheit des Felds (Spritzung: Spritzbrühe in l,
 * Düngung: Einheit des gewählten Düngemittels). Passt die gespeicherte Einheit nicht – vor allem bei einer
 * Spritzung in kg/g, die vor KAN-133 als Mittelmenge erfasst wurde, oder bei einer Düngermenge in kg nach
 * dem Wechsel auf ein Düngemittel in l –, bleibt das Feld leer und `altwert` nennt den bisherigen Wert: er
 * wird nie still in die andere Einheit umgedeutet. `gespeichertEinheit`: Einheit des gespeicherten
 * Düngemittels (ohne Angabe `duengerEinheit`) – gilt für eine Düngermenge ohne gespeicherte Einheit.
 */
export function mengeVorbelegung(
  b: { art: string; menge_gesamt: number | null; menge_einheit: string | null },
  duengerEinheit: 'kg' | 'l',
  gespeichertEinheit: 'kg' | 'l' = duengerEinheit,
): { text: string; altwert: string | null } {
  if (b.menge_gesamt === null) return { text: '', altwert: null }
  const ziel = b.art === 'spritzung' ? 'l' : b.art === 'duengung' ? duengerEinheit : null
  if (!ziel) return { text: alsFeld(b.menge_gesamt), altwert: null }
  // ohne Einheit: Spritzbrühe in l bzw. Düngermenge in der Einheit des gespeicherten Düngemittels (wie
  // pruefeMassnahmeMengen) – nach einem Wechsel kg ↔ l also Altwert, nie still umgedeutet
  const von = b.menge_einheit ?? (b.art === 'spritzung' ? 'l' : gespeichertEinheit)
  const menge = mengeInEinheit(b.menge_gesamt, von, ziel)
  return menge !== null
    ? { text: alsFeld(menge), altwert: null }
    : { text: '', altwert: `${fmtNum(b.menge_gesamt, { max: 3 })} ${von}` }
}

/**
 * Hinweis, wenn ein anderes Düngemittel die Einheit der Düngermenge wechselt (kg ↔ l) und im Feld schon eine
 * eigene Eingabe steht: die Zahl bleibt stehen, wird aber nie umgerechnet (950 kg sind nicht 950 l) – bitte prüfen.
 */
export function duengerEinheitWechsel(von: 'kg' | 'l', nach: 'kg' | 'l', menge: string): string | null {
  if (von === nach || menge.trim() === '') return null
  return `Einheit der Düngermenge von ${von} auf ${nach} gewechselt (anderes Düngemittel) – die Zahl wird nicht umgerechnet, bitte prüfen.`
}

// ── Aufwand, Konzentration und Wasseraufwand: je zwei bestimmen die dritte (KAN-155) ──────────────
//
// Aufwand (kg/ha, l/ha) = Wasseraufwand (l/ha) × Konzentration (%) ÷ 100. Welche Größe berechnet wird, ergibt
// sich aus der Reihenfolge der Eingaben (`folge`, zuletzt geänderte Größe am Ende – eingabeFolge()):
//  • gerechnet wird erst, wenn in dieser Sitzung eines der Felder geändert wurde – gespeicherte Werte im
//    Bearbeiten-Formular bleiben bis dahin frei und unverändert;
//  • berechnet wird die Größe, die NICHT unter den zwei zuletzt eingegebenen ist. Felder mit Wert, die in dieser
//    Sitzung nicht geändert wurden (Bearbeiten: gespeicherte Werte), zählen als ältere Eingaben in der festen
//    Reihenfolge Konzentration, Aufwand, Wasseraufwand – so bleibt wie bisher der Wasseraufwand stehen und
//    Konzentration bzw. Aufwand folgen;
//  • die zwei eingegebenen Felder bleiben änderbar, das berechnete ist gesperrt und trägt einen Hinweis. Wer eine
//    andere Größe rechnen lassen will, leert eines der eingegebenen Felder. Keine Zyklen: das berechnete Feld ist
//    nie Quelle einer weiteren Rechnung dieser drei Größen.
// „Wasseraufwand“ steht dabei für das Paar Spritzbrühe gesamt ↔ Wasseraufwand (l/ha): eine Eingabe in einem der
// beiden zählt als Wasseraufwand (mengeQuelle entscheidet wie bisher, welches der beiden aus dem anderen über die
// Fläche folgt). Wird der Wasseraufwand aus Aufwand und Konzentration berechnet, sind beide gesperrt und die
// Spritzbrühe gesamt = Wasseraufwand × Fläche.
// g/hl bzw. ml/hl (Konzentration im Tank) rechnen wie bisher nur Aufwand ↔ Konzentration (÷ bzw. × 1000) – ohne
// Wasseraufwand; kg bzw. l gesamt rechnen nichts. Die Mittelmenge kommt weiterhin nur aus dem Aufwand (KAN-133).

export type MengenGroesse = 'aufwand' | 'konzentration' | 'wasser'
/** Feste Reihenfolge der in dieser Sitzung nicht geänderten Felder mit Wert – die erste gilt als älteste */
const UNGEAENDERT_REIHENFOLGE: readonly MengenGroesse[] = ['konzentration', 'aufwand', 'wasser']

/**
 * Reihenfolge nach einer Eingabe in `groesse` (Spritzbrühe gesamt und Wasseraufwand beide als 'wasser'): die Größe
 * rückt ans Ende; ein geleertes Feld fällt heraus.
 */
export function eingabeFolge(folge: readonly MengenGroesse[], groesse: MengenGroesse, wert: string): MengenGroesse[] {
  const rest = folge.filter(g => g !== groesse)
  return wert.trim() === '' ? rest : [...rest, groesse]
}

/**
 * Welche der drei Größen berechnet wird (Regeln oben); null = keine. `vorhanden`: Feld hat einen Wert (auch einen
 * gespeicherten). `jeHl`: g/hl bzw. ml/hl – nur Aufwand ↔ Konzentration, die ältere der beiden wird berechnet.
 */
export function berechneteGroesse(
  folge: readonly MengenGroesse[], vorhanden: Readonly<Record<MengenGroesse, boolean>>, jeHl: boolean,
): MengenGroesse | null {
  if (folge.length === 0) return null
  const reihe = [...UNGEAENDERT_REIHENFOLGE.filter(g => vorhanden[g] && !folge.includes(g)), ...folge]
  if (jeHl) {
    const ak = reihe.filter(g => g !== 'wasser')
    if (ak.length === 0) return null
    return ak[ak.length - 1] === 'aufwand' ? 'konzentration' : 'aufwand'
  }
  if (reihe.length < 2) return null
  const zuletzt = reihe.slice(-2)
  return UNGEAENDERT_REIHENFOLGE.find(g => !zuletzt.includes(g)) ?? null
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
  /** Reihenfolge der Eingaben in Aufwand, Konzentration und Spritzbrühe/Wasseraufwand (eingabeFolge, KAN-155) */
  folge: readonly MengenGroesse[]
  /** Σ Fläche der gewählten bzw. der zugeordneten WI-GST (ha) */
  flaecheHa: number | null
  psmId: string | null
  psm: MassnahmeMengenEingabe['psm']
  duengemittelId: string | null
  duengemittelEinheit: string | null
  /** Formular für den Hinweistext ohne Fläche: Anlegen (Ried-Auswahl) bzw. Bearbeiten (zugeordnete Grundstücke); Vorgabe 'neu' */
  formular?: 'neu' | 'bearbeiten'
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
  /** berechnete Werte; null = nicht berechnet */
  mengeGesamtBerechnet: number | null
  wasserBerechnet: number | null
  aufwandmengeBerechnet: number | null
  konzentrationBerechnet: number | null
  /** Größe, die aus den beiden anderen berechnet wird (KAN-155); null = keine bzw. nicht berechenbar */
  berechnet: MengenGroesse | null
  /** gesperrte (disabled) Felder: berechnet – die Spritzbrühe auch, solange sie aus einem berechneten Wasseraufwand folgt */
  gesperrt: { aufwandmenge: boolean; konzentration: boolean; wasser: boolean; mengeGesamt: boolean }
  /** Hinweis unter dem berechneten Feld („Automatisch berechnet aus …“); null = keiner */
  berechnetHinweis: { aufwandmenge: string | null; konzentration: string | null; wasser: string | null; mengeGesamt: string | null }
  konzentrationNum: number | null
  konzentrationFehler: string | null
  /** Hinweis unter „Konzentration (%)“, wenn kg/ha bzw. l/ha ↔ % nicht rechnet, weil etwas fehlt; null = keiner */
  konzentrationHinweis: string | null
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

/** Kopplungen der Mengenfelder und Eingabe für die gemeinsame Prüfung (Regeln im Dateikopf und oben) */
export function mengenFelder(e: MengenFelderEingaben): MengenFelderWerte {
  const ha = e.flaecheHa !== null && e.flaecheHa > 0 ? runden(e.flaecheHa, STELLEN.ha) : null
  const istSpritzung = e.art === 'spritzung'
  const duengerInLiter = e.duengemittelEinheit === 'l'
  const mengeEinheit = istSpritzung ? 'l' : duengermengeEinheit(e.duengemittelEinheit)
  const ohneFlaeche = e.formular === 'bearbeiten'
    ? 'Ohne zugeordnete Grundstücke nicht berechenbar.'
    : 'Wird berechnet, sobald Ried(en) ausgewählt sind.'

  // Eine nicht (mehr) zulässige Einheit (z. B. l/ha nach Wechsel auf ein Düngemittel in kg) bleibt stehen und
  // wird von der Prüfung abgelehnt – nie still auf eine andere Einheit umdeuten.
  const zulaessig = aufwandEinheiten(e.art, duengerInLiter)
  const aufwandEinheit = e.aufwandmengeEinheit
  const einheiten = zulaessig.includes(aufwandEinheit) ? zulaessig : [...zulaessig, aufwandEinheit]
  const jeHaEinheit = aufwandEinheit === 'kg_ha' || aufwandEinheit === 'l_ha'

  const menge = eingabeZahl(e.mengeGesamt)
  const wasser = eingabeZahl(e.wasseraufwand)
  const aufwand = eingabeZahl(e.aufwandmenge)
  const konz = eingabeZahl(e.konzentration)

  // Welche der drei Größen berechnet wird – nur, wenn das Konzentrationsfeld sichtbar ist (Spritzung) und die
  // Einheit rechnet (kg/ha, l/ha bzw. g/hl, ml/hl)
  const ziel = e.felder.konzentration !== 'hidden' && (jeHaEinheit || istJeHl(aufwandEinheit))
    ? berechneteGroesse(e.folge, {
        aufwand: aufwand !== null,
        konzentration: konz !== null,
        wasser: wasser !== null || (istSpritzung && menge !== null),
      }, istJeHl(aufwandEinheit))
    : null

  // Wasseraufwand aus Aufwand und Konzentration (KAN-155); nicht berechenbar (z. B. Konzentration 0) → Felder wie bisher
  const wasserAusAK = ziel === 'wasser' && istSpritzung ? wasseraufwandAusKonzentration(aufwand, aufwandEinheit, konz) : null
  const wasserAusAKAktiv = wasserAusAK !== null

  // Spritzbrühe gesamt (l) ↔ Wasseraufwand (l/ha) über die Fläche, nur bei Spritzungen: das zuletzt befüllte Feld
  // treibt die Berechnung, das andere wird gesperrt; ein aus Aufwand und Konzentration berechneter Wasseraufwand
  // treibt die Spritzbrühe. Die Brühe ist immer in Litern – aus einer Mittelmenge (kg) wird nie eine Brühe.
  const wasserQuelle = wasserAusAKAktiv ? wasserAusAK : e.mengeQuelle === 'wasser' ? wasser : null
  const mengeGesamtBerechnet = istSpritzung && (wasserAusAKAktiv || e.mengeQuelle === 'wasser')
    && wasserQuelle !== null && wasserQuelle > 0 && ha !== null
    ? runden(wasserQuelle * ha, STELLEN_MENGE) : null
  const wasserBerechnet = wasserAusAKAktiv ? wasserAusAK
    : istSpritzung && e.mengeQuelle === 'gesamt' && menge !== null && menge > 0 && ha !== null ? runden(menge / ha, 2) : null
  // Brühe aus berechnetem Wasseraufwand ohne Fläche: gesperrt und leer, nie eine alte Eingabe mitsenden
  const mengeNum = wasserAusAKAktiv ? mengeGesamtBerechnet : mengeGesamtBerechnet ?? menge
  const wasserNum = wasserBerechnet ?? wasser

  // Aufwandmenge ↔ Konzentration (%) mit dem Wasseraufwand (kg/ha, l/ha) bzw. direkt (g/hl, ml/hl)
  const wasserLHa = wasserNum !== null && wasserNum > 0 ? wasserNum : null
  const konzentrationBerechnet = ziel === 'konzentration' ? konzentrationAus(aufwand, aufwandEinheit, wasserLHa) : null
  const aufwandmengeBerechnet = ziel === 'aufwand' ? aufwandAus(konz, aufwandEinheit, wasserLHa) : null
  const aufwandNum = aufwandmengeBerechnet ?? aufwand
  const konzentrationNum = konzentrationBerechnet ?? konz
  const konzentrationFehler = e.felder.konzentration === 'hidden' || konzentrationNum === null ? null
    : !Number.isFinite(konzentrationNum) ? '„Konzentration (%)“ ist keine gültige Zahl.'
    : konzentrationNum < 0 || konzentrationNum > 100 ? '„Konzentration (%)“ muss zwischen 0 und 100 liegen.'
    : null

  const berechnet: MengenGroesse | null =
    konzentrationBerechnet !== null ? 'konzentration'
    : aufwandmengeBerechnet !== null ? 'aufwand'
    : wasserAusAKAktiv ? 'wasser'
    : null
  const gesperrt = {
    aufwandmenge: aufwandmengeBerechnet !== null,
    konzentration: konzentrationBerechnet !== null,
    wasser: wasserBerechnet !== null,
    mengeGesamt: mengeGesamtBerechnet !== null || wasserAusAKAktiv,
  }
  const jeHl = istJeHl(aufwandEinheit)
  const berechnetHinweis = {
    aufwandmenge: aufwandmengeBerechnet === null ? null
      : jeHl ? 'Automatisch berechnet aus Konzentration (%) × 1000.'
      : 'Automatisch berechnet aus Konzentration (%) × Wasseraufwand (l/ha) ÷ 100.',
    konzentration: konzentrationBerechnet === null ? null
      : jeHl ? 'Automatisch berechnet aus der Konzentration im Tank ÷ 1000.'
      : 'Automatisch berechnet aus Aufwandmenge ÷ Wasseraufwand (l/ha) × 100.',
    wasser: wasserAusAKAktiv ? 'Automatisch berechnet aus Aufwandmenge ÷ Konzentration (%) × 100.'
      : wasserBerechnet !== null ? 'Automatisch berechnet aus Spritzbrühe gesamt ÷ Fläche.'
      : istSpritzung && e.mengeQuelle === 'gesamt' && menge !== null && menge > 0 ? ohneFlaeche
      : null,
    mengeGesamt: mengeGesamtBerechnet !== null ? 'Automatisch berechnet aus Wasseraufwand (l/ha) × Fläche.'
      : istSpritzung && (wasserAusAKAktiv || (e.mengeQuelle === 'wasser' && wasser !== null && wasser > 0)) ? ohneFlaeche
      : null,
  }

  // Hinweis unter „Konzentration (%)“ (kg/ha, l/ha): es wurde etwas eingegeben, aber keine der drei Größen lässt
  // sich berechnen – er nennt, was tatsächlich fehlt. Steht die Spritzbrühe gesamt schon da, fehlt die Fläche
  // (Ried-Auswahl bzw. zugeordnete Grundstücke) oder der Wasseraufwand, nicht die Brühe.
  const konzentrationHinweis = e.felder.konzentration === 'hidden' || e.folge.length === 0 || !jeHaEinheit
    || berechnet !== null || wasserLHa !== null || konzentrationFehler !== null
    ? null
    : ziel === 'wasser' && konz === 0
      ? 'Aus einer Konzentration von 0 % lässt sich der Wasseraufwand nicht berechnen – bitte Wasseraufwand (l/ha) oder Spritzbrühe gesamt angeben.'
    : !(mengeNum !== null && mengeNum > 0)
      ? aufwand !== null && konz === null
        ? 'Für die automatische Berechnung bitte Konzentration (%), Wasseraufwand (l/ha) oder Spritzbrühe gesamt angeben.'
        : konz !== null && aufwand === null
          ? 'Für die automatische Berechnung bitte Aufwandmenge, Wasseraufwand (l/ha) oder Spritzbrühe gesamt angeben.'
          : null
      : ha !== null
        ? 'Für die automatische Berechnung bitte Wasseraufwand (l/ha) angeben.'
        : e.formular === 'bearbeiten'
          ? 'Ohne zugeordnete Grundstücke lässt sich die Spritzbrühe gesamt nicht umrechnen – für die Berechnung bitte Wasseraufwand (l/ha) angeben.'
          : 'Konzentration wird berechnet, sobald Ried(en) ausgewählt sind – oder Wasseraufwand (l/ha) angeben.'

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
    konzentrationPct: sichtbar(e.felder.konzentration) ? konzentrationNum : null,
    flaecheHa: ha,
  }
  return {
    ha, mengeEinheit, einheiten, zulaessig, aufwandEinheit, jeHl,
    mengeGesamtBerechnet, wasserBerechnet, aufwandmengeBerechnet, konzentrationBerechnet,
    berechnet, gesperrt, berechnetHinweis,
    konzentrationNum, konzentrationFehler, konzentrationHinweis,
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
