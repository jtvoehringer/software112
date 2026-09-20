import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { graphPost, getValidAccessToken } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  try {
    const { an, betreff, text, kontakt_id, firma_id } = await req.json()
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()

    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
      .select('m365_modul_aktiv, m365_tenant_id, m365_client_id, m365_client_secret_enc, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_user_email, tenant_id')
      .eq('tenant_id', tenantId).maybeSingle()
    const c = cfg as R | null
    if (!c?.m365_modul_aktiv) return NextResponse.json({ fehler: 'M365-Modul nicht aktiv' }, { status: 400 })

    const accessToken = await getValidAccessToken(c, admin)

    await graphPost(accessToken, '/me/sendMail', {
      message: {
        subject: betreff,
        body: { contentType: 'Text', content: text ?? '' },
        toRecipients: [{ emailAddress: { address: an } }],
      },
      saveToSentItems: true,
    })

    // Aktivität anlegen
    { const { error: e } = await (admin.from('aktivitaeten') as any).insert({
      tenant_id: tenantId, kontakt_id: kontakt_id ?? null, firma_id: firma_id ?? null,
      art: 'email', betreff, beschreibung: text?.slice(0, 200) ?? null,
      datum: new Date().toISOString().split('T')[0], erledigt: true, ganztags: true,
    })
      if (e) void ereignisMelden({ art: 'db', quelle: 'send/aktivitaeten', meldung: e.message }) }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
