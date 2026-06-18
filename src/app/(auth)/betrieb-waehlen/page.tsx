import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'
import { selectBetriebAction } from './actions'

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
    .select('tenant_id, anzeigename, logo_url')
    .in('tenant_id', tenantIds)

  const anzeigeMap: Record<string, { anzeigename: string | null; logo_url: string | null }> = {}
  for (const e of (einstellungen ?? []) as R[]) {
    anzeigeMap[e.tenant_id] = { anzeigename: e.anzeigename, logo_url: e.logo_url }
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
                <button
                  type="submit"
                  className="w-full text-left bg-white border border-s112-border rounded-xl px-5 py-4 hover:border-s112-teal hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900 group-hover:text-s112-teal transition-colors">
                        {displayName}
                      </p>
                      <p className="text-xs text-s112-muted mt-0.5">
                        {ROLE_LABEL[m.role] ?? m.role}
                        {tenant?.plan && <span className="ml-2 opacity-60">· {tenant.plan}</span>}
                      </p>
                    </div>
                    <span className="text-s112-teal opacity-0 group-hover:opacity-100 transition-opacity text-lg">→</span>
                  </div>
                </button>
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
