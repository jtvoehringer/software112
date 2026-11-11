// ── Sammelmaßnahme im Kellerbuch (KAN-413, 11.11.2026) ───────────────────────────────────────────────────────────────
//
// Dieselbe Kellerbehandlung (z. B. Schwefel) für mehrere Gebinde auf einmal. Je Charge entsteht eine eigene
// Behandlungszeile (Weinbuch und Kellerbuch bleiben wie bei Einzelbehandlungen), verbunden über
// keller_behandlungen.sammel_id. Die Menge wird entweder als Gesamtmenge erfasst und nach Litern aufgeteilt oder als
// Dosis je hl (Menge je Charge = Dosis × Liter / 100). Der verwendete Stoff (Stoffkonto) wird immer nach Litern
// aufgeteilt. Gespeichert wird über die RPC s112_kellerbehandlung_sammel in einer Transaktion: alles oder nichts.
// Gemeinsam für Formular (Vorschau) und Server Action – isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'

/** Nachkommastellen der aufgeteilten Mengen (wie Liter und kg im Kellerbuch) */
export const SAMMEL_STELLEN = 3
/** Obergrenze je Sammelmaßnahme – schützt Formular und RPC vor versehentlich riesigen Listen */
export const SAMMEL_MAX = 200

export type SammelModus = 'gesamt' | 'dosis'

export function istSammelModus(x: unknown): x is SammelModus {
  return x === 'gesamt' || x === 'dosis'
}

/**
 * Gesamtmenge nach Litern aufteilen. Jeder Anteil ist auf `stellen` gerundet; der Rundungsrest geht auf die größte
 * Charge (bei gleich großen die erste), damit die Summe exakt die Gesamtmenge ergibt.
 * Ohne Liter (Summe 0) oder ohne Gesamtmenge: lauter Nullen.
 */
export function verteileNachLitern(gesamt: number, liter: number[], stellen: number = SAMMEL_STELLEN): number[] {
  const l = liter.map(x => (Number.isFinite(x) && x > 0 ? x : 0))
  const summe = l.reduce((s, x) => s + x, 0)
  if (!(summe > 0) || !Number.isFinite(gesamt) || gesamt === 0) return l.map(() => 0)
  const anteile = l.map(x => rund((gesamt * x) / summe, stellen))
  const rest = rund(rund(gesamt, stellen) - anteile.reduce((s, x) => s + x, 0), stellen)
  if (rest !== 0) {
    let groesste = 0
    for (let i = 1; i < l.length; i++) if (l[i] > l[groesste]) groesste = i
    anteile[groesste] = rund(anteile[groesste] + rest, stellen)
  }
  return anteile
}

/** Dosis je hl → Menge je Charge (Dosis × Liter / 100), auf `stellen` gerundet */
export function mengenAusDosis(dosisJeHl: number, liter: number[], stellen: number = SAMMEL_STELLEN): number[] {
  return liter.map(x => (Number.isFinite(x) && x > 0 && Number.isFinite(dosisJeHl) ? rund((dosisJeHl * x) / 100, stellen) : 0))
}

export type SammelCharge = { chargeId: string; behaelterId: string; liter: number }

export type SammelZeile = SammelCharge & {
  /** Menge der Behandlung für diese Charge (null bei Einheit „-“) */
  menge: number | null
  /** Anteil des verwendeten Stoffs (Stoffkonto), null ohne Stoff */
  stoffMenge: number | null
}

/**
 * Zeilen der Sammelmaßnahme: Menge je Charge nach Modus, Stoff anteilig nach Litern.
 * `menge` = Gesamtmenge (Modus gesamt) bzw. Dosis je hl (Modus dosis); null = Behandlung ohne Mengenangabe.
 */
export function sammelZeilen(p: {
  chargen: SammelCharge[]
  modus: SammelModus
  menge: number | null
  stoffGesamt: number | null
}): SammelZeile[] {
  const liter = p.chargen.map(c => c.liter)
  const mengen = p.menge == null
    ? null
    : p.modus === 'dosis' ? mengenAusDosis(p.menge, liter) : verteileNachLitern(p.menge, liter)
  const stoff = p.stoffGesamt == null ? null : verteileNachLitern(p.stoffGesamt, liter)
  return p.chargen.map((c, i) => ({ ...c, menge: mengen ? mengen[i] : null, stoffMenge: stoff ? stoff[i] : null }))
}

/** Summe einer Spalte der Zeilen, gerundet */
export function sammelSumme(zeilen: SammelZeile[], feld: 'menge' | 'stoffMenge' | 'liter'): number {
  return rund(zeilen.reduce((s, z) => s + (Number(z[feld]) || 0), 0), SAMMEL_STELLEN)
}

/**
 * Prüfung der Eingabe; null = in Ordnung. `einheit` „-“ = Behandlung ohne Mengenangabe.
 * Eine Charge ohne Liter kann keinen Anteil bekommen und wird abgelehnt.
 */
export function sammelFehler(p: {
  chargen: SammelCharge[]
  modus: unknown
  menge: number | null
  einheit: string | null
  stoffId: string | null
  stoffGesamt: number | null
}): string | null {
  if (p.chargen.length < 2) return 'Bitte mindestens zwei Gebinde wählen – für ein einzelnes Gebinde die Behandlung direkt am Gebinde erfassen.'
  if (p.chargen.length > SAMMEL_MAX) return `Eine Sammelmaßnahme umfasst höchstens ${SAMMEL_MAX} Chargen.`
  if (new Set(p.chargen.map(c => c.chargeId)).size !== p.chargen.length) return 'Eine Charge ist doppelt gewählt.'
  if (p.chargen.some(c => !Number.isFinite(c.liter) || !(c.liter > 0))) return 'Eine gewählte Charge hat keine Menge (0 L) – sie kann keinen Anteil bekommen.'
  if (!istSammelModus(p.modus)) return 'Bitte wählen, ob die Menge als Gesamtmenge oder als Dosis je hl gilt.'
  if (p.einheit !== '-') {
    if (p.menge == null || !Number.isFinite(p.menge)) return 'Bitte die Menge angeben (bei Behandlungen ohne Mengenangabe die Einheit „-“ wählen).'
    if (!(p.menge > 0)) return 'Die Menge muss größer als 0 sein.'
    const mengen = p.modus === 'dosis' ? mengenAusDosis(p.menge, p.chargen.map(c => c.liter)) : verteileNachLitern(p.menge, p.chargen.map(c => c.liter))
    if (mengen.some(m => !(m > 0))) return 'Die Menge ist zu klein: Für mindestens ein Gebinde ergibt sich ein Anteil von 0 – bitte eine kleinere Einheit wählen (z. B. g statt kg).'
  }
  if (p.stoffId) {
    if (p.stoffGesamt == null || !Number.isFinite(p.stoffGesamt) || !(p.stoffGesamt > 0)) return 'Bitte die insgesamt verwendete Menge des Stoffs angeben.'
    if (verteileNachLitern(p.stoffGesamt, p.chargen.map(c => c.liter)).some(m => !(m > 0))) {
      return 'Die Stoffmenge ist zu klein: Für mindestens ein Gebinde ergibt sich ein Anteil von 0.'
    }
  }
  return null
}

/** Kennzeichnung in Listen: „Sammelmaßnahme (3 Gebinde)“ */
export function sammelText(anzahl: number): string {
  return `Sammelmaßnahme (${anzahl} Gebinde)`
}
