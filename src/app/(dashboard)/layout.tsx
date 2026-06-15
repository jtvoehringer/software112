import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, roleLabel } from '@/lib/auth/roles'
import ResponsiveLayout from '@/components/layout/ResponsiveLayout'
import ReleaseNotesModal from '@/components/ReleaseNotesModal'
import SessionTimeout from '@/components/SessionTimeout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type TenantBranding = {
  session_timeout?: number | null
  anzeigename: string
  logo_url: string | null
  primary_color: string
  secondary_color: string
  modul_newsletter: boolean
  modul_ea: boolean
  modul_fibu: boolean
  modul_sumup: boolean
}

const DEFAULT_BRANDING: TenantBranding = {
  anzeigename:      'software:112',
  logo_url:         null,
  primary_color:    '#2a7c6f',
  secondary_color:  '#f5c842',
  modul_newsletter: false,
  modul_ea:         false,
  modul_fibu:       false,
  modul_sumup:      false,
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

  // Profilname aus profiles-Tabelle
  const { data: profil } = await (supabase.from('profiles') as any)
    .select('full_name').eq('id', user.id).maybeSingle()

  // Tenant-Branding laden
  let branding: TenantBranding = DEFAULT_BRANDING
  if (membership?.tenantId) {
    const { data } = await (supabase.from('tenant_einstellungen') as any)
      .select('anzeigename, logo_url, primary_color, secondary_color, modul_newsletter, modul_ea, modul_fibu, modul_sumup, session_timeout_minuten')
      .eq('tenant_id', membership.tenantId)
      .maybeSingle()

    if (data) {
      const d = data as R
      branding = {
        anzeigename:      d.anzeigename ?? DEFAULT_BRANDING.anzeigename,
        logo_url:         d.logo_url ?? null,
        primary_color:    d.primary_color ?? DEFAULT_BRANDING.primary_color,
        session_timeout:  d.session_timeout_minuten ?? null,
        secondary_color:  d.secondary_color ?? DEFAULT_BRANDING.secondary_color,
        modul_newsletter: d.modul_newsletter ?? false,
        modul_ea:         d.modul_ea ?? false,
        modul_fibu:       d.modul_fibu ?? false,
        modul_sumup:      d.modul_sumup ?? false,
      }
    }
  }

  return (
    <>
      {/* CSS-Variablen pro Tenant — überschreiben die Tailwind-Defaults */}
      <style>{`
        :root {
          --s112-teal:   ${branding.primary_color};
          --s112-yellow: ${branding.secondary_color};
        }
      `}</style>
      <ReleaseNotesModal />
      <SessionTimeout timeoutMinuten={(branding as any).session_timeout} />
      <ResponsiveLayout
        userEmail={user.email ?? ''}
        userName={(profil as any)?.full_name || user.user_metadata?.display_name || user.user_metadata?.name || (user.email ?? '').split('@')[0]}
        role={role}
        roleLabel={roleLabel(role)}
        branding={branding}
      >
        {children}
      </ResponsiveLayout>
    </>
  )
}
