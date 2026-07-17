import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'
import { selectBetriebAction } from './actions'
import BetriebCard from './BetriebCard'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: 'Betriebsleiter',
  winzer:       'Winzer/Kellermeister',
  leser:        'Nur-Lesen',
  system_admin: 'System-Admin',
}

export default async function BetriebWaehlenPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Alle Memberships mit Tenant-Info laden
  const { data: memberships } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id, role, tenants(name, slug, plan)')
    .order('created_at', { ascending: true })

  if (!memberships || memberships.length === 0) redirect('/login')

  // Einzelner Betrieb: sofort Cookie setzen und weiterleiten
  if (memberships.length === 1) {
    await setActiveTenantCookie((memberships[0] as R).tenant_id)
    redirect('/dashboard')
  }

  // Anzeigenamen aus tenant_einstellungen laden
  const tenantIds = (memberships as R[]).map(m => m.tenant_id)
  const { data: einstellungen } = await (supabase.from('tenant_einstellungen') as any)
    .select('tenant_id, anzeigename, logo_url, primary_color')
    .in('tenant_id', tenantIds)

  const anzeigeMap: Record<string, { anzeigename: string | null; logo_url: string | null; primary_color: string | null }> = {}
  for (const e of (einstellungen ?? []) as R[]) {
    anzeigeMap[e.tenant_id] = { anzeigename: e.anzeigename, logo_url: e.logo_url, primary_color: e.primary_color ?? null }
  }

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-s112-teal inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">Welchen Betrieb möchtest du öffnen?</p>
        </div>

        {/* Betrieb-Karten */}
        <div className="space-y-3">
          {(memberships as R[]).map(m => {
            const tenant = m.tenants as R
            const eins = anzeigeMap[m.tenant_id]
            const displayName = eins?.anzeigename || tenant?.name || m.tenant_id
            return (
              <form key={m.tenant_id} action={selectBetriebAction}>
                <input type="hidden" name="tenant_id" value={m.tenant_id} />
                <BetriebCard
                  displayName={displayName}
                  roleLabel={ROLE_LABEL[m.role] ?? m.role}
                  plan={tenant?.plan}
                  accentColor={eins?.primary_color}
                />
              </form>
            )
          })}
        </div>

        <p className="text-center text-xs text-s112-muted mt-6">
          Angemeldet als {user.email}
        </p>
      </div>
    </div>
  )
}
