// ── Outlook-Verbindung des angemeldeten Benutzers (server-only) ───────────────
// Bündelt, was die Kalender-Routen brauchen: Verbindung des Benutzers, App-Daten
// des Betriebs, gültiger Access-Token, Schreibrecht, Adressen der Kollegen.

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership } from '@/lib/auth/roles'
import { getValidUserAccessToken, hatKalenderSchreibrecht } from '@/lib/m365/graph'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type OutlookGrund = 'nicht_angemeldet' | 'kein_betrieb' | 'nicht_verbunden' | 'token'

export type OutlookVerbindung = {
  tenantId: string
  userId: string
  token: string
  /** Verbindung hat Calendars.ReadWrite (Migration 225) */
  schreiben: boolean
  /** Der Betrieb hat den Schalter „Termine in Outlook anlegen“ gesetzt */
  schreibenAktiv: boolean
  eigeneEmail: string | null
}

export async function ladeOutlookVerbindung(): Promise<{ ok: true; v: OutlookVerbindung } | { ok: false; grund: OutlookGrund; meldung?: string }> {
  const supabase = await createSupabaseServerClient()
  const admin = createSupabaseAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, grund: 'nicht_angemeldet' }
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return { ok: false, grund: 'kein_betrieb' }

  const [{ data: cfg }, { data: tenantCfg }] = await Promise.all([
    (supabase.from('user_email_connections') as any)
      .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_scope, email_address')
      .eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle(),
    (admin.from('tenant_einstellungen') as any)
      .select('m365_tenant_id, m365_client_id, m365_client_secret_enc, m365_kalender_schreiben')
      .eq('tenant_id', tenantId).maybeSingle(),
  ])
  const c = cfg as R | null
  if (!c?.m365_aktiv || !c?.m365_access_token_enc) return { ok: false, grund: 'nicht_verbunden' }
  try {
    const token = await getValidUserAccessToken(c, tenantCfg as R, supabase, tenantId, user.id)
    return { ok: true, v: {
      tenantId, userId: user.id, token,
      schreiben: hatKalenderSchreibrecht(c),
      schreibenAktiv: !!(tenantCfg as R | null)?.m365_kalender_schreiben,
      eigeneEmail: (c.email_address as string | null) ?? null,
    } }
  } catch (err) {
    return { ok: false, grund: 'token', meldung: err instanceof Error ? err.message : String(err) }
  }
}

export type OutlookStatus = {
  verbunden: boolean
  schreiben: boolean
  schreibenAktiv: boolean
  kollegen: { id: string; name: string }[]
}

/** Leichter Status ohne Token-Refresh – für den Termin-Dialog (Server Component) */
export async function ladeOutlookStatus(tenantId: string, userId: string): Promise<OutlookStatus> {
  const supabase = await createSupabaseServerClient()
  const admin = createSupabaseAdminClient()
  const [{ data: cfg }, { data: tenantCfg }, kollegen] = await Promise.all([
    (supabase.from('user_email_connections') as any).select('m365_aktiv, m365_scope').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    (admin.from('tenant_einstellungen') as any).select('m365_kalender_schreiben').eq('tenant_id', tenantId).maybeSingle(),
    ladeOutlookKollegen(tenantId, userId),
  ])
  const c = cfg as R | null
  return {
    verbunden: !!c?.m365_aktiv,
    schreiben: hatKalenderSchreibrecht(c),
    schreibenAktiv: !!(tenantCfg as R | null)?.m365_kalender_schreiben,
    kollegen: kollegen.map(k => ({ id: k.id, name: k.name })),
  }
}

export type OutlookKollege = { id: string; email: string; name: string }

/** Mitglieder des Betriebs mit verbundenem Outlook-Konto (für Einladungen und Frei/Belegt) */
export async function ladeOutlookKollegen(tenantId: string, ohneUserId?: string | null): Promise<OutlookKollege[]> {
  const admin = createSupabaseAdminClient()
  const { data } = await (admin.from('user_email_connections') as any)
    .select('user_id, email_address, anzeigename')
    .eq('tenant_id', tenantId).eq('m365_aktiv', true)
  return ((data ?? []) as R[])
    .filter(r => r.email_address && r.user_id !== ohneUserId)
    .map(r => ({ id: r.user_id as string, email: r.email_address as string, name: (r.anzeigename as string) || (r.email_address as string) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
