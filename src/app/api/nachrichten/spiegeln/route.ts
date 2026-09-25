import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership } from '@/lib/auth/roles'
import { spiegleMailboxen } from '@/lib/email/spiegel'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'

// „Jetzt spiegeln“ (Nachrichten › Einstellungen, 18.9.2026): E-Mails des eigenen
// Postfachs (und der geteilten Mailbox) seit dem letzten Stand als Aktivitäten
// zu bekannten Kontakten/Firmen anlegen - nur die eigene Verbindung, kein
// System-Admin nötig (im Gegensatz zu /api/email/spiegel für alle Postfächer).
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ?voll=1: Stand zurücksetzen und die letzten 90 Tage komplett neu prüfen -
// z.B. nachdem eine geteilte Mailbox erst nachträglich lesbar wurde (403 →
// Berechtigung ergänzt), denn der Stand war inzwischen schon vorgerückt.
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  if (!membership) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  if (req.nextUrl.searchParams.get('voll') === '1') {
    await (createSupabaseAdminClient().from('user_email_connections') as any)
      .update({ email_spiegel_stand: null }).eq('tenant_id', membership.tenantId).eq('user_id', user.id)
  }
  const erg = await spiegleMailboxen((maxDuration - 8) * 1000, membership.tenantId, user.id)
  return NextResponse.json(erg)
}
