import 'server-only'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership } from '@/lib/auth/roles'
import { premiumSupportAktiv } from '@/lib/abo/premiumSupport'
import { supportOrganisation } from '@/lib/support/anfrage'

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
  const [{ data: t }, { data: p }] = await Promise.all([
    (supabase.from('tenants') as R).select('name, premium_support_seit, premium_support_bis, abrechnung_ueber').eq('id', membership.tenantId).maybeSingle(),
    (supabase.from('profiles') as R).select('full_name').eq('id', user.id).maybeSingle(),
  ])
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
