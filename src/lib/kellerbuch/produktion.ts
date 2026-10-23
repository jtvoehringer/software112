// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { zahlLokal } from '../format.ts'
// KAN-118 (08.10.2026): Produktion – aus Quell-Chargen und Zutaten entsteht eine neue Charge mit eigenem Erzeugnis
// (Perlweinspritzer/Weinmischgetränk = weinhaltiges Getränk, Perlwein, Schaumwein/Sekt, PetNat). Dieselben Regeln wie die
// RPC s112_produktion_buchen – für Formular, Server Action und Tests. Isomorph und ohne '@/'-Importe (node:test).

export type ProduktionArt = 'spritzer' | 'mischgetraenk' | 'perlwein' | 'schaumwein' | 'petnat'
export type ZutatArt = 'wasser' | 'saft' | 'aroma' | 'co2' | 'zucker' | 'hefe' | 'sonstiges'
export type Einheit = 'l' | 'kg' | 'g'

export const PRODUKTION_ARTEN: readonly ProduktionArt[] = ['spritzer', 'mischgetraenk', 'perlwein', 'schaumwein', 'petnat']

export const PRODUKTION_ART_LABEL: Record<ProduktionArt, string> = {
  spritzer: 'Perlweinspritzer / Spritzer',
  mischgetraenk: 'Weinmischgetränk',
  perlwein: 'Perlwein',
  schaumwein: 'Schaumwein / Sekt',
  petnat: 'PetNat',
}

export const PRODUKTION_ZUTAT_LABEL: Record<string, string> = {
  wasser: 'Wasser', saft: 'Saft', aroma: 'Aroma', co2: 'Kohlensäure (CO₂)', zucker: 'Zucker', hefe: 'Hefe', sonstiges: 'Sonstiges',
}

/** Zutaten, die das Volumen erhöhen (nur Spritzer und Weinmischgetränk) */
export const VOLUMEN_ZUTATEN: readonly ZutatArt[] = ['wasser', 'saft', 'aroma']

/** Erlaubte Erzeugnisse je Art (erstes = Vorschlag) – wie die RPC */
export const ERZEUGNIS_JE_ART: Record<ProduktionArt, readonly string[]> = {
  spritzer: ['WEINHALT'],
  mischgetraenk: ['WEINHALT'],
  perlwein: ['PERLWEIN'],
  schaumwein: ['SCHAUMW', 'SEKTGU'],
  petnat: ['PETNAT'],
}

/** Zutaten, die je Art erlaubt sind */
export function zutatenFuer(art: ProduktionArt): ZutatArt[] {
  const alle: ZutatArt[] = ['wasser', 'saft', 'aroma', 'co2', 'zucker', 'hefe', 'sonstiges']
  return alle.filter(z => (VOLUMEN_ZUTATEN.includes(z) ? art === 'spritzer' || art === 'mischgetraenk' : true) && !(z === 'co2' && art === 'petnat'))
}

export type WeinEingang = { weinausbauId: string; menge: number; bestand: number; weinart?: string | null; name?: string | null }
export type ZutatEingang = { art: ZutatArt; menge: number; einheit: Einheit; kellermittelId?: string | null; bezeichnung?: string | null }

/** Weinanteil in Prozent (eine Nachkommastelle) */
export function weinanteil(weinLiter: number, zusatzLiter: number): number {
  const gesamt = weinLiter + zusatzLiter
  return gesamt > 0 ? rund((100 * weinLiter) / gesamt, 1) : 0
}

/** Menge der neuen Charge: Wein plus Volumen-Zutaten (Liter) */
export function zielMenge(wein: readonly WeinEingang[], zutaten: readonly ZutatEingang[]): { wein: number; zusatz: number; ziel: number } {
  const w = rund(wein.reduce((s, x) => s + x.menge, 0), 2)
  const z = rund(zutaten.filter(x => VOLUMEN_ZUTATEN.includes(x.art)).reduce((s, x) => s + x.menge, 0), 2)
  return { wein: w, zusatz: z, ziel: rund((w + z), 2) }
}

/** Schritte des Assistenten (KAN-119): 1 = Art, Erzeugnis, Datum · 2 = Eingänge · 3 = neue Charge und Gebinde */
export type ProduktionSchritt = 1 | 2 | 3
export const PRODUKTION_SCHRITTE: Record<ProduktionSchritt, string> = { 1: 'Art', 2: 'Eingänge', 3: 'Neue Charge' }

/** Ziel-Gebinde der neuen Charge (Name und Fassungsvermögen in Litern; null/0 = unbekannt) */
export type ZielGebinde = { name: string; volumen: number | null }

const liter = (n: number) => `${zahlLokal(n, { maximumFractionDigits: 2 })} l`

