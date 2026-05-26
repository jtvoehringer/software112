import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Dashboard' }

// Modul-Karten – werden in Phase 1 mit echten Links befüllt
const MODULES = [
  { id: 'weingarten',    label: 'Weingarten',               icon: '🌿', phase: 1, href: '/weingarten' },
  { id: 'kellerbuch',   label: 'Kellerbuch & Vinifizierung', icon: '🍷', phase: 1, href: '/kellerbuch' },
  { id: 'dac',          label: 'DAC & Prüfnummern',         icon: '📋', phase: 1, href: '/dac' },
  { id: 'weinhandel',   label: 'Weinhandel & CRM',          icon: '🛒', phase: 2, href: '/weinhandel' },
  { id: 'buchhaltung',  label: 'Buchhaltung',               icon: '📊', phase: 2, href: '/buchhaltung' },
  { id: 'reports',      label: 'Reports & Behörden',         icon: '📁', phase: 2, href: '/reports' },
]

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Tenant-Mitgliedschaften laden
  const { data: memberships } = await supabase
    .from('tenant_memberships')
    .select('role, tenants(name)')

  const tenantName = memberships?.[0]?.tenants
    ? (memberships[0].tenants as { name: string }).name
    : null

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {tenantName ? `${tenantName}` : 'Dashboard'}
        </h1>
        <p className="text-s112-muted text-sm mt-1">
          Willkommen zurück, {user?.email}
        </p>
      </div>

      {/* Modul-Grid */}
      <div>
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider mb-4">
          Module
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map(mod => (
            <div
              key={mod.id}
              className={`card flex items-start gap-4 ${
                mod.phase > 1 ? 'opacity-50' : 'hover:border-s112-teal cursor-pointer transition-colors'
              }`}
            >
              <span className="text-2xl">{mod.icon}</span>
              <div>
                <h3 className="font-semibold text-gray-800">{mod.label}</h3>
                <p className="text-xs text-s112-muted mt-0.5">
                  {mod.phase === 1 ? 'Phase 1' : `Phase ${mod.phase} – geplant`}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase-0-Status-Banner */}
      <div className="mt-8 bg-s112-teal text-white rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-s112-yellow font-bold text-sm uppercase tracking-wider">
            Phase 0
          </span>
          <span className="text-white/60 text-sm">Fundament & Setup</span>
        </div>
        <p className="text-white/90 text-sm">
          Infrastruktur läuft ✓ · Supabase verbunden ✓ · Rollenmodell aktiv ✓
        </p>
        <p className="text-white/60 text-xs mt-2">
          Nächster Schritt: Phase 1 – Weingarten-Stammdaten
        </p>
      </div>
    </div>
  )
}
