// ── Umzugsformular mit Vorgabe öffnen (KAN-174 B, KAN-468 Nebenbefund 19.11.2026) ────────────────────────────
//
// Kellerbuch › Umziehen bucht aus einer Charge in beliebig viele Ziel-Gebinde (eine Buchung). Der Kellerplan kennt
// beim Ziehen nur ein Ziel – „Weiteres Ziel“ im Buchungsdialog wechselt deshalb ins Umzugsformular und nimmt Charge,
// erstes Ziel und Menge mit: Quelle = ganzer Inhalt der Charge, erste Ziel-Zeile wie im Dialog, zweite Ziel-Zeile mit
// dem Rest als Vorschlag (Gebinde noch zu wählen).
// Ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'

export type UmzugVorgabe = {
  /** Quell-Gebinde (KAN-174 B: „Umziehen“ vom Gebinde aus) */
  vonBehaelter: string | null
  /** Charge im Quell-Gebinde (bei mehreren Chargen im Gebinde) */
  chargeId: string | null
  /** erstes Ziel-Gebinde */
  zielId: string | null
  /** Liter ins erste Ziel */
  menge: number | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (x: unknown) => (typeof x === 'string' && UUID.test(x) ? x : null)

/** Vorgabe aus der Adresse (?von=&charge=&nach=&menge=) – alles Ungültige entfällt still */
export function umzugVorgabeAus(sp: Record<string, string | string[] | undefined> | null | undefined): UmzugVorgabe {
  const m = typeof sp?.menge === 'string' && /^\d{1,7}(\.\d{1,3})?$/.test(sp.menge) ? Number(sp.menge) : NaN
  return { vonBehaelter: uuid(sp?.von), chargeId: uuid(sp?.charge), zielId: uuid(sp?.nach), menge: m > 0 ? m : null }
}

/** Adresse des Umzugsformulars mit Charge, erstem Ziel und Menge (aus dem Buchungsdialog des Kellerplans) */
export function weiteresZielPfad(p: { vonBehaelter: string; chargeId: string; zielId: string; menge: number | null }): string {
  const q = new URLSearchParams({ neu: '1', von: p.vonBehaelter, charge: p.chargeId, nach: p.zielId })
  if (p.menge !== null && Number.isFinite(p.menge) && p.menge > 0) q.set('menge', String(rund(p.menge, 3)))
  return `/kellerbuch/umziehen?${q.toString()}`
}

export type VorgabeZeilen = {
  quelle: { chargeId: string; menge: string }
  ziele: { behId: string; menge: string }[]
}

/**
 * Startzustand des Formulars. Ohne erstes Ziel wie bisher: Charge des Gebindes als Quelle, eine leere Ziel-Zeile.
 * Mit erstem Ziel („Weiteres Ziel“): Quelle mit ganzem Inhalt, Ziel 1 mit der Menge aus dem Dialog (höchstens der
 * Inhalt), Ziel 2 ohne Gebinde mit dem Rest als Vorschlag.
 */
export function vorgabeZeilen(
  v: UmzugVorgabe | null | undefined,
  quellen: readonly { charge_id: string; behaelter_id: string; menge_liter: number }[],
): VorgabeZeilen {
  const q = (v?.chargeId ? quellen.find(x => x.charge_id === v.chargeId && (!v.vonBehaelter || x.behaelter_id === v.vonBehaelter)) : undefined)
    ?? (v?.vonBehaelter ? quellen.find(x => x.behaelter_id === v.vonBehaelter) : undefined)
  if (!q) return { quelle: { chargeId: '', menge: '' }, ziele: [{ behId: '', menge: '' }] }
  if (!v?.zielId || v.zielId === q.behaelter_id) return { quelle: { chargeId: q.charge_id, menge: '' }, ziele: [{ behId: '', menge: '' }] }
  const inhalt = rund(Number(q.menge_liter) || 0, 3)
  const erste = v.menge !== null ? Math.min(rund(v.menge, 3), inhalt) : null
  const rest = erste !== null ? rund(inhalt - erste, 3) : 0
  return {
    quelle: { chargeId: q.charge_id, menge: inhalt > 0 ? String(inhalt) : '' },
    ziele: [
      { behId: v.zielId, menge: erste !== null && erste > 0 ? String(erste) : '' },
      { behId: '', menge: rest > 0 ? String(rest) : '' },
    ],
  }
}
