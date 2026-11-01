'use server'

// KAN-392: „Ernte abgeschlossen“ eines Grundstücks im Jahrgang setzen bzw. zurücknehmen (Lesedaten). Abgeschlossene
// Grundstücke schlägt das Lese-Formular nicht mehr vor; mit der Lese setzt es createMultipleErnteParzellen (actions.ts).
// Schreibrecht wie die Lese: Rieden oder Kellerbuch (RLS modul_* auf ernte_gst_abgeschlossen).
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'

export async function ernteGstAbschliessen(jahrgangId: string, grundstueckId: string, abgeschlossen: boolean) {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'rieden') && !canWrite(membership, 'kellerbuch')) {
    throw new AktionsFehler('Keine Berechtigung – dafür ist die Freigabe Rieden oder Kellerbuch nötig.')
  }
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()
  // Jahrgang des eigenen Betriebs (das Grundstück prüft der Fremdverweis-Trigger)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jg, error: jgFehler } = await (supabase.from('weinjahrgaenge') as any)
    .select('id').eq('id', jahrgangId).eq('tenant_id', tenantId).maybeSingle()
  if (jgFehler) throw new AktionsFehler(dbFehlerText(jgFehler, 'Jahrgang konnte nicht geladen werden'))
  if (!jg) throw new AktionsFehler('Jahrgang nicht gefunden – bitte die Seite neu laden.')

  if (abgeschlossen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('ernte_gst_abgeschlossen') as any)
      .upsert({ tenant_id: tenantId, jahrgang_id: jahrgangId, grundstueck_id: grundstueckId },
        { onConflict: 'jahrgang_id,grundstueck_id', ignoreDuplicates: true })
    if (error) throw new AktionsFehler(dbFehlerText(error, '„Ernte abgeschlossen“ konnte nicht gesetzt werden'))
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('ernte_gst_abgeschlossen') as any)
      .delete().eq('tenant_id', tenantId).eq('jahrgang_id', jahrgangId).eq('grundstueck_id', grundstueckId).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, '„Ernte abgeschlossen“ konnte nicht zurückgenommen werden'))
    if (!data?.length) throw new AktionsFehler(NICHT_GESPEICHERT)
  }
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}
