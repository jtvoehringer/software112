import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import ImportClient from '@/app/(dashboard)/admin/import/ImportClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { importVorschlaege, istCrmImportTyp, zaehleImporte } from '@/lib/crm/importBezeichnung'

export const metadata: Metadata = { title: 'Import' }
export const dynamic = 'force-dynamic'

// KAN-426 (12.11.2026): Kontakte und Firmen direkt im CRM importieren – für alle mit Schreibrecht CRM (Betriebs-Manager
// und Mitarbeiter mit Modulrecht), nicht nur für die Verwaltung. Derselbe Baustein wie /admin/import, beschränkt auf
// Kontakte und Firmen; die Bezeichnung des Imports ist hier Pflicht. Die Route /api/import prüft dasselbe Recht.
export default async function CrmImportPage({ searchParams }: { searchParams: Promise<{ typ?: string }> }) {
  const { typ } = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  if (!canWrite(membership, 'crm')) redirect('/crm/kontakte')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  // Früher verwendete Bezeichnungen als Vorschlag – ein Nachtrag soll unter demselben Namen landen
  const [kRes, fRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle((supabase.from('kontakte') as any).select('id, import_quelle').eq('tenant_id', tenantId).not('import_quelle', 'is', null).order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle((supabase.from('firmen') as any).select('id, import_quelle').eq('tenant_id', tenantId).not('import_quelle', 'is', null).order('id')),
  ])
  const bezeichnungen = importVorschlaege(
    zaehleImporte(geladen(kRes, 'Importe der Kontakte') ?? []),
    zaehleImporte(geladen(fRes, 'Importe der Firmen') ?? []),
  )

  return <ImportClient modus="crm" bezeichnungen={bezeichnungen} initialTyp={istCrmImportTyp(typ) ? typ : 'kontakte'} />
}
