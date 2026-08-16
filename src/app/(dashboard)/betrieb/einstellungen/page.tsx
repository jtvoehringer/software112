import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { getTenantMembers } from '../../benutzer/actions'
import EinstellungenClient from './EinstellungenClient'

export const metadata: Metadata = { title: 'Mein Betrieb – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type EigeneBetriebsdaten = {
  tenantId: string
  tenantName: string
  bio_status: string
  anzeigename: string | null
  logo_url: string | null
  primary_color: string
  secondary_color: string
  session_timeout_minuten: number | null
  betrieb_name: string | null
  betrieb_strasse: string | null
  betrieb_plz: string | null
  betrieb_ort: string | null
  betrieb_telefon: string | null
  betrieb_email: string | null
  betrieb_website: string | null
  betrieb_uid: string | null
  betrieb_betriebsnummer: string | null
  rechnung_iban: string | null
  rechnung_bic: string | null
  rechnung_fusstext: string | null
  bawb_kennung: string | null
  bawb_passwort: string | null
}

export default async function MeinBetriebPage() {
  const membership = await getCurrentMembership()
  if (!membership || !canAdmin(membership.role)) redirect('/dashboard')

  // Bewusst nur Branding-/Betriebsdaten-/bawb.at-Spalten selektieren - NICHT
  // brevo_*/sumup_*/email_*(smtp/imap)/m365_*/stripe_* usw., die bleiben
  // exklusiv der system_admin-Ansicht unter /admin/mandanten/[id] vorbehalten
  // (siehe Kommentar in ./actions.ts). Admin-Client nur, um konsistent mit den
  // Schreib-Aktionen zu bleiben - die Auswahl der Spalten selbst ist die
  // eigentliche Sicherheitsgrenze hier, nicht RLS.
  const admin = createSupabaseAdminClient()
  const [{ data: tenantRaw }, { data: settingsRaw }, members] = await Promise.all([
    (admin.from('tenants') as any).select('id, name, bio_status').eq('id', membership.tenantId).single(),
    (admin.from('tenant_einstellungen') as any)
      .select(`
        anzeigename, logo_url, primary_color, secondary_color, session_timeout_minuten,
        betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon,
        betrieb_email, betrieb_website, betrieb_uid, betrieb_betriebsnummer,
        rechnung_iban, rechnung_bic, rechnung_fusstext,
        bawb_kennung, bawb_passwort
      `)
      .eq('tenant_id', membership.tenantId)
      .maybeSingle(),
    getTenantMembers(),
  ])

  if (!tenantRaw) redirect('/dashboard')

  const t = tenantRaw as R
  const s = settingsRaw as R | null

  const daten: EigeneBetriebsdaten = {
    tenantId:   t.id,
    tenantName: t.name,
    bio_status: t.bio_status ?? 'konventionell',
    anzeigename:      s?.anzeigename ?? null,
    logo_url:         s?.logo_url ?? null,
    primary_color:    s?.primary_color ?? '#4F86D6',
    secondary_color:  s?.secondary_color ?? '#FFFFFF',
    session_timeout_minuten: s?.session_timeout_minuten ?? null,
    betrieb_name:      s?.betrieb_name ?? null,
    betrieb_strasse:   s?.betrieb_strasse ?? null,
    betrieb_plz:       s?.betrieb_plz ?? null,
    betrieb_ort:       s?.betrieb_ort ?? null,
    betrieb_telefon:   s?.betrieb_telefon ?? null,
    betrieb_email:     s?.betrieb_email ?? null,
    betrieb_website:   s?.betrieb_website ?? null,
    betrieb_uid:       s?.betrieb_uid ?? null,
    betrieb_betriebsnummer: s?.betrieb_betriebsnummer ?? null,
    rechnung_iban:     s?.rechnung_iban ?? null,
    rechnung_bic:      s?.rechnung_bic ?? null,
    rechnung_fusstext: s?.rechnung_fusstext ?? null,
    bawb_kennung:      s?.bawb_kennung ?? null,
    bawb_passwort:     s?.bawb_passwort ?? null,
  }

  return (
    <EinstellungenClient
      daten={daten}
      members={members}
      isSystemAdmin={membership.role === 'system_admin'}
    />
  )
}
