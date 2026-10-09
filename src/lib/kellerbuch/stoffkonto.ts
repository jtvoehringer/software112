// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// ── Stoffkonto im Kellerbuch – besondere Konten (KAN-107, 07.10.2026) ───────────────────────────────────────
// R11 „besondere konten … geführt wie spritzmittelkonto“; Del. VO (EU) 2018/273, § 31 WeinG (in AP0 zu verifizieren).
// Entscheidung Jörgen 06.10.2026: Stoffe legt der Betrieb an, Einheit l oder kg. Buchungen sind append-only
// (kellermittel_buchungen): Anfangsbestand, Zugang, Verwendung (aus der Kellerbehandlung), Inventur, Storno – Menge mit
// Vorzeichen. Kontoauszug chronologisch mit laufendem Saldo; Meldung je Weinwirtschaftsjahr (01.08.–31.07.).
// Isomorph (node:test).

export type KontoArt = 'anfangsbestand' | 'zugang' | 'verwendung' | 'inventur' | 'storno'

export const KONTO_ART_LABEL: Readonly<Record<KontoArt, string>> = {
  anfangsbestand: 'Anfangsbestand',
  zugang: 'Zugang',
  verwendung: 'Verwendung',
  inventur: 'Inventur',
  storno: 'Storno',
}

export type KontoBuchung = {
  id: string
  datum: string
  art: KontoArt
  menge: number
  erstellt_am?: string | null
  lieferant?: string | null
  beleg?: string | null
  los?: string | null
  zweck?: string | null
  charge?: string | null
  behaelter?: string | null
  storno_von_id?: string | null
  notizen?: string | null
  erstellt_von_name?: string | null
}

export type AuszugZeile = KontoBuchung & { saldo: number; storniert: boolean }

const r3 = (n: number) => rund(n, 3)

/** Kontoauszug: chronologisch (Datum, dann Erfassung), laufender Saldo; stornierte Buchungen gekennzeichnet */
export function kontoauszug(buchungen: readonly KontoBuchung[]): { zeilen: AuszugZeile[]; saldo: number; warnungen: string[] } {
  const storniert = new Set(buchungen.filter(b => b.storno_von_id).map(b => b.storno_von_id as string))
  const sortiert = [...buchungen].sort((a, b) => a.datum.localeCompare(b.datum) || (a.erstellt_am ?? '').localeCompare(b.erstellt_am ?? '') || a.id.localeCompare(b.id))
  let saldo = 0
  const warnungen: string[] = []
  const zeilen = sortiert.map(b => {
    saldo = r3(saldo + b.menge)
    if (saldo < -0.0005 && !warnungen.length) warnungen.push(`Negativer Bestand ab ${b.datum.split('-').reverse().join('.')} – Zugang oder Anfangsbestand fehlt.`)
    return { ...b, saldo, storniert: storniert.has(b.id) }
  })
  return { zeilen, saldo, warnungen }
}

/** Saldo zu einem Stichtag (einschließlich) */
export function saldoBis(buchungen: readonly KontoBuchung[], stichtag: string): number {
  return r3(buchungen.filter(b => b.datum <= stichtag).reduce((s, b) => s + b.menge, 0))
}

/** Inventur: Ist-Bestand gegen Saldo → Differenzbuchung (0 = keine Buchung nötig) */
export function inventurDifferenz(istBestand: number, saldo: number): number {
  return r3(istBestand - saldo)
}

/** Menge einer neuen Buchung mit Vorzeichen; Fehler bei falscher Eingabe */
export function buchungsMenge(art: KontoArt, eingabe: number | null): { menge: number } | { fehler: string } {
  if (eingabe === null || !Number.isFinite(eingabe) || eingabe === 0) return { fehler: 'Bitte eine Menge angeben.' }
  if (art === 'anfangsbestand' || art === 'zugang') {
    return eingabe > 0 ? { menge: r3(eingabe) } : { fehler: 'Die Menge eines Zugangs muss größer als 0 sein.' }
  }
  if (art === 'verwendung') return eingabe > 0 ? { menge: r3(-eingabe) } : { fehler: 'Bitte die verwendete Menge (positiv) angeben.' }
  return { menge: r3(eingabe) }
}

/** Kellerbehandlungstyp, der einen Stoff aus dem Stoffkonto braucht (Zuckerung, RTK/KTM, Säuerung, Entsäuerung) */
export function istStoffkontoTyp(name: string | null | undefined): boolean {
  return /zucker|saccharose|anreicher|rtk|ktm|traubenmost|säuer|saeuer|entsäuer|entsaeuer/i.test(name ?? '')
}

/** Weinwirtschaftsjahr (01.08.–31.07.) zu einem Datum: { label: '2025/26', von, bis } */
export function weinwirtschaftsjahr(datum: string): { label: string; von: string; bis: string } {
  const j = Number(datum.slice(0, 4)), m = Number(datum.slice(5, 7))
  const start = m >= 8 ? j : j - 1
  return { label: `${start}/${String((start + 1) % 100).padStart(2, '0')}`, von: `${start}-08-01`, bis: `${start + 1}-07-31` }
}

/** Zeile der Meldung „besondere-konten“ (Kontoauszug je Stoff im Weinwirtschaftsjahr) */
export type BesondereKontenZeile = {
  stoff: string
  einheit: string
  datum: string
  art: string
  menge: number
  saldo: number
  lieferant: string | null
  beleg: string | null
  los: string | null
  charge: string | null
  behaelter: string | null
  zweck: string | null
  storniert: boolean
}
