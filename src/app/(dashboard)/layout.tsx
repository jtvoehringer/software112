import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, roleLabel } from '@/lib/auth/roles'
import Sidebar from '@/components/layout/Sidebar'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type TenantBranding = {
  anzeigename: string
  logo_url: string | null
  primary_color: string
  secondary_color: string
  modul_newsletter: boolean
}

const DEFAULT_BRANDING: TenantBranding = {
  anzeigename:      'software:112',
  logo_url:         null,
  primary_color:    '#2a7c6f',
  secondary_color:  '#f5c842',
  modul_newsletter: false,
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const role       = await getCurrentUserRole()
  const membership = await getCurrentMembership()

  // Tenant-Branding laden
  let branding: TenantBranding = DEFAULT_BRANDING
  if (membership?.tenantId) {
    const { data } = await (supabase.from('tenant_einstellungen') as any)
      .select('anzeigename, logo_url, primary_color, secondary_color, modul_newsletter')
      .eq('tenant_id', membership.tenantId)
      .maybeSingle()

    if (data) {
      const d = data as R
      branding = {
        anzeigename:      d.anzeigename ?? DEFAULT_BRANDING.anzeigename,
        logo_url:         d.logo_url ?? null,
        primary_color:    d.primary_color ?? DEFAULT_BRANDING.primary_color,
        secondary_color:  d.secondary_color ?? DEFAULT_BRANDING.secondary_color,
        modul_newsletter: d.modul_newsletter ?? false,
      }
    }
  }

  return (
    <div className="flex h-screen bg-s112-bg overflow-hidden">
      <Sidebar
        userEmail={user.email ?? ''}
        role={role}
        roleLabel={roleLabel(role)}
        branding={branding}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
