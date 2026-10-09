// ── Bestand zum Stichtag – Rückrechnung aus dem heutigen Bestand (KAN-43 Etappe 1, 02.10.2026) ──────────
//
// Ohne Bewegungsjournal (AP3) gibt es keinen gespeicherten Bestand je Tag. Der Stichtagsbestand (Ende des
// Stichtags) wird deshalb aus dem HEUTIGEN Bestand zurückgerechnet:
//     Bestand(Stichtag) = Bestand heute − Σ Buchungen mit Datum NACH dem Stichtag
// So stimmt der Stichtag „heute“ immer genau mit dem Ist-Bestand überein (keine Buchung liegt nach heute),
// und eine Bestandsänderung ohne Buchung (Altdaten, direkte Korrektur) bleibt dort, wo sie heute steht – sie wird
// als „nicht durch Buchungen erklärt“ gemeldet statt still in einen Tag geschoben.
// Vor dem Beginn eines Postens (erste Buchung bzw. Anlage/Abfüllung) ist der Bestand 0.
// Storno-Paare (Buchung am Buchungstag, Gegenbuchung am Storno-Tag, KAN-145) rechnen sich von selbst richtig.
//
// Isomorph, ohne '@/'-Importe – geprüft in scripts/tests/kan43-stichtag.test.mjs.
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
/** Eine datierte Mengenbuchung (+ Zugang, − Abgang); datum '' = unbekannt (zählt als vor jedem Stichtag) */
export type MengenBuchung = { datum: string; menge: number }

export type StichtagsBestand = {
  /** Bestand am Ende des Stichtags (gerundet); vor dem Beginn 0 */
  bestand: number
  /** true: Stichtag liegt vor dem Beginn des Postens */
  vorBeginn: boolean
  /** Teil des heutigen Bestands, den die Buchungen nicht erklären (heute − Σ aller Buchungen); 0 vor dem Beginn */
  ungeklaert: number
}

// kaufmännisch über die Dezimaldarstellung – Number.EPSILON half nicht (2,135 → 2,13); liefert nie −0
const runde = (x: number, stellen: number) => rund(x, stellen)

/** Standard-Stichtag der Weinbestandsmeldung: 31.07. des laufenden Weinwirtschaftsjahres (1.8.–31.7.) –
 *  vor dem 1. August der 31.07. des Vorjahres, sonst der 31.07. dieses Jahres */
export function standardStichtag(heute: string): string {
  const jahr = Number(heute.slice(0, 4))
  return heute.slice(5, 10) < '08-01' ? `${jahr - 1}-07-31` : `${jahr}-07-31`
}

/**
 * Bestand eines Postens (Charge oder Füllung) am Ende des Stichtags.
 * @param heute     heutiger Bestand (Liter bzw. Flaschen)
 * @param buchungen alle Buchungen des Postens (inkl. Zugang, Storno-Gegenbuchungen)
 * @param beginn    erster Tag des Postens ('JJJJ-MM-TT'); null = unbekannt (keine Untergrenze)
 * @param stellen   Rundung (Liter 2, Flaschen 0)
 */
export function bestandAmStichtag(
  heute: number,
  buchungen: readonly MengenBuchung[],
  stichtag: string,
  beginn: string | null,
  stellen: number,
): StichtagsBestand {
  let nachher = 0
  let gesamt = 0
  for (const b of buchungen) {
    gesamt += b.menge
    if (b.datum && b.datum > stichtag) nachher += b.menge
  }
  if (beginn && stichtag < beginn) return { bestand: 0, vorBeginn: true, ungeklaert: 0 }
  return {
    bestand: runde(heute - nachher, stellen),
    vorBeginn: false,
    ungeklaert: runde(heute - gesamt, stellen),
  }
}

/** Frühester bekannter Tag (leere Werte zählen nicht); null, wenn keiner bekannt ist */
export function fruehesterTag(...tage: (string | null | undefined)[]): string | null {
  let min: string | null = null
  for (const t of tage) if (t && (min === null || t < min)) min = t
  return min
}
