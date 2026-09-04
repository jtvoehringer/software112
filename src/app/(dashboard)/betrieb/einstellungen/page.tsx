import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { getTenantMembers } from '../../benutzer/actions'
import EinstellungenClient from './EinstellungenClient'
import { pruefeBenutzerlimit } from '@/lib/pakete-server'
import { paketAusPlan } from '@/lib/pakete'

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
  // Migration 179 – Dashboard-Regeln je Betrieb
  gaerung_messintervall_tage: number
  fristen_vorwarnung_tage: number
  betrieb_name: string | null
  betrieb_strasse: string | null
  betrieb_plz: string | null
  betrieb_ort: string | null
  betrieb_telefon: string | null
  betrieb_email: string | null
  betrieb_website: string | null
  betrieb_uid: string | null
  betrieb_betriebsnummer: string | null
  // Migration 180 – Betriebsbeginn/Systemstart der E&A-Rechnung
  ea_betriebsbeginn: string | null
  modul_ea: boolean
  rechnung_iban: string | null
  rechnung_bic: string | null
  rechnung_fusstext: string | null
  bawb_kennung: string | null
  bawb_passwort: string | null
  // Abo & Paket (Rückmeldung 4.9.2026): Betriebsleiter sieht sein Paket und
  // kommt von hier zu /abo (Wechsel, Zahlungsdaten, Buchhaltungsart)
  paket: string | null
  stripe_status: string | null
  buchhaltungsart: 'ea' | 'doppik'
  max_benutzer: number | null
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
  const [{ data: tenantRaw }, { data: settingsRaw }, members, benutzerlimit] = await Promise.all([
    (admin.from('tenants') as any).select('id, name, bio_status, stripe_plan, stripe_status, max_benutzer').eq('id', membership.tenantId).single(),
    (admin.from('tenant_einstellungen') as any)
      .select(`
        anzeigename, logo_url, primary_color, secondary_color, session_timeout_minuten,
        gaerung_messintervall_tage, fristen_vorwarnung_tage,
        betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon,
        betrieb_email, betrieb_website, betrieb_uid, betrieb_betriebsnummer, ea_betriebsbeginn, modul_ea, buchhaltungsart,
        rechnung_iban, rechnung_bic, rechnung_fusstext,
        bawb_kennung, bawb_passwort
      `)
      .eq('tenant_id', membership.tenantId)
      .maybeSingle(),
    getTenantMembers(),
    pruefeBenutzerlimit(admin, membership.tenantId),
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
    gaerung_messintervall_tage: Number(s?.gaerung_messintervall_tage ?? 3),
    fristen_vorwarnung_tage:    Number(s?.fristen_vorwarnung_tage ?? 30),
    betrieb_name:      s?.betrieb_name ?? null,
    betrieb_strasse:   s?.betrieb_strasse ?? null,
    betrieb_plz:       s?.betrieb_plz ?? null,
    betrieb_ort:       s?.betrieb_ort ?? null,
    betrieb_telefon:   s?.betrieb_telefon ?? null,
    betrieb_email:     s?.betrieb_email ?? null,
    betrieb_website:   s?.betrieb_website ?? null,
    betrieb_uid:       s?.betrieb_uid ?? null,
    betrieb_betriebsnummer: s?.betrieb_betriebsnummer ?? null,
    ea_betriebsbeginn: s?.ea_betriebsbeginn ?? null,
    modul_ea:          !!(s?.modul_ea),
    rechnung_iban:     s?.rechnung_iban ?? null,
    rechnung_bic:      s?.rechnung_bic ?? null,
    rechnung_fusstext: s?.rechnung_fusstext ?? null,
    bawb_kennung:      s?.bawb_kennung ?? null,
    bawb_passwort:     s?.bawb_passwort ?? null,
    paket:             paketAusPlan(t.stripe_plan) ?? null,
    stripe_status:     t.stripe_status ?? null,
    buchhaltungsart:   s?.buchhaltungsart === 'doppik' ? 'doppik' : 'ea',
    max_benutzer:      t.max_benutzer ?? null,
  }

  return (
    <EinstellungenClient
      daten={daten}
      members={members}
      benutzerlimit={benutzerlimit}
      isSystemAdmin={membership.role === 'system_admin'}
    />
  )
}
