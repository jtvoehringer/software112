import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, roleLabel, canWrite, isSandboxAdminUnlock } from '@/lib/auth/roles'
import ResponsiveLayout from '@/components/layout/ResponsiveLayout'
import ReleaseNotesModal from '@/components/ReleaseNotesModal'
import SessionTimeout from '@/components/SessionTimeout'
import AssistentWidget from '@/components/assistent/AssistentWidget'

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
  modul_sumup: boolean
  modul_export: boolean
}

// Entspricht exakt den CSS-Fallback-Werten in globals.css/tailwind.config.ts
// (--s112-teal / --s112-yellow) — das ist die getestete, gut aufeinander
// abgestimmte Standard-Farbkombination des Designs (Stand 2026-08, vom
// hohenstein-Logo abgeleitet, siehe project_design_relaunch.md).
const DEFAULT_BRANDING: TenantBranding = {
  anzeigename:      'software:112',
  logo_url:         null,
  primary_color:    '#4F86D6',
  secondary_color:  '#FFFFFF',
  modul_newsletter: false,
  modul_ea:         false,
  modul_sumup:      false,
  modul_export:     false,
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

  // Anzahl Betriebe des Users (für Betrieb-Wechsel-Button in Sidebar)
  const { count: betriebCount } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id', { count: 'exact', head: true })

  // Profilname aus profiles-Tabelle
  const { data: profil } = await (supabase.from('profiles') as any)
    .select('full_name').eq('id', user.id).maybeSingle()

  // Tenant-Branding laden
  let branding: TenantBranding = DEFAULT_BRANDING
  let assistentAktiv = false
  let isSandbox = false
  if (membership?.tenantId) {
    const [{ data }, { data: tenantRow }] = await Promise.all([
      (supabase.from('tenant_einstellungen') as any)
        .select('anzeigename, logo_url, primary_color, secondary_color, modul_newsletter, modul_ea, modul_sumup, modul_export, session_timeout_minuten, assistent_aktiv')
        .eq('tenant_id', membership.tenantId)
        .maybeSingle(),
      // Nur für sandboxOnly-Nav-Items (z.B. Zeiterfassung, siehe Sidebar.tsx) -
      // bewusst über den echten Mandantennamen ermittelt, nicht über den frei
      // editierbaren Branding-Anzeigenamen (der könnte in der Sandbox jederzeit
      // zu Testzwecken geändert werden).
      (supabase.from('tenants') as any).select('name').eq('id', membership.tenantId).maybeSingle(),
    ])

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
        modul_sumup:      d.modul_sumup ?? false,
        modul_export:     d.modul_export ?? false,
      }
      assistentAktiv = !!d.assistent_aktiv
    }
    isSandbox = (tenantRow as R | null)?.name === 'Sandbox'
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
        betriebCount={betriebCount ?? 1}
        isSandbox={isSandbox}
        sandboxAdminUnlock={isSandboxAdminUnlock(user.email, isSandbox)}
      >
        {children}
      </ResponsiveLayout>
      {assistentAktiv && canWrite(role) && <AssistentWidget />}
    </>
  )
}
