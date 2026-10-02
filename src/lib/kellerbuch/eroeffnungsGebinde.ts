// ── Gebindestand für den Import „Eröffnungsbestand Tank“ (KAN-42 Etappe 1, 02.10.2026) ─────────────────
//
// Je Gebinde (eigene + freigegebene, lade_behaelter) die eigenen Liter heute und am Ende des Stichtags. Der
// Stichtagsbestand kommt aus derselben Rückrechnung wie die Weinbestandsmeldung (KAN-43, bestandAmStichtag über die
// Bewegungen des Betriebs): Bestand heute − Buchungen nach dem Stichtag, vor dem Beginn einer Charge 0. Fremd belegte
// Gebinde (Kellergemeinschaft) meldet `fremdBelegt` wie ladeBehaelter alsZiel.
//
// Nur lesend; Mandant über ladeBehaelter/ladeBewegungenBetrieb (beide mit tenant_id).

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Client nach Projektkonvention */
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { ladeBewegungenBetrieb } from '@/lib/behoerden/bewegungsbuch'
import { bestandAmStichtag, fruehesterTag, type MengenBuchung } from '@/lib/behoerden/bestandZum'
import { tag } from '@/lib/behoerden/kellerbuch-hilfen'
import { STELLEN } from '@/lib/csv'
import type { GebindeStand } from '@/lib/import/eroeffnungsbestand'

type R = Record<string, any>

const zahl = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Liter je Gebinde am Stichtag aus Chargen und Bewegungen (rein, für Tests exportiert) */
export function literJeGebindeAmStichtag(
  chargen: readonly R[],
  bewegungen: readonly { chargeId: string | null; datum: string; menge: number }[],
  stichtag: string,
): { heute: Map<string, number>; amStichtag: Map<string, number> } {
  const buchungen = new Map<string, MengenBuchung[]>()
  const ersterTag = new Map<string, string>()
  for (const b of bewegungen) {
    if (!b.chargeId || b.menge === 0) continue
    buchungen.set(b.chargeId, [...(buchungen.get(b.chargeId) ?? []), { datum: b.datum, menge: b.menge }])
    const e = ersterTag.get(b.chargeId)
    if (b.datum && (!e || b.datum < e)) ersterTag.set(b.chargeId, b.datum)
  }
  const heute = new Map<string, number>()
  const amStichtag = new Map<string, number>()
  for (const c of chargen) {
    if (!c.behaelter_id) continue
    const heuteLiter = c.aktiv && c.status !== 'abgeschlossen' ? zahl(c.menge_liter) : 0
    const r = bestandAmStichtag(heuteLiter, buchungen.get(c.id) ?? [], stichtag, fruehesterTag(ersterTag.get(c.id), tag(c.created_at) || null), STELLEN.liter)
    heute.set(c.behaelter_id, (heute.get(c.behaelter_id) ?? 0) + heuteLiter)
    if (r.bestand > 0) amStichtag.set(c.behaelter_id, (amStichtag.get(c.behaelter_id) ?? 0) + r.bestand)
  }
  return { heute, amStichtag }
}

/** Gebinde des Betriebs mit Inhalt heute und am Stichtag */
export async function ladeGebindeStand(supabase: any, tenantId: string, stichtag: string): Promise<GebindeStand[]> {
  const [gebinde, betrieb] = await Promise.all([
    ladeBehaelter(supabase, tenantId),
    ladeBewegungenBetrieb(supabase, tenantId),
  ])
  const { heute, amStichtag } = literJeGebindeAmStichtag(betrieb.chargen, betrieb.bewegungen, stichtag)
  return gebinde.map(g => ({
    id: g.id,
    name: g.name,
    anzeigeName: g.anzeigeName,
    volumen: g.volumen_liter,
    aktiv: g.aktiv,
    fremdBelegt: g.gesperrt ? (g.fremd_betrieb ?? 'einen anderen Betrieb') : null,
    literHeute: Math.max(heute.get(g.id) ?? 0, g.eigen_liter),
    literAmStichtag: amStichtag.get(g.id) ?? 0,
  }))
}
