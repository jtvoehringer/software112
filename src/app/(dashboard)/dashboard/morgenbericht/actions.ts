'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { erstelleMorgenbericht } from '@/lib/morgenbericht/erstellen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** „Jetzt aktualisieren“: Bericht für heute neu erstellen (Betriebsleiter/Winzer). Zählt bei KI-Zusammenfassung als eine Abfrage. */
export async function aktualisiereMorgenbericht(): Promise<{ ok: boolean; fehler?: string; befunde?: number }> {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return { ok: false, fehler: 'Kein Mandant' }
  const betriebGewechselt = await seitenBetriebFehler(membership.tenantId)   // KAN-30 (KI-Kontingent des Betriebs)
  if (betriebGewechselt) return { ok: false, fehler: betriebGewechselt }
  const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (aboGesperrt) return { ok: false, fehler: aboGesperrt }
  if (!canWrite(membership, 'betrieb')) return { ok: false, fehler: 'Nur Betriebs-Manager und Mitarbeiter können den Bericht neu erstellen.' }
  const admin = createSupabaseAdminClient()
  // tenant-isolation-ignore: tenants hat keine tenant_id-Spalte, Filter über die eigene id
  const { data: t } = await (admin.from('tenants') as any).select('id, name, stripe_plan').eq('id', membership.tenantId).maybeSingle()
  if (!t) return { ok: false, fehler: 'Betrieb nicht gefunden' }
  try {
    const b = await erstelleMorgenbericht({ id: (t as R).id, name: (t as R).name, stripe_plan: (t as R).stripe_plan }, 'manuell')
    revalidatePath('/dashboard'); revalidatePath('/dashboard/morgenbericht')
    return { ok: true, befunde: b.befunde.length }
  } catch (e) {
    return { ok: false, fehler: (e as Error).message }
  }
}
