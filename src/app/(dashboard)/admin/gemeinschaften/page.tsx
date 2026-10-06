/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
// ── Administration > Gemeinschaften (Migration 203 Kellergemeinschaft, KAN-212 CRM-Gemeinschaft) ──────────────────────
// Kellergemeinschaft: Gebinde eines Betriebs (Eigentümer) für Partnerbetriebe (Nutzer) freigeben.
// CRM-Gemeinschaft: Kontakte, Firmen, Aktivitäten und Pipeline eines Betriebs für Partnerbetriebe freigeben (lesen und
// in eigenen Belegen verwenden; ändern nur der Eigentümer).
// Nur Plattform-Admin; Datenbasis sind die Mandanten mit aktiver Mitgliedschaft des Admins (wie unter Administration >
// Mandanten).
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { alle } from '@/lib/supabase/alle'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { istPlattformAdmin } from '@/lib/auth/plattformAdmin'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import GemeinschaftenClient from './GemeinschaftenClient'
import type { GemeinschaftArt } from './actions'

export const metadata: Metadata = { title: 'Gemeinschaften – software:112' }
export const dynamic = 'force-dynamic'
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
  /** Keller: Gebinde gesamt; CRM: Kontakte + Firmen des Eigentümers */
  umfang_gesamt: number
  /** Keller: davon freigegeben (gemeinsam); CRM: gleich gesamt */
  umfang_frei: number
}

export default async function GemeinschaftenPage({ searchParams }: { searchParams: Promise<{ art?: string }> }) {
  // 01.10.2026 (Backlog-Abgleich): Plattform-Admin statt Rolle im aktiven Betrieb
  if (!(await istPlattformAdmin())) redirect('/dashboard')
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')
  const art: GemeinschaftArt = (await searchParams).art === 'crm' ? 'crm' : 'keller'

  const admin = createSupabaseAdminClient()
  const { data: memberships } = await (admin.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).eq('aktiv', true)
  const tenantIds = ((memberships ?? []) as R[]).map(m => m.tenant_id as string)

  // tenant-isolation-ignore: mandantenübergreifende Verwaltungsseite (system_admin), auf eigene Mitgliedschaften eingeschränkt
  const [{ data: tenants }, { data: freigaben }] = await Promise.all([
    (admin.from('tenants') as any).select('id, name').in('id', tenantIds).order('name'),
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungstabelle (system_admin)
    (admin.from(art === 'crm' ? 'crm_freigaben' : 'keller_freigaben') as any).select('id, eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen, erstellt_am').in('eigentuemer_tenant_id', tenantIds).order('erstellt_am'),
  ])
  const nameMap = new Map<string, string>(((tenants ?? []) as R[]).map(t => [t.id, t.name]))

  const zaehler = new Map<string, { gesamt: number; frei: number }>()
  if (art === 'keller') {
    // tenant-isolation-ignore: Zähler je Eigentümer über die eigenen Mandanten des Admins
    const { data: behaelter } = await alle((admin.from('behaelter') as any).select('tenant_id, gemeinsam, aktiv').in('tenant_id', tenantIds).eq('aktiv', true).order('id'))
    for (const b of (behaelter ?? []) as R[]) {
      const z = zaehler.get(b.tenant_id) ?? { gesamt: 0, frei: 0 }
      z.gesamt++; if (b.gemeinsam) z.frei++
      zaehler.set(b.tenant_id, z)
    }
  } else {
    const eigentuemer = [...new Set(((freigaben ?? []) as R[]).map(f => f.eigentuemer_tenant_id as string))]
    await Promise.all(eigentuemer.map(async t => {
      const [k, f] = await Promise.all([
        (admin.from('kontakte') as any).select('id', { count: 'exact', head: true }).eq('tenant_id', t).eq('aktiv', true),
        (admin.from('firmen') as any).select('id', { count: 'exact', head: true }).eq('tenant_id', t).eq('aktiv', true),
      ])
      const n = (k.count ?? 0) + (f.count ?? 0)
      zaehler.set(t, { gesamt: n, frei: n })
    }))
  }
  const rows: FreigabeRow[] = ((freigaben ?? []) as R[]).map(f => ({
    id: f.id, eigentuemer_tenant_id: f.eigentuemer_tenant_id, eigentuemer_name: nameMap.get(f.eigentuemer_tenant_id) ?? '?',
    nutzer_tenant_id: f.nutzer_tenant_id, nutzer_name: nameMap.get(f.nutzer_tenant_id) ?? '?',
    aktiv: !!f.aktiv, notizen: f.notizen ?? null, erstellt_am: f.erstellt_am,
    umfang_gesamt: zaehler.get(f.eigentuemer_tenant_id)?.gesamt ?? 0, umfang_frei: zaehler.get(f.eigentuemer_tenant_id)?.frei ?? 0,
  }))

  const reiter = (a: GemeinschaftArt, label: string) => (
    <Link href={a === 'keller' ? '/admin/gemeinschaften' : '/admin/gemeinschaften?art=crm'}
      className={`px-3 py-1.5 rounded-lg text-sm ${art === a ? 'bg-s112-teal text-s112-yellow font-semibold' : 'text-s112-text-2 hover:bg-s112-bg'}`}>{label}</Link>
  )

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Gemeinschaften</span>
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-s112-text">Gemeinschaften</h1>
        <p className="text-sm text-s112-muted mt-0.5">
          {art === 'keller'
            ? 'Kellergemeinschaft: Gebinde eines Betriebs für Partnerbetriebe freigeben – Inhalte bleiben getrennt, fremd belegte Gebinde sind gesperrt.'
            : 'CRM-Gemeinschaft: Kontakte, Firmen, Aktivitäten (ohne private) und Pipeline eines Betriebs für Partnerbetriebe freigeben – der Partner liest sie und verwendet Kontakte und Firmen in eigenen Belegen; ändern darf nur der Eigentümer. Kundennummer und Rabatt des Eigentümers gehen nicht auf Belege des Partners.'}
        </p>
      </div>
      <div className="flex gap-2 mb-6" role="tablist" aria-label="Art der Gemeinschaft">
        {reiter('keller', 'Kellergemeinschaft')}
        {reiter('crm', 'CRM-Gemeinschaft')}
      </div>
      <GemeinschaftenClient key={art} art={art} rows={rows} tenants={((tenants ?? []) as R[]).map(t => ({ id: t.id as string, name: t.name as string }))} />
    </div>
  )
}
