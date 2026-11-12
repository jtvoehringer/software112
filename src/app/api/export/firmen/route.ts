import type { NextRequest } from 'next/server'
import { importFilterAus } from '@/lib/crm/importBezeichnung'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { darfDatenexport } from '@/lib/auth/modul'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { csvDateiname } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { firmenCsv } from '@/lib/export/datenexporte'

export const dynamic = 'force-dynamic'

// Firmen als CSV – aus Controlling → Datenexport und vom CSV-Knopf der Firmenliste.
// Rechte (KAN-54): Datenexport-Recht (Modul Controlling + Auswertungen) oder
// Schreibrecht im CRM (nur dann zeigt die Firmenliste den Knopf).
// CSV über den Baustein (PROFIL_EXCEL_AT, Spalten in lib/export/datenexporte.ts).
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return fehlerAntwort(401, 'Kein Betrieb')
  if (!canWrite(membership, 'crm') && !(await darfDatenexport(membership)))
    return fehlerAntwort(403, 'Kein Recht für den Export der Firmen')

  const supabase = await createSupabaseServerClient()
  // KAN-426: optional nur ein Import (?import=<Bezeichnung>) – derselbe Filter wie in der Liste
  const imp = importFilterAus(req.nextUrl.searchParams.get('import'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('firmen') as any)
    .select('accountnummer, name, segment, email, email_weitere, telefon, telefon_vorwahl, strasse, plz, ort, land, uid_nummer, zahlungsziel_tage, is_lead, sonderrabatt_pct, notizen')
    .eq('tenant_id', tenantId).eq('aktiv', true)
  if (imp) q = q.eq('import_quelle', imp)
  const { data, error } = await alle(q.order('name').order('id'))
  // alle() liefert bei einem Fehler die bis dahin geholten Blöcke – kein halber Export
  if (error) return fehlerAntwort(500, 'Export fehlgeschlagen')

  const csv = firmenCsv(data ?? [])
  return csvAntwort(csv.text, csvDateiname(['firmen']), csv.zeilen, csv.warnungen)
}
