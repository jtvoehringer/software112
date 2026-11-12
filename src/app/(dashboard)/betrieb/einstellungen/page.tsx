import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { getTenantMembers } from '../../benutzer/actions'
import EinstellungenClient from './EinstellungenClient'
import { geheimMaskiert } from '@/lib/email/geheimnis'
import { pruefeBenutzerlimit } from '@/lib/pakete-server'
import { paketAusPlan } from '@/lib/pakete'
import type { MostgewichtEinheit } from '@/lib/wein/mostgewicht'

export const metadata: Metadata = { title: 'Mein Betrieb' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type EigeneBetriebsdaten = {
  tenantId: string
  tenantName: string
  kundennummer: string | null
  bio_status: string
  anzeigename: string | null
  logo_url: string | null
  primary_color: string
  secondary_color: string
  session_timeout_minuten: number | null
  // Migration 179 – Dashboard-Regeln je Betrieb
  gaerung_messintervall_tage: number
  fristen_vorwarnung_tage: number
  psm_erfassungsfrist_h: number
  auftrag_reservierung_tage: number
  // Morgenbericht & Wetter (Migration 201)
  morgenbericht_aktiv: boolean
  wetter_aktiv: boolean
  wetter_abwasch_mm: number
  wetter_intervall_tage: number
  betrieb_name: string | null
  betrieb_strasse: string | null
  betrieb_plz: string | null
  betrieb_ort: string | null
  betrieb_telefon: string | null
  betrieb_email: string | null
  betrieb_website: string | null
  betrieb_uid: string | null
  betrieb_eori: string | null
  kleiner_weinerzeuger: boolean
  export_flaschen_je_karton: number
  betrieb_betriebsnummer: string | null
  betriebsart: string | null   // KAN-261
  // KAN-48 AP11: BKI-Betriebsdaten
  betrieb_rechtsform: string | null
  betrieb_vorname: string | null
  betrieb_nachname: string | null
  betrieb_betriebsstaette: string | null
  // Migration 180 – Betriebsbeginn/Systemstart der E&A-Rechnung
  ea_betriebsbeginn: string | null
  modul_ea: boolean
  rechnung_iban: string | null
  rechnung_bic: string | null
  rechnung_fusstext: string | null
  bawb_kennung: string | null
  bawb_passwort: string | null
  // Kellerwirtschaft (KAN-128): bevorzugte Mostgewicht-Einheit
  mostgewicht_einheit: MostgewichtEinheit
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
  const [tenantRawRes, settingsRawRes, members, benutzerlimit] = await Promise.all([
    (admin.from('tenants') as any).select('id, name, kundennummer, bio_status, stripe_plan, stripe_status, max_benutzer').eq('id', membership.tenantId).maybeSingle(),
    (admin.from('tenant_einstellungen') as any)
      .select(`
        anzeigename, logo_url, primary_color, secondary_color, session_timeout_minuten,
        gaerung_messintervall_tage, fristen_vorwarnung_tage, psm_erfassungsfrist_h, auftrag_reservierung_tage, morgenbericht_aktiv, wetter_aktiv, wetter_abwasch_mm, wetter_intervall_tage,
        betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon,
        betrieb_email, betrieb_website, betrieb_uid, betrieb_eori, kleiner_weinerzeuger, export_flaschen_je_karton, betrieb_betriebsnummer, betriebsart, betrieb_rechtsform, betrieb_vorname, betrieb_nachname, betrieb_betriebsstaette, ea_betriebsbeginn, modul_ea, buchhaltungsart,
        rechnung_iban, rechnung_bic, rechnung_fusstext,
        bawb_kennung, bawb_passwort, mostgewicht_einheit
      `)
      .eq('tenant_id', membership.tenantId)
      .maybeSingle(),
    getTenantMembers(),
    pruefeBenutzerlimit(admin, membership.tenantId),
  ])
  const tenantRaw = geladen(tenantRawRes, 'Betrieb')
  const settingsRaw = geladen(settingsRawRes, 'Einstellungen')

  if (!tenantRaw) redirect('/dashboard')

  const t = tenantRaw as R
  const s = settingsRaw as R | null

  const daten: EigeneBetriebsdaten = {
    tenantId:   t.id,
    tenantName: t.name,
    kundennummer: (t.kundennummer as string | null) ?? null,
    bio_status: t.bio_status ?? 'konventionell',
    anzeigename:      s?.anzeigename ?? null,
    logo_url:         s?.logo_url ?? null,
    primary_color:    s?.primary_color ?? '#4F86D6',
    secondary_color:  s?.secondary_color ?? '#FFFFFF',
    session_timeout_minuten: s?.session_timeout_minuten ?? null,
    gaerung_messintervall_tage: Number(s?.gaerung_messintervall_tage ?? 3),
    fristen_vorwarnung_tage:    Number(s?.fristen_vorwarnung_tage ?? 30),
    psm_erfassungsfrist_h:      Number(s?.psm_erfassungsfrist_h ?? 24),
    auftrag_reservierung_tage:  Number(s?.auftrag_reservierung_tage ?? 14),
    morgenbericht_aktiv: s?.morgenbericht_aktiv !== false,
    wetter_aktiv: s?.wetter_aktiv !== false,
    wetter_abwasch_mm: Number(s?.wetter_abwasch_mm ?? 25),
    wetter_intervall_tage: Number(s?.wetter_intervall_tage ?? 14),
    betrieb_name:      s?.betrieb_name ?? null,
    betrieb_strasse:   s?.betrieb_strasse ?? null,
    betrieb_plz:       s?.betrieb_plz ?? null,
    betrieb_ort:       s?.betrieb_ort ?? null,
    betrieb_telefon:   s?.betrieb_telefon ?? null,
    betrieb_email:     s?.betrieb_email ?? null,
    betrieb_website:   s?.betrieb_website ?? null,
    betrieb_uid:       s?.betrieb_uid ?? null,
    betrieb_eori:      s?.betrieb_eori ?? null,
    kleiner_weinerzeuger: !!s?.kleiner_weinerzeuger,
    export_flaschen_je_karton: Number(s?.export_flaschen_je_karton ?? 6),
    betrieb_betriebsnummer: s?.betrieb_betriebsnummer ?? null,
    betriebsart: s?.betriebsart ?? null,
    betrieb_rechtsform: s?.betrieb_rechtsform ?? null,
    betrieb_vorname: s?.betrieb_vorname ?? null,
    betrieb_nachname: s?.betrieb_nachname ?? null,
    betrieb_betriebsstaette: s?.betrieb_betriebsstaette ?? null,
    ea_betriebsbeginn: s?.ea_betriebsbeginn ?? null,
    modul_ea:          !!(s?.modul_ea),
    rechnung_iban:     s?.rechnung_iban ?? null,
    rechnung_bic:      s?.rechnung_bic ?? null,
    rechnung_fusstext: s?.rechnung_fusstext ?? null,
    bawb_kennung:      s?.bawb_kennung ?? null,
    bawb_passwort:     geheimMaskiert(s?.bawb_passwort),   // KAN-135: nur „hinterlegt ja/nein“, nie der Klartext
    mostgewicht_einheit: s?.mostgewicht_einheit === 'oechsle' ? 'oechsle' : 'kmw',
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
