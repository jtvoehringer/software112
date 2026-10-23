// ── Herkunft laut Bewegungsjournal (KAN-192 Etappe B, Entscheidung Jörgen 03.10.2026) ──
//
// Die Sicht charge_herkunft (Migration kan192a) liefert je Journalbeleg die Kanten Quell-Charge → Ziel-Charge bzw.
// Füllung (Liter anteilig) und die Wurzeln ohne Quell-Charge (Ernte, Zukauf, Eröffnung, Inventur-Mehrmenge).
// Gegenbuchungen stehen dort mit negativem Vorzeichen – verdichtet je Gegenstelle bleibt die Nettomenge.
//
// Etappe B zeigt diese Herkunft auf der Charge an und gleicht sie mit der Mischungsrechnung (KAN-76, Lader
// blendKomposition.ts) ab: Zugänge je Quell-Charge ab Journalbeginn. Der Lader der Mischungsrechnung bleibt
// unverändert (Umstellung erst 2027, wenn Gebeshuber echte Journaldaten hat und der Abgleich stabil ist).
// Reine Funktionen (node:test); der Lader steht in kellerbuch/weinausbau/[id]/HerkunftJournalKarte.tsx.

import type { Ereignis } from '@/lib/wein/mischungsrechnung'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
/** Eine Zeile der Sicht charge_herkunft */
export type HerkunftZeile = {
  beleg_nr: number
  datum: string
  art: string
  nach_weinausbau_id: string | null
  nach_fuellung_id: string | null
  von_weinausbau_id: string | null
  liter: number | string
  gegenbuchung: boolean
}

/** Verdichtete Kante (Vorgänger, Nachfolger oder Wurzel) */
export type HerkunftKante = {
  /** Gegenstelle: Charge bzw. Füllung; Wurzeln: null */
  chargeId: string | null
  fuellungId: string | null
  /** Buchungsarten der Kante (z. B. UMZUG, VS_ZU, FUELLUNG, ERNTE) */
  arten: string[]
  liter: number
  erstes: string
  letztes: string
  belege: number
}

export type HerkunftVerdichtet = { vorgaenger: HerkunftKante[]; nachfolger: HerkunftKante[]; wurzeln: HerkunftKante[] }

/** Abweichung Journal ↔ Mischungsrechnung bei den Zugängen aus einer Quell-Charge */
export type HerkunftAbweichung = { chargeId: string; journal: number; rechnung: number; differenz: number }

/** Toleranz für den Abgleich (Liter) */
export const HERKUNFT_TOLERANZ_LITER = 0.5

const l3 = (x: number) => rund(x, 3)
const zahl = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0 }

/** Zeilen der Sicht für eine Charge verdichten: je Gegenstelle bzw. Wurzel-Art Nettoliter, Zeitraum, Belege */
export function verdichteHerkunft(zeilen: readonly HerkunftZeile[], chargeId: string): HerkunftVerdichtet {
  type Akku = HerkunftKante & { belegSet: Set<number> }
  const gruppen = { vorgaenger: new Map<string, Akku>(), nachfolger: new Map<string, Akku>(), wurzeln: new Map<string, Akku>() }
  const add = (ziel: Map<string, Akku>, key: string, basis: Pick<HerkunftKante, 'chargeId' | 'fuellungId'>, z: HerkunftZeile) => {
    const a = ziel.get(key) ?? { ...basis, arten: [], liter: 0, erstes: z.datum, letztes: z.datum, belege: 0, belegSet: new Set<number>() }
    a.liter = l3(a.liter + zahl(z.liter))
    if (!a.arten.includes(z.art)) a.arten.push(z.art)
    if (z.datum < a.erstes) a.erstes = z.datum
    if (z.datum > a.letztes) a.letztes = z.datum
    a.belegSet.add(z.beleg_nr)
    ziel.set(key, a)
  }
  for (const z of zeilen) {
    if (z.nach_weinausbau_id === chargeId && z.von_weinausbau_id) add(gruppen.vorgaenger, z.von_weinausbau_id, { chargeId: z.von_weinausbau_id, fuellungId: null }, z)
    else if (z.nach_weinausbau_id === chargeId && !z.von_weinausbau_id) add(gruppen.wurzeln, z.art, { chargeId: null, fuellungId: null }, z)
    else if (z.von_weinausbau_id === chargeId) {
      const key = z.nach_fuellung_id ? `F:${z.nach_fuellung_id}` : `C:${z.nach_weinausbau_id}`
      add(gruppen.nachfolger, key, { chargeId: z.nach_weinausbau_id, fuellungId: z.nach_fuellung_id }, z)
    }
  }
  const fertig = (m: Map<string, Akku>) => [...m.values()]
    .filter(a => Math.abs(a.liter) >= 0.005)
    .map(({ belegSet, ...a }) => ({ ...a, belege: belegSet.size }))
    .sort((a, b) => b.liter - a.liter)
  return { vorgaenger: fertig(gruppen.vorgaenger), nachfolger: fertig(gruppen.nachfolger), wurzeln: fertig(gruppen.wurzeln) }
}

/**
 * Zugänge einer Charge je Quell-Charge laut Mischungsrechnung ab `ab` (Übertrag Umzug/Verschnitt): Anteil des Ziels
 * am Übertrag, verteilt nach den Quell-Litern – dieselbe Aufteilung wie die Sicht charge_herkunft.
 */
export function zugaengeLautRechnung(ereignisse: readonly Ereignis[], chargeId: string, ab: string): Map<string, number> {
  const aus = new Map<string, number>()
  for (const e of ereignisse) {
    if (e.art !== 'uebertrag' || (e.datum && e.datum < ab)) continue
    const ziel = e.ziele.filter(z => z.charge === chargeId).reduce((s, z) => s + z.liter, 0)
    if (ziel <= 0) continue
    const quellen = e.quellen.filter(q => q.charge !== chargeId)
    const summe = quellen.reduce((s, q) => s + q.liter, 0)
    if (summe <= 0) continue
    // UAT 23.10.2026: Produktion – das Ziel bekommt mehr als die Quellen hergeben (Wasser, Saft, Aroma). Das Journal bucht
    // je Quelle nur den Wein (ZU_PROD mit Gegencharge), das Zusatzvolumen als Ursprung ohne Quell-Charge – daher hier
    // höchstens die Quell-Liter verteilen.
    const anteil = e.grund === 'produktion' ? Math.min(ziel, summe) : ziel
    for (const q of quellen) aus.set(q.charge, l3((aus.get(q.charge) ?? 0) + anteil * q.liter / summe))
  }
  return aus
}

/** Abgleich der Vorgänger laut Journal mit den Zugängen laut Mischungsrechnung (nur Abweichungen ≥ Toleranz) */
export function vergleicheHerkunft(vorgaenger: readonly HerkunftKante[], rechnung: ReadonlyMap<string, number>): HerkunftAbweichung[] {
  const journal = new Map(vorgaenger.filter(k => k.chargeId).map(k => [k.chargeId as string, k.liter]))
  const ids = new Set([...journal.keys(), ...rechnung.keys()])
  const aus: HerkunftAbweichung[] = []
  for (const id of ids) {
    const j = journal.get(id) ?? 0
    const r = rechnung.get(id) ?? 0
    if (Math.abs(j - r) >= HERKUNFT_TOLERANZ_LITER) aus.push({ chargeId: id, journal: l3(j), rechnung: l3(r), differenz: l3(j - r) })
  }
  return aus.sort((a, b) => Math.abs(b.differenz) - Math.abs(a.differenz))
}
