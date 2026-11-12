import 'server-only'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership } from '@/lib/auth/roles'
import { premiumSupportAktiv } from '@/lib/abo/premiumSupport'
import { supportOrganisation } from '@/lib/support/anfrage'
import { AktionsFehler } from '@/lib/fehler'
import { kontoZurEmail, type SupportZugriff } from '@/lib/support/jsm'

// Gemeinsamer Kontext der Support-Routen (/api/support/anfragen …): angemeldeter Benutzer mit E-Mail, aktiver Betrieb,
// Premium-Support, Namen für JSM. Ohne Anmeldung bzw. Betrieb eine fertige Fehlerantwort.
//
// KAN-214 (Jörgen 08.10.2026): Anfragen aus einem Submandanten laufen in JSM unter dem Hauptmandanten (Organisation =
// Hauptmandant, z. B. Spaetrot Gebeshuber GmbH → Weingut Johannes Gebeshuber); der Premium-Support des Hauptmandanten
// gilt für seine Submandanten mit. Den Hauptmandanten liest der Admin-Client (RLS zeigt fremde Betriebe nicht), nur
// Name und Premium-Support-Zeitraum.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const KEIN_CACHE = { 'Cache-Control': 'no-store' }

export async function supportKontext() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { fehler: NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401, headers: KEIN_CACHE }) } as const
  const membership = await getCurrentMembership()
  if (!membership) return { fehler: NextResponse.json({ fehler: 'Kein Betrieb ausgewählt' }, { status: 403, headers: KEIN_CACHE }) } as const
  const [{ data: t, error: tErr }, { data: p, error: pErr }] = await Promise.all([
    (supabase.from('tenants') as R).select('name, premium_support_seit, premium_support_bis, abrechnung_ueber').eq('id', membership.tenantId).maybeSingle(),
    (supabase.from('profiles') as R).select('full_name').eq('id', user.id).maybeSingle(),
  ])
  if ((tErr ?? pErr)) throw new AktionsFehler(`Daten konnten nicht geladen werden: ${(tErr ?? pErr).message}`)
  const hauptId = ((t as R | null)?.abrechnung_ueber as string | null | undefined) ?? null
  const { data: h } = hauptId
    ? await (createSupabaseAdminClient().from('tenants') as R).select('name, premium_support_seit, premium_support_bis').eq('id', hauptId).maybeSingle()
    : { data: null }
  const premium = premiumSupportAktiv({ seit: (t as R | null)?.premium_support_seit ?? null, bis: (t as R | null)?.premium_support_bis ?? null })
    || (!!h && premiumSupportAktiv({ seit: (h as R).premium_support_seit ?? null, bis: (h as R).premium_support_bis ?? null }))
  const betriebName = ((t as R | null)?.name as string | undefined) ?? 'Unbekannter Betrieb'
  const hauptName = ((h as R | null)?.name as string | undefined) ?? null
  return {
    user, membership, premium,
    betriebName,
    /** JSM-Organisation: Hauptmandant bzw. der Betrieb selbst */
    organisationName: supportOrganisation(betriebName, hauptName),
    hauptName,
    benutzerName: (((p as R | null)?.full_name as string | null | undefined) ?? '').trim() || null,
  } as const
}

/**
 * KAN-438: Wessen Anfragen darf der Benutzer sehen? Alle Betriebe, in denen er aktives Mitglied ist (Entscheidung
 * Jörgen 12.11.2026: jedes Mitglied sieht alle Anfragen seiner Betriebe), dazu die JSM-Organisationen, unter denen
 * diese Betriebe laufen (Submandanten unter dem Hauptmandanten, KAN-214) – die Organisation grenzt nur die Suche ein,
 * den Zugriff entscheidet die Mandanten-ID der Anfrage (lib/support/tickets.ts).
 */
export async function supportZugriff(userId: string, email: string): Promise<SupportZugriff> {
  const supabase = await createSupabaseServerClient()
  // tenant-isolation-ignore: eigene aktive Mitgliedschaften über alle Betriebe (user_id) – genau das ist hier gefragt
  const { data: m, error: mErr } = await (supabase.from('tenant_memberships') as R)
    .select('tenant_id').eq('user_id', userId).eq('aktiv', true).order('tenant_id')
  if (mErr) throw new AktionsFehler(`Daten konnten nicht geladen werden: ${mErr.message}`)
  const ids = [...new Set(((m ?? []) as R[]).map(x => String(x.tenant_id)))]
  const betriebe = new Map<string, string>()
  const organisationen = new Set<string>()
  if (ids.length > 0) {
    // alle-ausnahme: die Betriebe EINES Benutzers (eigene Mitgliedschaften) – eine Handvoll, keine wachsende Menge
    const { data: t, error: tErr } = await (supabase.from('tenants') as R).select('id, name, abrechnung_ueber').in('id', ids).order('id')
    if (tErr) throw new AktionsFehler(`Daten konnten nicht geladen werden: ${tErr.message}`)
    const zeilen = (t ?? []) as R[]
    const hauptIds = [...new Set(zeilen.map(x => x.abrechnung_ueber as string | null).filter((x): x is string => !!x))]
    // Hauptmandanten liest der Admin-Client (RLS zeigt fremde Betriebe nicht) – nur der Name, wie in supportKontext()
    const { data: h, error: hErr } = hauptIds.length
      ? await (createSupabaseAdminClient().from('tenants') as R).select('id, name').in('id', hauptIds).order('id')
      : { data: [], error: null }
    if (hErr) throw new AktionsFehler(`Daten konnten nicht geladen werden: ${hErr.message}`)
    const haupt = new Map(((h ?? []) as R[]).map(x => [String(x.id), String(x.name ?? '')]))
    for (const x of zeilen) {
      const name = String(x.name ?? 'Unbekannter Betrieb')
      betriebe.set(String(x.id).toLowerCase(), name)
      organisationen.add(supportOrganisation(name, x.abrechnung_ueber ? haupt.get(String(x.abrechnung_ueber)) ?? null : null))
    }
  }
  return { accountId: await kontoZurEmail(email), betriebe, organisationen: [...organisationen].filter(Boolean) }
}
