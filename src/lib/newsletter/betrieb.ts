import 'server-only'

// ── Newsletter je Betrieb (23.9.2026, Migration 227) ──────────────────────────
// Öffentliche Anmeldung unter /newsletter/<kurzname>. Jeder Betrieb nutzt sein eigenes
// Brevo-Konto (Administration › Mandant › Brevo). KAN-27 (06.10.2026): der Übergang über das
// Brevo-Konto aus der Umgebung (NEWSLETTER_TENANT_ID, BREVO_LIST_*) ist entfernt – das Konto in
// der Umgebung gehört IC&P und ist nur für System-Mails da.
import { createHmac, timingSafeEqual } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { geheimLesen } from '@/lib/email/geheimnis'
import { unterschluessel } from '@/lib/email/crypto'
import { barrierefreieAktionsfarbe } from '@/lib/farbe'
import type { BrevoZugang } from '@/lib/brevo/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const SEGMENTE = ['privat', 'gastronomie', 'handel', 'export', 'grosshandel'] as const
export type Segment = typeof SEGMENTE[number]

const LISTEN_SPALTE: Record<Segment, string> = {
  privat: 'brevo_list_privat', gastronomie: 'brevo_list_gastro', handel: 'brevo_list_handel',
  export: 'brevo_list_export', grosshandel: 'brevo_list_grossh',
}

export type NewsletterBetrieb = {
  tenantId:       string
  kurzname:       string | null
  name:           string
  logoUrl:        string | null
  /** Aktionsfarbe mit Kontrast ≥ 4,5 : 1 zu weißer Schrift */
  farbe:          string
  datenschutzUrl: string | null
  einleitung:     string | null
  aktiv:          boolean            // Modul an und Brevo-Zugang vorhanden
  zugang:         BrevoZugang | null
  listen:         Record<Segment, number | null>
}

const SPALTEN = 'tenant_id, anzeigename, logo_url, primary_color, modul_newsletter, brevo_api_key, brevo_sender_mail, brevo_sender_name, brevo_list_privat, brevo_list_gastro, brevo_list_handel, brevo_list_export, brevo_list_grossh, newsletter_kurzname, newsletter_datenschutz_url, newsletter_einleitung'

async function ausZeile(e: R): Promise<NewsletterBetrieb> {
  const admin = createSupabaseAdminClient()
  const { data: t } = await (admin.from('tenants') as any).select('name').eq('id', e.tenant_id).maybeSingle()
  const name = (e.anzeigename as string | null) || ((t as R | null)?.name as string | undefined) || 'Newsletter'

  let zugang: BrevoZugang | null = null
  let key: string | null = null
  try { key = geheimLesen(e.brevo_api_key) } catch { key = null }
  if (key && e.brevo_sender_mail) {
    zugang = { apiKey: key, senderMail: e.brevo_sender_mail, senderName: e.brevo_sender_name || name }
  }

  const listen = {} as Record<Segment, number | null>
  for (const s of SEGMENTE) {
    const v = e[LISTEN_SPALTE[s]] as number | null
    listen[s] = v ?? null
  }

  return {
    tenantId:       e.tenant_id,
    kurzname:       e.newsletter_kurzname ?? null,
    name,
    logoUrl:        e.logo_url ?? null,
    farbe:          barrierefreieAktionsfarbe(e.primary_color || '#2F63AC', '#FFFFFF'),
    datenschutzUrl: e.newsletter_datenschutz_url ?? null,
    einleitung:     e.newsletter_einleitung ?? null,
    aktiv:          !!e.modul_newsletter && !!zugang,
    zugang,
    listen,
  }
}

/** Für die öffentliche Seite: nur Betriebe mit Kurzname (aktiv-Prüfung macht der Aufrufer). */
export async function ladeNewsletterBetrieb(kurzname: string): Promise<NewsletterBetrieb | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(kurzname)) return null
  const admin = createSupabaseAdminClient()
  // tenant-isolation-ignore: öffentliche Seite – der Betrieb wird erst über seinen eindeutigen Kurznamen ermittelt
  const { data } = await (admin.from('tenant_einstellungen') as any)
    .select(SPALTEN).eq('newsletter_kurzname', kurzname).maybeSingle()
  return data ? ausZeile(data as R) : null
}

/** Für Bestätigung/Abmeldung (Betrieb ergibt sich aus dem Kontakt). */
export async function ladeNewsletterBetriebNachId(tenantId: string): Promise<NewsletterBetrieb | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await (admin.from('tenant_einstellungen') as any)
    .select(SPALTEN).eq('tenant_id', tenantId).maybeSingle()
  return data ? ausZeile(data as R) : null
}

// ── Abmeldelink: Kontakt-ID + HMAC statt E-Mail im Klartext ───────────────────
// Vorher /newsletter/abmelden?email=… – damit konnte jeder jede Adresse abmelden.

const abmeldeSig = (kontaktId: string) =>
  createHmac('sha256', unterschluessel('newsletter-abmelden')).update(kontaktId).digest('base64url')

export function abmeldeLink(basis: string, kontaktId: string): string {
  return `${basis}/newsletter/abmelden?k=${encodeURIComponent(kontaktId)}&t=${abmeldeSig(kontaktId)}`
}

export function pruefeAbmeldeToken(kontaktId: string, token: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(kontaktId) || !token) return false
  const a = Buffer.from(token), b = Buffer.from(abmeldeSig(kontaktId))
  return a.length === b.length && timingSafeEqual(a, b)
}
