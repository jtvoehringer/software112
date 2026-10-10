import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { istPlattformAdmin } from '@/lib/auth/plattformAdmin'
import { SANDBOX_TENANT_ID } from '@/lib/abo/regeln'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import MandantenClient from './MandantenClient'
import { premiumSupportStand, premiumSupportText } from '@/lib/abo/premiumSupport'

export const metadata: Metadata = { title: 'Mandanten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type MandantRow = {
  id: string
  name: string
  kundennummer: string | null
  erstellt_am: string
  benutzer_anzahl: number
  // Branding
  anzeigename:      string | null
  logo_url:         string | null
  primary_color:    string
  secondary_color:  string
  modul_newsletter: boolean
  /** KAN-226: Stand als Text (null = Spalten fehlen noch) und ob heute aktiv */
  premium_support:       string | null
  premium_support_aktiv: boolean
}

export default async function MandantenPage() {
  // 01.10.2026 (Backlog-Abgleich): Plattform-Admin statt Rolle im aktiven Betrieb; Sandbox über die feste ID
  const plattform = await istPlattformAdmin()

  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createSupabaseAdminClient()

  // Sandbox-Tenant-ID ermitteln - wird für die Sonderfreigabe (siehe unten)
  // UND für deren Härtung gebraucht (Sonderfreigabe darf NIE echte Mandanten
  // sehen, siehe isSandboxAdminUnlock in lib/auth/roles.ts).
  const sandboxTenantId: string | null = SANDBOX_TENANT_ID

  const membership = await getCurrentMembership()
  const isSandboxActive = !!sandboxTenantId && membership?.tenantId === sandboxTenantId
  const sandboxUnlock = isSandboxAdminUnlock(user.email, isSandboxActive)

  if (!plattform && !sandboxUnlock) redirect('/dashboard')

  // Nur Mandanten zeigen, wo der aktuelle User eine AKTIVE Mitgliedschaft hat -
  // nicht pauschal alle Mandanten der Instanz. Wenn ein Betriebsleiter Jörgens
  // Mitgliedschaft über /benutzer deaktiviert (Migration 159 Aktiv-Toggle),
  // verschwindet der Mandant dadurch automatisch auch aus dieser Übersicht.
  let eigeneTenantIds: string[]
  if (!plattform && sandboxUnlock) {
    // Sandbox-Sonderfreigabe: zeigt IMMER nur den Sandbox-Mandanten selbst,
    // unabhängig davon, in welchen echten Mandanten dieser User sonst noch
    // aktive Mitgliedschaften hat (z.B. der echte Weingut-Gebeshuber-Betrieb
    // von jg@weingut-gebeshuber.at) - "sonst NIE" (Rückmeldung 19.8.2026).
    eigeneTenantIds = [sandboxTenantId as string]
  } else {
    const eigeneMemberships = geladen(await (supabase.from('tenant_memberships') as any)
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('aktiv', true), 'Mitglieder')
    eigeneTenantIds = ((eigeneMemberships ?? []) as R[]).map(m => m.tenant_id)
  }

  if (eigeneTenantIds.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
          <span>Administration</span>
          <span>/</span>
          <span className="text-s112-text-1 font-medium">Mandanten</span>
        </div>
        <h1 className="text-2xl font-semibold text-s112-text mb-2">Mandanten</h1>
        <p className="text-sm text-s112-muted">Keine aktive Mitgliedschaft in einem Mandanten gefunden.</p>
      </div>
    )
  }

  const [tenantsRes, membershipsRes] = await Promise.all([
    (supabase.from('tenants') as any).select('id, name, created_at, kundennummer').in('id', eigeneTenantIds).order('created_at'),
    (supabase.from('tenant_memberships') as any).select('tenant_id').in('tenant_id', eigeneTenantIds),
  ])
  const tenants = geladen(tenantsRes, 'Betrieb')
  const memberships = geladen(membershipsRes, 'Mitglieder')

  // tenant_einstellungen existiert erst nach Migration 021 → graceful fallback
  let einstellungen: R[] = []
  try {
    // Bewusst mandantenübergreifend - .in('tenant_id', eigeneTenantIds) ist bereits auf die
    // eigenen, oben per .eq('user_id', user.id).eq('aktiv', true) geprüften Mitgliedschaften
    // eingeschränkt. Diese Übersichtsseite zeigt absichtlich ALLE vom Nutzer verwalteten
    // Betriebe gleichzeitig (nicht nur den aktiven) - genau ihr Zweck.
    // tenant-isolation-ignore: mandantenübergreifende Verwaltungsübersicht, siehe Kommentar oben
    const data = geladen(await (supabase.from('tenant_einstellungen') as any)
      .select('tenant_id, anzeigename, logo_url, primary_color, secondary_color, modul_newsletter')
      .in('tenant_id', eigeneTenantIds), 'Einstellungen')
    einstellungen = (data ?? []) as R[]
  } catch {
    // Tabelle noch nicht migriert – Branding-Felder bleiben leer
  }

  // KAN-226: Premium-Support getrennt und fehlertolerant (vor der Migration gibt es die Spalten nicht)
  const { data: psRows, error: psFehler } = await (supabase.from('tenants') as R)
    .select('id, premium_support_seit, premium_support_bis').in('id', eigeneTenantIds)
  const psMap: Record<string, R> = {}
  for (const p of (psRows ?? []) as R[]) psMap[p.id] = p

  // Benutzeranzahl je Mandant zählen
  const countMap: Record<string, number> = {}
  for (const m of (memberships ?? []) as R[]) {
    countMap[m.tenant_id] = (countMap[m.tenant_id] ?? 0) + 1
  }

  // Branding-Map
  const brandingMap: Record<string, R> = {}
  for (const e of (einstellungen ?? []) as R[]) {
    brandingMap[e.tenant_id] = e
  }

  const mandanten: MandantRow[] = ((tenants ?? []) as R[]).map(t => {
    const b = brandingMap[t.id]
    const ps = psFehler ? null : premiumSupportStand({ seit: psMap[t.id]?.premium_support_seit ?? null, bis: psMap[t.id]?.premium_support_bis ?? null })
    return {
      premium_support:       ps ? premiumSupportText(ps) : null,
      premium_support_aktiv: ps?.status === 'aktiv',
      id:              t.id,
      name:            t.name,
      kundennummer:    (t.kundennummer as string | null) ?? null,
      erstellt_am:     t.created_at,
      benutzer_anzahl: countMap[t.id] ?? 0,
      anzeigename:     b?.anzeigename ?? null,
      logo_url:        b?.logo_url ?? null,
      primary_color:   b?.primary_color ?? '#4F86D6',
      secondary_color: b?.secondary_color ?? '#FFFFFF',
      modul_newsletter: b?.modul_newsletter ?? false,
    }
  })

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Mandanten</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Mandanten</h1>
          <p className="text-sm text-s112-muted mt-0.5">Alle Betriebe auf dieser Instanz</p>
        </div>
        <span className="text-sm text-s112-muted">{mandanten.length} Mandanten</span>
      </div>
      <MandantenClient mandanten={mandanten} canCreate={plattform} />
    </div>
  )
}
