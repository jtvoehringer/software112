import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { csvDatei, csvDateiname, PROFIL_EXCEL_AT } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { heuteWien } from '@/lib/datum/wien'
import { ladeJournal } from '@/lib/journal/laden'
import { SPALTEN_JOURNAL, journalFilter } from '@/lib/journal/journal'

export const dynamic = 'force-dynamic'

// Journal als CSV (KAN-332): dieselben Filter und dieselbe Ladefunktion wie /dashboard/journal. Rechte wie die Seite:
// jedes Mitglied – Mitarbeiter bekommen nur ihre eigenen Vorgänge (auch per RLS), die Betriebsleitung alle.
// GET ohne Seiteneffekte; 0 Zeilen = nur Kopfzeile.
export async function GET(request: Request) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return fehlerAntwort(401, 'Kein Betrieb')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fehlerAntwort(401, 'Nicht angemeldet')

  const sp = Object.fromEntries(new URL(request.url).searchParams)
  const f = journalFilter(sp, heuteWien())
  try {
    const { zeilen } = await ladeJournal(supabase, { tenantId: membership.tenantId, userId: user.id, role: membership.role }, f)
    const csv = csvDatei(zeilen, SPALTEN_JOURNAL, PROFIL_EXCEL_AT)
    return csvAntwort(csv.text, csvDateiname(['journal', f.von, f.bis]), csv.zeilen, csv.warnungen)
  } catch {
    return fehlerAntwort(500, 'Journal konnte nicht exportiert werden')
  }
}
