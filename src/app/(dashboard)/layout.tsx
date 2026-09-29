import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, roleLabel, canWrite, canSeeAuswertungen, isSandboxAdminUnlock } from '@/lib/auth/roles'
import { aboStandErmitteln } from '@/lib/abo/regeln'
import AppShell from '@/components/layout/AppShell'
import ReleaseNotesModal from '@/components/ReleaseNotesModal'
import SessionTimeout from '@/components/SessionTimeout'
import AutoRefresh from '@/components/AutoRefresh'
import BetriebsWaechter from '@/components/BetriebsWaechter'
import NurLesenHinweis from '@/components/NurLesenHinweis'
import { NUR_LESEN_BANNER, NUR_LESEN_TITEL } from '@/lib/abo/regeln'
import NavigationsBalken from '@/components/NavigationsBalken'
import { Suspense } from 'react'
import AssistentWidget from '@/components/assistent/AssistentWidget'
import Link from '@/components/ui/Link'
import { ladeTenantKopf, ladeTenantKopfFrisch, betriebsName, mandantName, mostgewichtEinheitAus } from '@/lib/tenant/kopf'
import type { MostgewichtEinheit } from '@/lib/wein/mostgewicht'
import { ladeMfaStand, MFA_PFLICHT_AB } from '@/lib/auth/mfa'
import { barrierefreieAktionsfarbe } from '@/lib/farbe'

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

  // Zwei-Faktor-Pflicht für Super-Admin und Betriebs-Manager (Sicherheits-Welle 2, S3)
  const mfa = await ladeMfaStand(supabase, role)
  if (mfa.pflichtAktiv && !mfa.hatFaktor) redirect('/zwei-faktor?pflicht=1')
  const mfaHinweis = mfa.pflicht && !mfa.hatFaktor

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
  // damit wir zu unserem Geld kommen"): Sperre für Mandanten ohne aktives Abo.
  // Seit KAN-5 (25.9.2026, Entscheidung Jörgen) keine Umleitung auf /abo mehr,
  // sondern Nur-Lesen-Modus: Seiten, Druck und Exporte bleiben erreichbar
  // (Aufbewahrungspflicht, DSGVO), Speichern, KI-Abfrage und Assistent sperrt
  // der Server (lib/auth/sperren.ts); hier nur Hinweisleiste und Browser-Wächter.
  // Ausgenommen: system_admin, Sandbox und Demo-Musterhof (feste IDs,
  // lib/abo/regeln.ts). 'past_due' sperrt bewusst nicht sofort, zeigt aber eine
  // Warnung mit Link zur Selbstverwaltung (/abo).
  let billingBlocked = false
  let billingWarnung = false
  // Betrieb, mit dem diese Seite gerendert wird – für den Betriebs-Wächter (KAN-30)
  let seitenBetriebName = ''
  let seitenMandant = ''
  // Bevorzugte Mostgewicht-Einheit (KAN-128) für Formulare und Listen – Client-Context in der AppShell
  let mostgewichtEinheit: MostgewichtEinheit = 'kmw'
  if (membership?.tenantId) {
    // Branding/Module/Abo-Status aus dem 60-s-Layout-Cache (lib/tenant/kopf.ts,
    // 17.9.2026) statt zwei Abfragen je Seitenaufruf. tenants.name nur für
    // sandboxOnly-Nav-Items (bewusst der echte Mandantenname, nicht der frei
    // editierbare Anzeigename); stripe_status/-trial für die Zugriffssperre.
    const kopf = await ladeTenantKopf(membership.tenantId)
    const data = kopf.einstellungen
    const tenantRow = kopf.tenant
    seitenBetriebName = betriebsName(kopf)
    seitenMandant = mandantName(kopf)
    mostgewichtEinheit = mostgewichtEinheitAus(kopf)

    if (data) {
      const d = data as R
      branding = {
        // Leerer Anzeigename → Betriebsname (tenants.name) statt „software:112“ (KAN-163)
        anzeigename:      seitenBetriebName || DEFAULT_BRANDING.anzeigename,
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
    } else if (tenantRow) {
      // ohne tenant_einstellungen-Zeile ebenfalls den Betriebsnamen zeigen (KAN-163)
      branding = { ...branding, anzeigename: seitenBetriebName }
    }
    isSandbox = (tenantRow as R | null)?.name === 'Sandbox'

    // Dieselbe Regel prüfen Server Actions und API-Routen (lib/auth/sperren.ts: schreibSperre);
    // den schon geladenen Kopf wiederverwenden, vor „gesperrt“ ungecacht gegenprüfen
    const abo = await aboStandErmitteln(
      { tenantId: membership.tenantId, role },
      { gecacht: async () => kopf, frisch: ladeTenantKopfFrisch },
    )
    // Registrierung ohne abgeschlossenen Checkout (noch nie ein Abo): wie vor KAN-5 direkt zu
    // „Zahlung nachholen“ – ein leerer Betrieb im Nur-Lesen-Modus hilft einem Neukunden nicht
    if (abo.zahlungOffen) redirect('/abo')
    billingBlocked = abo.gesperrt
    billingWarnung = abo.warnung
  }

  return (
    <>
      {/* CSS-Variablen pro Tenant — überschreiben die Tailwind-Defaults */}
      <style>{`
        :root {
          --s112-teal:   ${barrierefreieAktionsfarbe(branding.primary_color, branding.secondary_color)};
          --s112-yellow: ${branding.secondary_color};
        }
      `}</style>
      {/* Sprunglink für Tastatur und Vorleseprogramme (Barrierefreiheit B7) */}
      <a href="#inhalt" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-white focus:text-s112-blue-700 focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:font-semibold">Zum Inhalt springen</a>
      <ReleaseNotesModal />
      <SessionTimeout timeoutMinuten={(branding as any).session_timeout} />
      <AutoRefresh />
      {/* Betriebswechsel in einem anderen Tab erkennen und diesen Tab sperren (KAN-30) */}
      {/* KAN-5: im Nur-Lesen-Modus hält derselbe Wächter API- und Supabase-Schreibzugriffe im Browser
          zurück und meldet vom Server abgelehnte Server Actions (Hinweis: NurLesenHinweis) */}
      {membership?.tenantId && <BetriebsWaechter tenantId={membership.tenantId} name={seitenBetriebName} mandant={seitenMandant} schreibgesperrt={billingBlocked} />}
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
        /* KAN-5: im Nur-Lesen-Modus keine „Neu …“-Einstiege in der Befehlspalette – das Speichern
           würde ohnehin abgelehnt und die Eingaben eines ganzen Formulars gingen verloren */
        darfSchreiben={canWrite(role) && !billingBlocked}
        auswertungenSichtbar={canSeeAuswertungen(role)}
        mostgewichtEinheit={mostgewichtEinheit}
      >
        {/* Hinweisleisten: nie mitdrucken (print:hidden + data-print) – sonst stünden sie auf
            Rechnung, Lieferschein, Etiketten und Behördenausdrucken */}
        {mfaHinweis && (
          <div data-print="hide" className="print:hidden mb-4 px-4 py-2.5 rounded-lg bg-s112-blue-50 border border-s112-blue-100 text-s112-blue-700 text-sm flex items-center justify-between gap-3 flex-wrap">
            <span>Für Administratoren wird die Zwei-Faktor-Anmeldung ab {new Date(MFA_PFLICHT_AB + 'T00:00:00').toLocaleDateString('de-AT')} Pflicht. Richte sie jetzt in zwei Minuten ein.</span>
            <Link href="/zwei-faktor" className="font-semibold underline whitespace-nowrap">Jetzt einrichten →</Link>
          </div>
        )}
        {billingBlocked && (
          // Nur-Lesen-Modus (KAN-5): auf allen Seiten sichtbar, Seiten und Navigation bleiben unverändert
          <div role="status" data-print="hide" className="print:hidden mb-4 px-4 py-2.5 rounded-lg bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm flex items-center justify-between gap-3 flex-wrap">
            <span><strong className="font-semibold">{NUR_LESEN_TITEL}:</strong> {NUR_LESEN_BANNER} Ansehen, Drucken und Exportieren bleiben möglich.</span>
            <Link href="/abo" className="font-semibold underline whitespace-nowrap hover:text-s112-err-fg">Zum Abo →</Link>
          </div>
        )}
        {billingWarnung && (
          <div data-print="hide" className="print:hidden mb-4 px-4 py-2.5 rounded-lg bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg text-sm flex items-center justify-between gap-3 flex-wrap">
            <span>Es gibt ein Problem mit der letzten Zahlung für Ihr Abo. Bitte aktualisieren Sie Ihre Zahlungsdaten, um eine Sperre zu vermeiden.</span>
            <Link href="/abo" className="font-semibold underline whitespace-nowrap hover:text-s112-warn-fg">Zahlungsdaten verwalten →</Link>
          </div>
        )}
        {children}
      </AppShell>
      {/* KAN-5: Assistent kostet KI-Abfragen – im Nur-Lesen-Modus ausgeblendet */}
      {assistentAktiv && canWrite(role, 'kellerbuch') && !billingBlocked && <AssistentWidget />}
      {/* nach der AppShell: im DOM und in der Tab-Reihenfolge am Ende, wo er auch angezeigt wird */}
      {billingBlocked && <NurLesenHinweis />}
    </>
  )
}
