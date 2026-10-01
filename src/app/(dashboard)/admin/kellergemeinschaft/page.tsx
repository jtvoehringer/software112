// ── Administration > Kellergemeinschaft (Migration 203) ──────────────────────
// Gebinde eines Betriebs (Eigentümer) für Partnerbetriebe (Nutzer) freigeben.
// Nur system_admin; Datenbasis sind die Mandanten mit aktiver Mitgliedschaft
// des Admins (wie unter Administration > Mandanten).
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { istPlattformAdmin } from '@/lib/auth/plattformAdmin'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import KellergemeinschaftClient from './KellergemeinschaftClient'

export const metadata: Metadata = { title: 'Kellergemeinschaft – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type FreigabeRow = {
  id: string
  eigentuemer_tenant_id: string
  eigentuemer_name: string
  nutzer_tenant_id: string
  nutzer_name: string
  aktiv: boolean
  notizen: string | null
  erstellt_am: string
  gebinde_gesamt: number
  gebinde_freigegeben: number
}

export default async function KellergemeinschaftPage() {
  // 01.10.2026 (Backlog-Abgleich): Plattform-Admin statt Rolle im aktiven Betrieb
  if (!(await istPlattformAdmin())) redirect('/dashboard')
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const admin = createSupabaseAdminClient()
  const { data: memberships } = await (admin.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).eq('aktiv', true)
  const tenantIds = ((memberships ?? []) as R[]).map(m => m.tenant_id as string)

  // tenant-isolation-ignore: mandantenübergreifende Verwaltungsseite (system_admin), auf eigene Mitgliedschaften eingeschränkt
  const [{ data: tenants }, { data: freigaben }, { data: behaelter }] = await Promise.all([
    (admin.from('tenants') as any).select('id, name').in('id', tenantIds).order('name'),
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin)
    (admin.from('keller_freigaben') as any).select('id, eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen, erstellt_am').in('eigentuemer_tenant_id', tenantIds).order('erstellt_am'),
    // tenant-isolation-ignore: Zähler je Eigentümer über die eigenen Mandanten des Admins
    (admin.from('behaelter') as any).select('tenant_id, gemeinsam, aktiv').in('tenant_id', tenantIds).eq('aktiv', true),
  ])
  const nameMap = new Map<string, string>(((tenants ?? []) as R[]).map(t => [t.id, t.name]))
  const zaehler = new Map<string, { gesamt: number; frei: number }>()
  for (const b of (behaelter ?? []) as R[]) {
    const z = zaehler.get(b.tenant_id) ?? { gesamt: 0, frei: 0 }
    z.gesamt++; if (b.gemeinsam) z.frei++
    zaehler.set(b.tenant_id, z)
  }
  const rows: FreigabeRow[] = ((freigaben ?? []) as R[]).map(f => ({
    id: f.id, eigentuemer_tenant_id: f.eigentuemer_tenant_id, eigentuemer_name: nameMap.get(f.eigentuemer_tenant_id) ?? '?',
    nutzer_tenant_id: f.nutzer_tenant_id, nutzer_name: nameMap.get(f.nutzer_tenant_id) ?? '?',
    aktiv: !!f.aktiv, notizen: f.notizen ?? null, erstellt_am: f.erstellt_am,
    gebinde_gesamt: zaehler.get(f.eigentuemer_tenant_id)?.gesamt ?? 0, gebinde_freigegeben: zaehler.get(f.eigentuemer_tenant_id)?.frei ?? 0,
  }))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Kellergemeinschaft</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Kellergemeinschaft</h1>
        <p className="text-sm text-s112-muted mt-0.5">Gebinde eines Betriebs für Partnerbetriebe freigeben – Inhalte bleiben getrennt, fremd belegte Gebinde sind gesperrt.</p>
      </div>
      <KellergemeinschaftClient rows={rows} tenants={((tenants ?? []) as R[]).map(t => ({ id: t.id as string, name: t.name as string }))} />
    </div>
  )
}
