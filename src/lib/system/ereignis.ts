// Systemereignisse (Migration 222) – zentrales Fehlerprotokoll, 20.9.2026.
// Nur serverseitig (Admin-Client). Darf selbst nie werfen.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type EreignisArt = 'server' | 'client' | 'cron' | 'db'

export type Ereignis = {
  art: EreignisArt
  quelle: string
  meldung: string
  digest?: string | null
  tenantId?: string | null
  userId?: string | null
  details?: Record<string, unknown> | null
}

const S112 = 'S112|'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOderNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null)

export async function ereignisMelden(e: Ereignis): Promise<void> {
  try {
    const admin = createSupabaseAdminClient()
    // Meldung aus dem Digest (AktionsFehler) bevorzugen, Next-Maske verwerfen
    let meldung = (e.meldung ?? '').toString()
    if (e.digest && e.digest.startsWith(S112)) meldung = e.digest.slice(S112.length)
    // tenant-isolation-ignore: Systemprotokoll ohne Mandantenbezug, nur Service-Role
    const { error } = await (admin.from('system_ereignisse') as any).insert({
      art: e.art,
      quelle: e.quelle.slice(0, 300),
      meldung: (meldung || 'Fehler ohne Meldung').slice(0, 2000),
      digest: e.digest && !e.digest.startsWith(S112) ? e.digest.slice(0, 200) : null,
      tenant_id: uuidOderNull(e.tenantId),
      user_id: uuidOderNull(e.userId),
      details: e.details ?? null,
    })
    if (error) console.error('[system] ereignis:', error.message)
  } catch (err) {
    console.error('[system] ereignis:', err instanceof Error ? err.message : String(err))
  }
}

/** Tages-/Wochenzusammenfassung für Admin-Seite und Morgenbericht. */
export type EreignisZeile = { id: number; erstellt_am: string; art: EreignisArt; quelle: string; meldung: string; digest: string | null; tenant_id: string | null; user_id: string | null; details: Record<string, unknown> | null }

export async function ereignisseLaden(seit: Date): Promise<EreignisZeile[]> {
  const admin = createSupabaseAdminClient()
  // tenant-isolation-ignore: Systemprotokoll ohne Mandantenbezug, nur Service-Role
  const { data, error } = await (admin.from('system_ereignisse') as any)
    .select('id, erstellt_am, art, quelle, meldung, digest, tenant_id, user_id, details')
    .gte('erstellt_am', seit.toISOString())
    .order('erstellt_am', { ascending: false })
    .limit(1000)
  if (error) { console.error('[system] ereignisse laden:', error.message); return [] }
  return (data ?? []) as EreignisZeile[]
}

/** Aufräumen: Ereignisse älter als 30 Tage (täglicher Cron). */
export async function ereignisseBereinigen(): Promise<number> {
  try {
    const admin = createSupabaseAdminClient()
    const grenze = new Date(Date.now() - 30 * 86400000).toISOString()
    // tenant-isolation-ignore: Systemprotokoll ohne Mandantenbezug, nur Service-Role
    const { data, error } = await (admin.from('system_ereignisse') as any).delete().lt('erstellt_am', grenze).select('id')
    if (error) { console.error('[system] bereinigen:', error.message); return 0 }
    return (data ?? []).length
  } catch { return 0 }
}
