import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, roleLabel, canWrite, canSeeAuswertungen, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { STRIPE_BLOCKED_STATUSES, istTrialAbgelaufen } from '@/lib/stripe/client'
import AppShell from '@/components/layout/AppShell'
import ReleaseNotesModal from '@/components/ReleaseNotesModal'
import SessionTimeout from '@/components/SessionTimeout'
import AutoRefresh from '@/components/AutoRefresh'
import NavigationsBalken from '@/components/NavigationsBalken'
import { Suspense } from 'react'
import AssistentWidget from '@/components/assistent/AssistentWidget'
import Link from '@/components/ui/Link'
import { ladeTenantKopf } from '@/lib/tenant/kopf'

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
  modul_controlling: boolean
  /** Migration 197: 'ea' = E&A in software:112, 'doppik' = Steuerberater/BMD */
  buchhaltungsart: 'ea' | 'doppik'
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
  modul_controlling: false,
  buchhaltungsart:  'ea',
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

  // Anzahl Betriebe des Users (Betrieb-Wechsel-Button) und Profilname parallel
  const [{ count: betriebCount }, { data: profil }] = await Promise.all([
    (supabase.from('tenant_memberships') as any)
      .select('tenant_id', { count: 'exact', head: true }),
    (supabase.from('profiles') as any)
      .select('full_name').eq('id', user.id).maybeSingle(),
  ])

  // Tenant-Branding laden
  let branding: TenantBranding = DEFAULT_BRANDING
  let assistentAktiv = false
  let isSandbox = false
  // Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
  // damit wir zu unserem Geld kommen"): Zugriffssperre für Mandanten ohne
  // aktives Abo. system_admin (Plattformbetreiber) und die Sandbox sind
  // ausgenommen. 'past_due' sperrt bewusst nicht sofort (siehe stripe/client.ts),
  // zeigt aber eine Warnung mit Link zur Selbstverwaltung (/abo).
  let billingBlocked = false
  let billingWarnung = false
  if (membership?.tenantId) {
    // Branding/Module/Abo-Status aus dem 60-s-Layout-Cache (lib/tenant/kopf.ts,
    // 17.9.2026) statt zwei Abfragen je Seitenaufruf. tenants.name nur für
    // sandboxOnly-Nav-Items (bewusst der echte Mandantenname, nicht der frei
    // editierbare Anzeigename); stripe_status/-trial für die Zugriffssperre.
    const kopf = await ladeTenantKopf(membership.tenantId)
    const data = kopf.einstellungen
    const tenantRow = kopf.tenant

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
        modul_controlling: d.modul_controlling ?? false,
        buchhaltungsart:  d.buchhaltungsart === 'doppik' ? 'doppik' : 'ea',
      }
      assistentAktiv = !!d.assistent_aktiv
    }
    isSandbox = (tenantRow as R | null)?.name === 'Sandbox'

    const stripeStatus  = (tenantRow as R | null)?.stripe_status ?? null
    const trialEndsAt   = (tenantRow as R | null)?.stripe_trial_ends_at ?? null
    if (stripeStatus && role !== 'system_admin' && !isSandbox) {
      if (STRIPE_BLOCKED_STATUSES.includes(stripeStatus) || istTrialAbgelaufen(stripeStatus, trialEndsAt)) billingBlocked = true
      else if (stripeStatus === 'past_due') billingWarnung = true
    }
  }

  if (billingBlocked) redirect('/abo')

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
      <AutoRefresh />
      {/* Ladebalken bei Seitenwechsel (useSearchParams braucht Suspense) */}
      <Suspense fallback={null}><NavigationsBalken /></Suspense>
      <AppShell
        userEmail={user.email ?? ''}
        userName={(profil as any)?.full_name || user.user_metadata?.display_name || user.user_metadata?.name || (user.email ?? '').split('@')[0]}
        role={role}
        roleLabel={roleLabel(role)}
        branding={branding}
        betriebCount={betriebCount ?? 1}
        isSandbox={isSandbox}
        sandboxAdminUnlock={isSandboxAdminUnlock(user.email, isSandbox)}
        darfSchreiben={canWrite(role)}
        auswertungenSichtbar={canSeeAuswertungen(role)}
      >
        {billingWarnung && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg text-sm flex items-center justify-between gap-3 flex-wrap">
            <span>Es gibt ein Problem mit der letzten Zahlung für Ihr Abo. Bitte aktualisieren Sie Ihre Zahlungsdaten, um eine Sperre zu vermeiden.</span>
            <Link href="/abo" className="font-semibold underline whitespace-nowrap hover:text-s112-warn-fg">Zahlungsdaten verwalten →</Link>
          </div>
        )}
        {children}
      </AppShell>
      {assistentAktiv && canWrite(role, 'kellerbuch') && <AssistentWidget />}
    </>
  )
}
