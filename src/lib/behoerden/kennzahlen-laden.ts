// KAN-276: Lader der Behandlungskennzahlen (Kellerbehandlungen + Stoffverwendungen) für Lagerstand, Lagerbewegungen und
// RV. Rechnung und Annahmen in src/lib/kellerbuch/behandlungskennzahlen.ts.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle } from '@/lib/supabase/alle'
import { kennzahlBehandlungen, kennzahlHinweise, kennzahlenIndex, type Behandlungskennzahlen } from '@/lib/kellerbuch/behandlungskennzahlen'
import { num, type R } from './kellerbuch-hilfen'

export type KennzahlLookup = (weinausbauId: string | null | undefined, bis: string | null) => Behandlungskennzahlen

/** Alle Behandlungen und Stoffverwendungen des Betriebs bis `bis` → Abfrage je Charge und Datum samt Hinweisen */
export async function ladeBehandlungskennzahlen(supabase: any, tenantId: string, bis: string | null): Promise<{ kennzahl: KennzahlLookup; hinweise: string[] }> {
  let qb = (supabase.from('keller_behandlungen') as any)
    .select('id, datum, weinausbau_id, menge, einheit, volumen_liter_ist, storniert_am, typ_name_snapshot, typ:typ_id(name)')
    .eq('tenant_id', tenantId).not('weinausbau_id', 'is', null).is('storniert_am', null)
  let qs = (supabase.from('kellermittel_buchungen') as any)
    .select('id, datum, art, menge, zweck, weinausbau_id, keller_behandlung_id, storno_von_id, kellermittel:kellermittel_id(art, einheit)')
    .eq('tenant_id', tenantId).in('art', ['verwendung', 'storno'])
  if (bis) { qb = qb.lte('datum', bis); qs = qs.lte('datum', bis) }
  const [b, s, c] = await Promise.all([
    alle<R>(qb.order('id')),
    alle<R>(qs.order('id')),
    alle<R>((supabase.from('weinausbau') as any).select('id, menge_liter').eq('tenant_id', tenantId).order('id')),
  ])
  for (const [n, res] of [['keller_behandlungen', b], ['kellermittel_buchungen', s], ['weinausbau', c]] as const) {
    if (res.error) throw new Error(`Laden fehlgeschlagen (${n}): ${res.error.message}`)
  }
  const { liste, mitSchaetzvolumen } = kennzahlBehandlungen(b.data, s.data, new Map(c.data.map(x => [String(x.id), num(x.menge_liter)])))
  return { kennzahl: kennzahlenIndex(liste), hinweise: kennzahlHinweise(liste, mitSchaetzvolumen) }
}
