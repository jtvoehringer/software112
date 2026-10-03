'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { istTag } from '@/lib/behoerden/kellerbuch-hilfen'

// KAN-192: Kellerbuch-Abschluss (Periodensperre). Nur Betriebsleitung; unwiderruflich. Die Datenbank
// (kellerbuch_abschliessen) prüft Rolle, Abo-Sperre, „höchstens bis gestern“ und „nach dem letzten Abschluss“ selbst.

export async function kellerbuchAbschliessen(bis: string, bemerkung: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return { ok: false, error: 'Kein Betrieb ausgewählt.' }
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)           // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canAdmin(membership.role)) {
    return { ok: false, error: 'Keine Berechtigung – nur die Betriebsleitung schließt das Kellerbuch ab.' }
  }
  if (!istTag(bis)) return { ok: false, error: 'Bitte ein gültiges Datum angeben.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('kellerbuch_abschliessen', {
    p_tenant_id: membership.tenantId,
    p_bis: bis,
    p_bemerkung: bemerkung.trim() || null,
  })
  if (error) return { ok: false, error: String(error.message ?? 'Abschließen fehlgeschlagen.') }
  revalidatePath('/kellerbuch/journal')
  return { ok: true }
}
