// ── Systembericht: Betriebe ohne Morgenbericht am Vortag (KAN-123, 25.09.2026) ─
// Für den Sandbox-Morgenbericht (pruefungen.ts, Abschnitt Systembericht): ein Betrieb,
// den der Cron ausgelassen hat oder dessen Bericht abgebrochen ist, fällt so am nächsten
// Morgen auf. Gezählt wird JEDE morgenberichte-Zeile des Vortags (ein manueller Lauf
// überschreibt die Cron-Zeile per Upsert, darum nicht nach ausloeser filtern). Die Regeln
// (Ausnahmen) stehen in zeitplan.ts: betriebeOhneVortagsbericht().

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { aboStandBerechnen, DEMO_TENANT_ID } from '@/lib/abo/regeln'
import { betriebeOhneVortagsbericht, vortagVon, type VortagBetrieb } from './zeitplan'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function betriebeOhneMorgenberichtAmVortag(heute: Date): Promise<VortagBetrieb[]> {
  const admin = createSupabaseAdminClient()
  const vortag = vortagVon(heute)
  const [{ data: tenants, error: e1 }, { data: einst, error: e2 }, { data: berichte, error: e3 }] = await Promise.all([
    // tenant-isolation-ignore: Systembericht über alle Betriebe (nur Sandbox der Super-Admins), nur Stammdaten
    (admin.from('tenants') as any).select('id, name, created_at, active, stripe_status, stripe_trial_ends_at'),
    // tenant-isolation-ignore: Schalter morgenbericht_aktiv aller Betriebe für den Systembericht
    (admin.from('tenant_einstellungen') as any).select('tenant_id, morgenbericht_aktiv'),
    // tenant-isolation-ignore: nur tenant_id der Berichte vom Vortag, Systembericht über alle Betriebe
    (admin.from('morgenberichte') as any).select('tenant_id').eq('datum', vortag),
  ])
  const fehler = e1 ?? e2 ?? e3
  if (fehler) throw new Error(fehler.message)
  const aktiv = new Map(((einst ?? []) as R[]).map(e => [e.tenant_id, e.morgenbericht_aktiv !== false]))
  const betriebe: VortagBetrieb[] = ((tenants ?? []) as R[]).map(t => ({
    id: t.id, name: t.name ?? '?', createdAt: t.created_at ?? null, aktiv: t.active !== false,
    morgenberichtAktiv: aktiv.get(t.id) !== false,
    aboGesperrt: aboStandBerechnen({ tenantId: t.id, stripeStatus: t.stripe_status, trialEndsAt: t.stripe_trial_ends_at, role: null }).gesperrt,
    demo: t.id === DEMO_TENANT_ID,
  }))
  return betriebeOhneVortagsbericht(betriebe, new Set(((berichte ?? []) as R[]).map(b => b.tenant_id as string)), vortag)
}
