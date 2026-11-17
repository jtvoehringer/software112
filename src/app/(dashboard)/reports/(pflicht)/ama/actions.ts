'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'

// KAN-472 Teil 2: Ankreuzfelder der Weinerntemeldung („beabsichtige Süßung“, „beabsichtige Entsäuerung“) je Jahrgang.
// Schreibrecht wie die RLS von weinjahrgaenge (Rieden oder Kellerbuch). Auch bei abgeschlossenem Jahrgang änderbar
// (Datenbank: s112_jahrgang_abschluss_schutz lässt genau diese Angaben zur Meldung frei).

export type ErnteAngaben = { suessung: boolean; entsaeuerung: boolean }

export async function ernteAngabenSpeichern(jahrgangId: string, angaben: ErnteAngaben): Promise<{ error: string } | { ok: true }> {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein aktiver Betrieb gefunden.' }
  const fremd = await seitenBetriebFehler(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  if (fremd) return { error: fremd }
  const gesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return { error: gesperrt }
  if (!canWrite(membership, 'rieden') && !canWrite(membership, 'kellerbuch')) {
    return { error: 'Keine Berechtigung – dafür ist die Freigabe Rieden oder Kellerbuch nötig.' }
  }
  if (!/^[0-9a-f-]{36}$/i.test(jahrgangId)) return { error: 'Jahrgang fehlt.' }

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('weinjahrgaenge') as any)
    .update({ ernte_suessung: angaben.suessung === true, ernte_entsaeuerung: angaben.entsaeuerung === true })
    .eq('id', jahrgangId).eq('tenant_id', membership.tenantId)
    .select('id')
  if (error) return { error: dbFehlerText(error, 'Die Angaben zur Erntemeldung konnten nicht gespeichert werden') }
  if (!data || data.length === 0) return { error: NICHT_GESPEICHERT }
  revalidatePath('/reports/ama')
  return { ok: true }
}
