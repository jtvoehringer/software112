import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { m365AuthUrl } from '@/lib/m365/graph'
import { erzeugeStateWert, setzeNonceCookie } from '@/lib/m365/state'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperre } from '@/lib/auth/sperren'
import { sperrAntwortKoerper } from '@/lib/abo/regeln'
import { dbFehlerText } from '@/lib/fehler'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  // Die Betriebs-Mailbox darf nur ein Admin verbinden
  if (membership?.role !== 'system_admin' && membership?.role !== 'tenant_admin')
    return NextResponse.json({ fehler: 'Nur Administratoren' }, { status: 403 })
  // KAN-5: Betriebs-Postfach verbinden speichert Tokens in tenant_einstellungen – nicht im Nur-Lesen-Modus
  if (await schreibSperre(membership)) return NextResponse.json(sperrAntwortKoerper(), { status: 403 })

  const { data: cfg, error: cfgErr } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_tenant_id, m365_client_id').eq('tenant_id', tenantId).maybeSingle()
  if (cfgErr) return NextResponse.json({ fehler: `M365-Einstellungen konnten nicht geladen werden: ${dbFehlerText(cfgErr)}` }, { status: 500 })
  const c = cfg as R | null
  if (!c?.m365_tenant_id || !c?.m365_client_id)
    return NextResponse.redirect(new URL('/admin/mandanten', req.url))

  // Host aus dem Request ableiten → funktioniert für localhost UND Production
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const redirectUri = `${proto}://${host}/api/auth/m365/callback`
  // Signierter State + Einmal-Wert im Cookie (Sicherheits-Welle 1, Befund S1)
  const { state, nonce } = erzeugeStateWert({ tenantId, userId: user.id, zweck: 'betrieb' })
  const authUrl = m365AuthUrl(c.m365_tenant_id, c.m365_client_id, redirectUri, state)

  return setzeNonceCookie(NextResponse.redirect(authUrl), nonce)
}
