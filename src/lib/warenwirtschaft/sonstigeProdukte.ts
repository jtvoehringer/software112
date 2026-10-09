// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// Sonstige Produkte mit Lagerstand – KAN-115 (07.10.2026)
//
// Traubensaft, Essig und Destillat sind kein Wein (§ 1 Abs. 1 Z 1 WeinG, R10 der BKI-Sitzung 24.09.2026): sie entstehen
// über „Verarbeiten“ aus einer Charge (Abgang AB_VERAR im Kellerbuch) und werden als Sonstiges Produkt mit eigenem
// Lagerstand geführt – außerhalb von Weinbuch und Bestandsmeldung. Bewegungen schreibt nur die Datenbank (RPCs
// s112_artikel_buchen, s112_artikel_verkauf_buchen, s112_verarbeitung_buchen …); hier stehen Auswahl, Vorschläge und
// der Kontoauszug, gemeinsam für Formular und Server Action. Isomorph, ohne '@/'-Importe (node:test).

export const PRODUKT_ARTEN = [
  { value: 'traubensaft', label: 'Traubensaft' },
  { value: 'essig', label: 'Essig' },
  { value: 'destillat', label: 'Destillat / Brand' },
  { value: 'sonstiges', label: 'Sonstiges' },
] as const
export type ProduktArt = (typeof PRODUKT_ARTEN)[number]['value']

export const PRODUKT_ART_LABEL: Record<ProduktArt, string> = Object.fromEntries(PRODUKT_ARTEN.map(a => [a.value, a.label])) as Record<ProduktArt, string>

export function istProduktArt(x: unknown): x is ProduktArt {
  return PRODUKT_ARTEN.some(a => a.value === x)
}

/** Zweck der Verarbeitung (keller_verarbeitungen.zweck) → passende Produktart */
export const ZWECK_ZU_ART: Record<string, ProduktArt> = {
  traubensaft: 'traubensaft',
  essig: 'essig',
  brennerei: 'destillat',
  sonstiges: 'sonstiges',
}

export const BEWEGUNG_ART_LABEL: Record<string, string> = {
  anfangsbestand: 'Anfangsbestand',
  zugang: 'Zugang',
  verarbeitung: 'Aus Verarbeitung',
  verkauf: 'Verkauf',
  inventur: 'Inventur',
  storno: 'Storno',
}

/** Vorschlag für die erzeugte Stückzahl: Liter ÷ Liter je Stück, abgerundet auf ganze Stück; ohne Angabe null */
export function stueckVorschlag(liter: number | null, literJeStk: number | string | null | undefined): number | null {
  const l = literJeStk == null || literJeStk === '' ? NaN : Number(literJeStk)
  if (liter == null || !Number.isFinite(liter) || liter <= 0 || !Number.isFinite(l) || l <= 0) return null
  return Math.floor(liter / l + 1e-9)
}

export interface ProduktBewegung {
  id: string
  datum: string
  art: string
  menge: number | string
  storno_von_id?: string | null
  erstellt_am?: string | null
}

export interface KontoZeile<B extends ProduktBewegung = ProduktBewegung> {
  bewegung: B
  menge: number
  saldo: number
  /** wurde später storniert */
  storniert: boolean
}

const runden3 = (x: number) => rund(x, 3)

/** Lagerstand = Summe aller Bewegungen (Storno-Gegenbuchungen eingeschlossen) */
export function lagerstand(bewegungen: ProduktBewegung[]): number {
  return runden3(bewegungen.reduce((s, b) => s + (Number(b.menge) || 0), 0))
}

/** Kontoauszug chronologisch mit laufendem Saldo; stornierte Buchungen gekennzeichnet */
export function produktKonto<B extends ProduktBewegung>(bewegungen: B[]): { zeilen: KontoZeile<B>[]; saldo: number } {
  const storniert = new Set(bewegungen.map(b => b.storno_von_id).filter(Boolean) as string[])
  const sortiert = [...bewegungen].sort((a, b) =>
    a.datum.localeCompare(b.datum) || String(a.erstellt_am ?? '').localeCompare(String(b.erstellt_am ?? '')) || a.id.localeCompare(b.id))
  let saldo = 0
  const zeilen = sortiert.map(b => {
    const menge = Number(b.menge) || 0
    saldo = runden3(saldo + menge)
    return { bewegung: b, menge, saldo, storniert: storniert.has(b.id) }
  })
  return { zeilen, saldo }
}

/**
 * Prüfung vor dem Buchen (dieselbe Regel wie s112_artikel_buchen): Art Anfangsbestand/Zugang/Inventur, Menge > 0 bzw.
 * bei Inventur der gezählte Bestand ≥ 0 und ungleich dem Lagerstand, Datum gültig und nicht in der Zukunft.
 */
export function produktBuchungFehler(p: { art: unknown; menge: number | null; datum: string; heute: string; bestand: number }): string | null {
  if (p.art !== 'anfangsbestand' && p.art !== 'zugang' && p.art !== 'inventur') return 'Bitte die Art der Buchung wählen.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.datum)) return 'Bitte ein gültiges Datum angeben.'
  if (p.datum > p.heute) return 'Das Datum liegt in der Zukunft.'
  if (p.menge == null || !Number.isFinite(p.menge)) return p.art === 'inventur' ? 'Bitte den gezählten Bestand angeben.' : 'Bitte die Menge angeben.'
  if (p.art === 'inventur') {
    if (p.menge < 0) return 'Der gezählte Bestand kann nicht negativ sein.'
    if (runden3(p.menge) === runden3(p.bestand)) return 'Der gezählte Bestand stimmt mit dem Lagerstand überein – keine Differenz zu buchen.'
    return null
  }
  return p.menge > 0 ? null : 'Die Menge muss größer als 0 sein.'
}

/**
 * Verkauf: Positionen „Sonstiges“ mit Produkt und Lagerstand – Menge > 0 und über alle Positionen je Produkt höchstens der
 * Lagerstand (dieselbe Regel wie s112_artikel_verkauf_buchen). null = in Ordnung, sonst die erste Meldung.
 */
export function sonstigeLagerFehler(
  positionen: { typ?: string; name?: string; menge?: number | string; sonstige_artikel_id?: string | null }[],
  artikel: { id: string; name: string; einheit: string; bestand_fuehren: boolean }[],
  bewegungen: { artikel_id: string; menge: number | string }[],
): string | null {
  const jeId = new Map(artikel.map(a => [a.id, a]))
  const summe = new Map<string, number>()
  for (const p of positionen) {
    if (p.typ !== 'sonstiges' || !p.sonstige_artikel_id) continue
    const a = jeId.get(p.sonstige_artikel_id)
    if (!a?.bestand_fuehren) continue
    const m = Number(p.menge)
    if (!(m > 0)) return `„${a.name}“: Die Menge muss größer als 0 sein – das Produkt führt Lagerstand (Rücknahmen als Storno des Verkaufs).`
    summe.set(a.id, runden3((summe.get(a.id) ?? 0) + m))
  }
  for (const [id, m] of summe) {
    const a = jeId.get(id)!
    const bestand = lagerstand(bewegungen.filter(b => b.artikel_id === id).map((b, i) => ({ id: String(i), datum: '', art: '', menge: b.menge })))
    if (m > bestand + 0.0005) {
      const z = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 3 })
      return `Nicht genug „${a.name}“ auf Lager: verkauft ${z(m)} ${a.einheit}, Lagerstand ${z(bestand)} ${a.einheit}.`
    }
  }
  return null
}
