// ── Morgenbericht: Lauf über alle aktiven Betriebe (Cron) ────────────────────
// Wird vom täglichen Cron (/api/cron/taeglich, 05:00 UTC) und vom manuellen
// System-Admin-Aufruf (/api/cron/morgenbericht) genutzt. Betriebe nacheinander;
// ist das Zeitbudget erschöpft, werden die restlichen übersprungen.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { erstelleMorgenbericht } from './erstellen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type LaufErgebnis = { tenant: string; befunde?: number; hoch?: number; dauerMs?: number; fehler?: string; uebersprungen?: string }

export async function laufMorgenberichte(budgetMs: number): Promise<{ betriebe: number; dauerMs: number; ergebnis: LaufErgebnis[] }> {
  const start = Date.now()
  const admin = createSupabaseAdminClient()
  // tenant-isolation-ignore: Cron über alle aktiven Betriebe, Verarbeitung je Betrieb in erstelleMorgenbericht
  const { data: tenants } = await (admin.from('tenants') as any).select('id, name, stripe_plan, active').eq('active', true).order('created_at')
  // tenant-isolation-ignore: Einstellungen aller Betriebe (nur Schalter morgenbericht_aktiv)
  const { data: einstRaw } = await (admin.from('tenant_einstellungen') as any).select('tenant_id, morgenbericht_aktiv')
  const aktiv = new Map(((einstRaw ?? []) as R[]).map(e => [e.tenant_id, e.morgenbericht_aktiv !== false]))

  const ergebnis: LaufErgebnis[] = []
  for (const t of (tenants ?? []) as R[]) {
    if (Date.now() - start > budgetMs) { ergebnis.push({ tenant: t.name, uebersprungen: 'Zeitbudget erschöpft' }); continue }
    if (aktiv.get(t.id) === false) { ergebnis.push({ tenant: t.name, uebersprungen: 'Morgenbericht deaktiviert' }); continue }
    const t0 = Date.now()
    try {
      const b = await erstelleMorgenbericht({ id: t.id, name: t.name, stripe_plan: t.stripe_plan }, 'cron')
      ergebnis.push({ tenant: t.name, befunde: b.befunde.length, hoch: b.anzahl.hoch, dauerMs: Date.now() - t0 })
    } catch (e) {
      ergebnis.push({ tenant: t.name, fehler: (e as Error).message, dauerMs: Date.now() - t0 })
    }
  }
  return { betriebe: ergebnis.length, dauerMs: Date.now() - start, ergebnis }
}
