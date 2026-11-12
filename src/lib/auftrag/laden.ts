import 'server-only'

// KAN-418: Reservierungen laden – offene Mengen aller reservierenden Aufträge des Betriebs je Füllung.
// Zwei Abfragen statt einer Einbettung: erst die reservierenden Aufträge, dann ihre Positionen in Blöcken.

import { alle, inBloecken } from '@/lib/supabase/alle'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { RESERVIERT_STATUS, reserviertJeFuellung, reservierungTage, tageZwischen, type AbgelaufeneReservierung } from './regeln'

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

/** Standardfrist der Reservierung des Betriebs in Tagen (KAN-418 Teil 5); wirft bei einem Lesefehler */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeReservierungTage(supabase: any, tenantId: string): Promise<number> {
  const { data, error } = await (supabase.from('tenant_einstellungen') as R)
    .select('auftrag_reservierung_tage').eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Die Reservierungsfrist konnte nicht geladen werden'))
  return reservierungTage((data as R | null)?.auftrag_reservierung_tage)
}

/**
 * KAN-418 Teil 5: Aufträge, deren Reservierung abgelaufen ist (Frist vor heute, noch offen bzw. teilweise geliefert) –
 * älteste zuerst. Die Flaschen bleiben reserviert, bis jemand verlängert, liefert, abschließt oder storniert.
 * Wirft bei einem Lesefehler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAbgelaufeneReservierungen(supabase: any, tenantId: string, heute: string): Promise<AbgelaufeneReservierung[]> {
  const { data: auftraege, error: aErr } = await alle<R>((supabase.from('auftraege') as R)
    .select('id, nummer, reserviert_bis, kontakt_id, firma_id')
    .eq('tenant_id', tenantId).eq('art', 'auftrag').in('status', [...RESERVIERT_STATUS]).is('storniert_am', null)
    .lt('reserviert_bis', heute).order('reserviert_bis').order('erstellt_am').order('id'))
  if (aErr) throw new AktionsFehler(dbFehlerText(aErr, 'Abgelaufene Reservierungen konnten nicht geladen werden'))
  const liste = (auftraege ?? []) as R[]
  if (liste.length === 0) return []
  const ids = liste.map(a => a.id as string)
  const kontaktIds = [...new Set(liste.map(a => a.kontakt_id).filter(Boolean))] as string[]
  const firmaIds = [...new Set(liste.map(a => a.firma_id).filter(Boolean))] as string[]
  const [pos, kon, fir] = await Promise.all([
    inBloecken<R>(ids, b => alle<R>((supabase.from('auftrag_positionen') as R)
      .select('id, auftrag_id, menge, geliefert').eq('tenant_id', tenantId).in('auftrag_id', b).order('id'))),
    inBloecken<R>(kontaktIds, b => alle<R>((supabase.from('kontakte') as R)
      .select('id, vorname, nachname').eq('tenant_id', tenantId).in('id', b).order('id'))),
    inBloecken<R>(firmaIds, b => alle<R>((supabase.from('firmen') as R)
      .select('id, name').eq('tenant_id', tenantId).in('id', b).order('id'))),
  ])
  const fehler = pos.error ?? kon.error ?? fir.error
  if (fehler) throw new AktionsFehler(dbFehlerText(fehler, 'Abgelaufene Reservierungen konnten nicht geladen werden'))
  const offen = new Map<string, number>()
  for (const p of (pos.data ?? []) as R[]) {
    offen.set(p.auftrag_id, (offen.get(p.auftrag_id) ?? 0) + Math.max(0, (Number(p.menge) || 0) - (Number(p.geliefert) || 0)))
  }
  const kontakte = new Map(((kon.data ?? []) as R[]).map(k => [k.id as string, [k.vorname, k.nachname].filter(Boolean).join(' ')]))
  const firmen = new Map(((fir.data ?? []) as R[]).map(f => [f.id as string, f.name as string]))
  return liste.map(a => ({
    id: a.id as string,
    nummer: a.nummer as string,
    kunde: (a.firma_id ? firmen.get(a.firma_id) : kontakte.get(a.kontakt_id)) || '–',
    reserviertBis: a.reserviert_bis as string,
    tage: tageZwischen(a.reserviert_bis as string, heute),
    offen: offen.get(a.id as string) ?? 0,
  }))
}
