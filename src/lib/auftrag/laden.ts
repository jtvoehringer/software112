import 'server-only'

// KAN-418: Reservierungen laden – offene Mengen aller reservierenden Aufträge des Betriebs je Füllung.
// Zwei Abfragen statt einer Einbettung: erst die reservierenden Aufträge, dann ihre Positionen in Blöcken.

import { alle, inBloecken } from '@/lib/supabase/alle'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { RESERVIERT_STATUS, reserviertJeFuellung } from './regeln'

type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Reservierte Flaschen je Füllung (fuellung_id → Flaschen); wirft bei einem Lesefehler */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeReservierungen(supabase: any, tenantId: string): Promise<Map<string, number>> {
  const { data: auftraege, error: aErr } = await alle<R>((supabase.from('auftraege') as R)
    .select('id').eq('tenant_id', tenantId).eq('art', 'auftrag').in('status', [...RESERVIERT_STATUS]).is('storniert_am', null).order('id'))
  if (aErr) throw new AktionsFehler(dbFehlerText(aErr, 'Reservierungen konnten nicht geladen werden'))
  const ids = (auftraege ?? []).map(a => a.id as string)
  if (ids.length === 0) return new Map()
  const { data: positionen, error: pErr } = await inBloecken<R>(ids, b => alle<R>((supabase.from('auftrag_positionen') as R)
    .select('id, fuellung_id, menge, geliefert').eq('tenant_id', tenantId).in('auftrag_id', b).order('id')))
  if (pErr) throw new AktionsFehler(dbFehlerText(pErr, 'Reservierungen konnten nicht geladen werden'))
  return reserviertJeFuellung((positionen ?? []) as { fuellung_id: string; menge: number; geliefert: number }[])
}
