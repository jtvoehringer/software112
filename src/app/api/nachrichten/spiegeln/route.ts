import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { spiegleMailboxen } from '@/lib/email/spiegel'

// „Jetzt spiegeln“ (Nachrichten › Einstellungen, 18.9.2026): E-Mails des eigenen
// Postfachs (und der geteilten Mailbox) seit dem letzten Stand als Aktivitäten
// zu bekannten Kontakten/Firmen anlegen - nur die eigene Verbindung, kein
// System-Admin nötig (im Gegensatz zu /api/email/spiegel für alle Postfächer).
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const membership = await getCurrentMembership()
  if (!membership) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  const erg = await spiegleMailboxen((maxDuration - 8) * 1000, membership.tenantId, user.id)
  return NextResponse.json(erg)
}
