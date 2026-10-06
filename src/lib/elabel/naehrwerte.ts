// KAN-216: Nährwerte je 100 ml für das E-Label (VO (EU) 1169/2011, Anhang XIV/XV) aus der Weinanalyse.
// Isomorph und ohne @/-Importe (node:test).
//
// Umrechnungsfaktoren Anhang XIV: Alkohol 29 kJ / 7 kcal je g, Kohlenhydrate 17 kJ / 4 kcal, organische Säuren
// 13 kJ / 3 kcal, mehrwertige Alkohole (Glycerin) 10 kJ / 2,4 kcal. Alkohol in g/100 ml = Vol-% × 0,789.
// Rundung nach dem Leitfaden der Kommission zu Toleranzen (Dezember 2012): Energie ganzzahlig; Kohlenhydrate, Zucker,
// Fett, Eiweiß ≥ 10 g auf 1 g, > 0,5 g auf 0,1 g, sonst 0; gesättigte Fettsäuren ≥ 10 g auf 1 g, > 0,1 g auf 0,1 g,
// sonst 0; Salz ≥ 1 g auf 0,1 g, > 0,0125 g auf 0,01 g, sonst 0.

export const ALKOHOL_DICHTE = 0.789

export type NaehrwertEingabe = {
  alkoholVol: number | null      // % vol
  restzuckerGl: number | null    // g/l
  gesamtsaeureGl: number | null  // g/l (als Weinsäure)
  glycerinGl?: number | null     // g/l, optional (fehlt meist in der Analyse)
}

export type Naehrwerte = {
  energieKj: number
  energieKcal: number
  fettG: number
  fettGesaettigtG: number
  kohlenhydrateG: number
  zuckerG: number
  eiweissG: number
  salzG: number
}

export type NaehrwertArt = 'energie' | 'makro' | 'gesaettigt' | 'salz'

function rund(wert: number, stellen: number): number {
  const f = 10 ** stellen
  return Math.round((wert + Number.EPSILON) * f) / f
}

/** Rundung nach dem Leitfaden der Kommission (siehe Kopf). */
export function rundeNaehrwert(art: NaehrwertArt, wert: number): number {
  if (!Number.isFinite(wert) || wert <= 0) return 0
  switch (art) {
    case 'energie':    return Math.round(wert)
    case 'makro':      return wert >= 10 ? Math.round(wert) : wert > 0.5 ? rund(wert, 1) : 0
    case 'gesaettigt': return wert >= 10 ? Math.round(wert) : wert > 0.1 ? rund(wert, 1) : 0
    case 'salz':       return wert >= 1 ? rund(wert, 1) : wert > 0.0125 ? rund(wert, 2) : 0
  }
}

/** Fehlende Pflichtangaben der Berechnung (leer = rechenbar). */
export function naehrwertFehler(e: NaehrwertEingabe): string[] {
  const f: string[] = []
  if (e.alkoholVol == null || !Number.isFinite(e.alkoholVol)) f.push('Alkohol (% vol)')
  if (e.restzuckerGl == null || !Number.isFinite(e.restzuckerGl)) f.push('Restzucker (g/l)')
  if (e.gesamtsaeureGl == null || !Number.isFinite(e.gesamtsaeureGl)) f.push('Gesamtsäure (g/l)')
  return f
}

/** Nährwerte je 100 ml, gerundet; null, wenn Alkohol, Restzucker oder Säure fehlen. */
export function berechneNaehrwerte(e: NaehrwertEingabe): Naehrwerte | null {
  if (naehrwertFehler(e).length > 0) return null
  const alkoholG = Math.max(0, e.alkoholVol as number) * ALKOHOL_DICHTE
  const zuckerG = Math.max(0, e.restzuckerGl as number) / 10
  const saeureG = Math.max(0, e.gesamtsaeureGl as number) / 10
  const glycerinG = Math.max(0, e.glycerinGl ?? 0) / 10
  const kj = alkoholG * 29 + zuckerG * 17 + saeureG * 13 + glycerinG * 10
  const kcal = alkoholG * 7 + zuckerG * 4 + saeureG * 3 + glycerinG * 2.4
  const kh = rundeNaehrwert('makro', zuckerG)
  return {
    energieKj: rundeNaehrwert('energie', kj),
    energieKcal: rundeNaehrwert('energie', kcal),
    fettG: 0,
    fettGesaettigtG: 0,
    kohlenhydrateG: kh,
    zuckerG: kh,
    eiweissG: 0,
    salzG: 0,
  }
}

/** „Enthält geringfügige Mengen von …“ (Anhang XV Nr. 5) – Bestandteile mit 0 nach Rundung. */
export function geringfuegigeMengen(n: Pick<Naehrwerte, 'fettG' | 'fettGesaettigtG' | 'eiweissG' | 'salzG'>): ('fett' | 'gesaettigt' | 'eiweiss' | 'salz')[] {
  const l: ('fett' | 'gesaettigt' | 'eiweiss' | 'salz')[] = []
  if (n.fettG === 0) l.push('fett')
  if (n.fettGesaettigtG === 0) l.push('gesaettigt')
  if (n.eiweissG === 0) l.push('eiweiss')
  if (n.salzG === 0) l.push('salz')
  return l
}

/** Angabe für das physische Etikett: „E = 83 kcal“ (je 100 ml). */
export function etikettEnergie(kcal: number | null | undefined): string | null {
  return kcal == null ? null : `E = ${kcal} kcal`
}
