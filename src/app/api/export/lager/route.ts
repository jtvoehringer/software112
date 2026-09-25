import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { darfDatenexport } from '@/lib/auth/modul'
import { alle } from '@/lib/supabase/alle'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { csvDateiname } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { lagerCsv } from '@/lib/export/datenexporte'
import { getRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'

export const dynamic = 'force-dynamic'

// Lagerbestand als CSV (Controlling → Datenexport). Rechte (KAN-54): Datenexport-Recht –
// Modul Controlling + Auswertungen, wie das Layout von /controlling/export.
// CSV über den Baustein (PROFIL_EXCEL_AT, Spalten in lib/export/datenexporte.ts).
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return fehlerAntwort(401, 'Kein Betrieb')
  if (!(await darfDatenexport(membership)))
    return fehlerAntwort(403, 'Datenexport nicht freigeschaltet (Modul Controlling und Recht „Auswertungen“ nötig)')

  const supabase = await createSupabaseServerClient()
  const { data, error } = await alle((supabase.from('fuellungen') as any)
    .select('name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, aktiv')
    .eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id'))
  // alle() statt 1.000er-Deckel; bei einem Fehler kein halber Export
  if (error) return fehlerAntwort(500, 'Export fehlgeschlagen')

  const csv = lagerCsv(data ?? [], getRebsorteKuerzel)
  return csvAntwort(csv.text, csvDateiname(['lagerbestand']), csv.zeilen, csv.warnungen)
}
