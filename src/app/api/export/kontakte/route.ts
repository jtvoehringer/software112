import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { darfDatenexport } from '@/lib/auth/modul'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { csvDateiname } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { kontakteCsv } from '@/lib/export/datenexporte'

export const dynamic = 'force-dynamic'

// Kontakte als CSV – aus Controlling → Datenexport und vom CSV-Knopf der Kontaktliste.
// Rechte (KAN-54): Datenexport-Recht (Modul Controlling + Auswertungen) oder
// Schreibrecht im CRM (nur dann zeigt die Kontaktliste den Knopf).
// CSV über den Baustein (PROFIL_EXCEL_AT, Spalten in lib/export/datenexporte.ts).
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return fehlerAntwort(401, 'Kein Betrieb')
  if (!canWrite(membership, 'crm') && !(await darfDatenexport(membership)))
    return fehlerAntwort(403, 'Kein Recht für den Export der Kontakte')

  const supabase = await createSupabaseServerClient()
  const { data, error } = await alle((supabase.from('kontakte') as any)
    .select('accountnummer, vorname, nachname, segment, email, email_weitere, telefon, telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, stammkunde, is_lead, sonderrabatt_pct, notizen, erstellt_am, position, quelle')
    .eq('tenant_id', tenantId).eq('aktiv', true).order('nachname').order('id'))
  // alle() liefert bei einem Fehler die bis dahin geholten Blöcke – kein halber Export
  if (error) return fehlerAntwort(500, 'Export fehlgeschlagen')

  const csv = kontakteCsv(data ?? [])
  return csvAntwort(csv.text, csvDateiname(['kontakte']), csv.zeilen, csv.warnungen)
}
