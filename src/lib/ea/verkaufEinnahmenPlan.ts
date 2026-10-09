// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// E&A-Einnahmen aus Verkaufszahlungen je Zahlung planen (KAN-149 D2b, 30.09.2026). Isomorph und ohne Datenbank –
// die Ausführung (Gegenbuchung per RPC, Anlegen per Service-Role) steht in verkaufEinnahmen.ts.
//
// Regeln (Ticket Soll 5):
//  - Jede gültige (nicht stornierte) Zahlung erzeugt eigene Einnahmen je USt-Satz, anteilig und am Zahlungstag.
//    Anteile kumuliert: Zahlung k bekommt round(netto × min(Σ bis k, brutto) / brutto) − dasselbe bis k−1, so geht
//    der Rundungsrest auf die letzte Zahlung und die Summe aller Zahlungen ist exakt die der Gesamtquote.
//  - Kein Neuaufbau: Stimmt der Bestand einer Zahlung (je Satz), bleibt er; weicht er ab, wird er gegengebucht und
//    neu gebucht. Einnahmen einer stornierten Zahlung bucht s112_zahlung_stornieren schon beim Storno gegen.
//  - Alt-Einnahmen ohne zahlung_id (Sync bis D2, nur Sandbox/Musterhof): einmalig gegenbuchen und je Zahlung neu
//    buchen. Ist eine davon gesperrt (übermittelte UVA), bleibt alles unverändert (wie bisher) – `gesperrt`.
//  - Der Verkaufsstorno lässt die Einnahmen stehen (Geld ist eingegangen); erst der Storno der Zahlung (Erstattung)
//    bucht sie gegen.

export type PlanZahlung = { id: string; betrag: number; datum: string; erstelltAm?: string | null }
export type PlanPosition = { preis_brutto: number | null; menge: number; rabatt_pct?: number | null; sonderrabatt_pct?: number | null; ust_satz?: number | null }
export type PlanEinnahme = {
  id: string
  zahlung_id: string | null
  betrag_netto: number
  ust_satz: number
  is_locked: boolean
  import_quelle: string
  storniert_am: string | null
  storno_von_id: string | null
}
export type NeueEinnahme = { zahlung_id: string; datum: string; betrag_netto: number; ust_satz: number }
export type EinnahmenPlan = {
  /** Alt-Einnahme gesperrt – nichts ändern */
  gesperrt: boolean
  /** gegenzubuchende Einnahmen (ids) */
  stornieren: string[]
  anlegen: NeueEinnahme[]
}

const cent = (x: number) => rund(x, 2)

/** Rechnungssumme je USt-Satz (brutto/netto) – wie der Rechnungsdruck */
export function gruppenJeSatz(positionen: readonly PlanPosition[]): Map<number, { brutto: number; netto: number }> {
  const g = new Map<number, { brutto: number; netto: number }>()
  for (const p of positionen) {
    if (p.preis_brutto == null) continue
    const satz = Number(p.ust_satz ?? 13)
    const effektiv = Number(p.preis_brutto) * Number(p.menge) * (1 - Number(p.rabatt_pct ?? 0) / 100) * (1 - Number(p.sonderrabatt_pct ?? 0) / 100)
    const e = g.get(satz) ?? { brutto: 0, netto: 0 }
    e.brutto += effektiv
    e.netto += effektiv / (1 + satz / 100)
    g.set(satz, e)
  }
  return g
}

/** Soll je Zahlung und Satz (Netto, gerundet) – Zahlungen in Reihenfolge Datum, Erfassung, id */
export function sollJeZahlung(positionen: readonly PlanPosition[], zahlungen: readonly PlanZahlung[]): NeueEinnahme[] {
  const gruppen = gruppenJeSatz(positionen)
  const brutto = [...gruppen.values()].reduce((s, g) => s + g.brutto, 0)
  if (brutto <= 0) return []
  const reihe = [...zahlungen].sort((a, b) =>
    a.datum.localeCompare(b.datum) || String(a.erstelltAm ?? '').localeCompare(String(b.erstelltAm ?? '')) || a.id.localeCompare(b.id))
  const erg: NeueEinnahme[] = []
  let summeVorher = 0
  for (const z of reihe) {
    const summeNachher = summeVorher + Number(z.betrag || 0)
    const qVorher = Math.min(summeVorher, brutto) / brutto
    const qNachher = Math.min(summeNachher, brutto) / brutto
    for (const [satz, g] of gruppen) {
      const anteil = cent(cent(g.netto * qNachher) - cent(g.netto * qVorher))
      if (anteil > 0) erg.push({ zahlung_id: z.id, datum: z.datum, betrag_netto: anteil, ust_satz: satz })
    }
    summeVorher = summeNachher
  }
  return erg
}

/** Abgleich Soll (je gültiger Zahlung) ↔ Bestand – was gegenbuchen, was anlegen */
export function planeVerkaufsEinnahmen(
  positionen: readonly PlanPosition[],
  gueltigeZahlungen: readonly PlanZahlung[],
  bestehende: readonly PlanEinnahme[],
): EinnahmenPlan {
  const aktiv = bestehende.filter(e => e.import_quelle === 'verkauf' && !e.storniert_am && !e.storno_von_id)
  const alt = aktiv.filter(e => !e.zahlung_id)
  if (alt.some(e => e.is_locked)) return { gesperrt: true, stornieren: [], anlegen: [] }

  const soll = sollJeZahlung(positionen, gueltigeZahlungen)
  const stornieren = alt.map(e => e.id)
  const anlegen: NeueEinnahme[] = []
  const gueltig = new Set(gueltigeZahlungen.map(z => z.id))
  const schluessel = (xs: { betrag_netto: number; ust_satz: number }[]) =>
    xs.map(x => `${Number(x.ust_satz)}:${cent(Number(x.betrag_netto)).toFixed(2)}`).sort().join('|')

  for (const z of gueltigeZahlungen) {
    const sollZ = soll.filter(s => s.zahlung_id === z.id)
    const istZ = aktiv.filter(e => e.zahlung_id === z.id)
    if (schluessel(sollZ) === schluessel(istZ)) continue
    stornieren.push(...istZ.map(e => e.id))
    anlegen.push(...sollZ)
  }
  // Einnahmen zu Zahlungen, die es nicht (mehr) gültig gibt – sonst bucht der Storno der Zahlung sie gegen
  for (const e of aktiv) if (e.zahlung_id && !gueltig.has(e.zahlung_id) && !stornieren.includes(e.id)) stornieren.push(e.id)
  return { gesperrt: false, stornieren, anlegen }
}