/**
 * UAT 23.10.2026 (Musterhof): 1.100 l Schaumwein in „Barrique 3“ (225 l) wurden ohne Warnung angenommen. Die neue Charge
 * darf ihr Gebinde nicht überfüllen. Das Ziel-Gebinde ist immer leer (Auswahl nur leerer Gebinde, RPC: behaelter_nutzbar),
 * daher zählt das ganze Fassungsvermögen. Volumen unbekannt (null/0) → keine Sperre.
 */
export function gebindeFehler(zielLiter: number, gebinde: ZielGebinde | null | undefined): string | null {
  const vol = Number(gebinde?.volumen) || 0
  if (!gebinde || vol <= 0) return null
  if (zielLiter > vol + 0.005) {
    return `Die neue Charge (${liter(zielLiter)}) passt nicht in „${gebinde.name}“ (Fassungsvermögen ${liter(vol)}).`
  }
  return null
}

/** Prüfung wie die RPC (Meldungen auf Deutsch); [] = in Ordnung. Mit `schritt` nur die Prüfungen dieses Assistenten-Schritts.
 *  `gebinde` = gewähltes Ziel-Gebinde (Fassungsvermögen, Schritt 3 bzw. Gesamtprüfung). */
export function produktionFehler(p: {
  art: ProduktionArt; erzeugnis?: string | null; name: string; behaelterId: string; datum: string; heute: string
  wein: readonly WeinEingang[]; zutaten: readonly ZutatEingang[]; gebinde?: ZielGebinde | null
}, schritt?: ProduktionSchritt): string[] {
  const f: string[] = []
  if (!schritt || schritt === 1) {
    if (!PRODUKTION_ARTEN.includes(p.art)) f.push('Bitte die Art der Produktion wählen.')
    if (p.erzeugnis && !(ERZEUGNIS_JE_ART[p.art] ?? []).includes(p.erzeugnis)) f.push('Das Erzeugnis passt nicht zur Art der Produktion.')
    if (!p.datum) f.push('Bitte ein Datum angeben.')
    else if (p.datum > p.heute) f.push('Das Datum der Produktion liegt in der Zukunft.')
  }
  if (!schritt || schritt === 3) {
    if (!p.name.trim() || !p.behaelterId) f.push('Bitte Name und Gebinde der neuen Charge angeben.')
    else {
      const g = gebindeFehler(zielMenge(p.wein, p.zutaten).ziel, p.gebinde)
      if (g) f.push(g)
    }
  }
  if (schritt && schritt !== 2) return [...new Set(f)]
  if (p.wein.length === 0) f.push('Bitte mindestens eine Quell-Charge angeben.')
  const ids = new Set<string>()
  for (const w of p.wein) {
    if (ids.has(w.weinausbauId)) f.push('Eine Quell-Charge ist doppelt angegeben.')
    ids.add(w.weinausbauId)
    if (!(w.menge >= 0.01)) f.push('Die Weinmenge je Quelle muss mindestens 0,01 L sein.')
    else if (w.menge > w.bestand + 0.005) f.push(`Aus „${w.name ?? 'Charge'}“ sollen mehr Liter verwendet werden, als im Bestand sind.`)
  }
  const weinarten = new Set(p.wein.map(w => w.weinart).filter(a => a && a !== 'unbekannt'))
  if (weinarten.size > 1) f.push('Die Quell-Chargen haben unterschiedliche Weinarten – eine Produktion mischt nur gleiche Weinarten.')
  const erlaubt = zutatenFuer(p.art)
  for (const z of p.zutaten) {
    if (!erlaubt.includes(z.art)) {
      f.push(z.art === 'co2' ? 'PetNat entsteht ohne Zusatz von Kohlensäure.' : 'Wasser, Saft oder Aroma gibt es nur bei Spritzer und Weinmischgetränk.')
    }
    if (!(z.menge > 0)) f.push(`Bitte eine Menge für „${PRODUKTION_ZUTAT_LABEL[z.art]}“ angeben.`)
    if (VOLUMEN_ZUTATEN.includes(z.art) && z.einheit !== 'l') f.push('Wasser, Saft und Aroma bitte in Litern angeben.')
  }
  const m = zielMenge(p.wein, p.zutaten)
  if ((p.art === 'spritzer' || p.art === 'mischgetraenk') && m.wein * 2 < m.ziel - 0.005) {
    f.push(`Ein weinhaltiges Getränk braucht mindestens 50 % Wein – hier sind es ${weinanteil(m.wein, m.zusatz).toLocaleString('de-DE')} %.`)
  }
  return [...new Set(f)]
}

/** Eingänge für die RPC s112_produktion_buchen */
export function produktionEingaenge(wein: readonly WeinEingang[], zutaten: readonly ZutatEingang[]): Record<string, unknown>[] {
  return [
    ...wein.map(w => ({ art: 'wein', weinausbau_id: w.weinausbauId, menge: w.menge })),
    ...zutaten.map(z => ({ art: z.art, menge: z.menge, einheit: z.einheit, kellermittel_id: z.kellermittelId || null, bezeichnung: z.bezeichnung || null })),
  ]
}
