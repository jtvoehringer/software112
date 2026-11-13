import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { dbFehlerText } from '@/lib/fehler'
import { leseKonflikt } from '@/lib/api/lesebereich'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// GET fehlte bisher komplett - der Client konnte den gespeicherten Wert nie
// wieder laden (monitoredEmail-State startete immer leer), wodurch die
// Funktion nach jedem Neuladen der Seite unsichtbar wirkte, obwohl sie
// serverseitig (list/message/folders/unified-Routen) längst aktiv war.
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    const leseSperre = leseKonflikt(membership, 'crm')   // KAN-455: Lesebereich je Profil
    if (leseSperre) return leseSperre
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await (supabase.from('user_email_connections') as any)
      .select('monitored_email, email_spiegel_stand, email_spiegel_info')
      .eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle()
    if (error) return NextResponse.json({ fehler: `Postfach-Verbindung konnte nicht geladen werden: ${dbFehlerText(error)}` }, { status: 500 })

    const d = data as R | null
    return NextResponse.json({ monitored_email: d?.monitored_email ?? null, spiegel_stand: d?.email_spiegel_stand ?? null, spiegel_info: d?.email_spiegel_info ?? null })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const { monitored_email } = await req.json()
    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    const leseSperre = leseKonflikt(membership, 'crm')   // KAN-455: Lesebereich je Profil
    if (leseSperre) return leseSperre
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
    if (gesperrt) return gesperrt
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    const adresse = typeof monitored_email === 'string' ? monitored_email.trim() : ''

    // KAN-135: Benutzer haben auf user_email_connections kein UPDATE mehr – die App schreibt
    // per Service-Role, eingeschränkt auf die eigene Zeile (tenant_id aus der Mitgliedschaft,
    // user_id aus getUser()) und nur dieses eine Feld
    const { error } = await (createSupabaseAdminClient().from('user_email_connections') as any)
      .update({ monitored_email: adresse || null, aktualisiert_am: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('user_id', user.id)
    if (error) return NextResponse.json({ fehler: dbFehlerText(error) }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}
