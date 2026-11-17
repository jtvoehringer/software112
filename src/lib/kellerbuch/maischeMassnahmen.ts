// ── Maßnahmen an der Maische laden (KAN-481) ────────────────────────────────────────────────────────────────────────
//
// Rechnung in src/lib/wein/maischeAnteile.ts. Hier die Abfragen: für Chargen die Maßnahmen ihrer Maischen mit Anteil
// (Behandlungsliste, Weinbuch, Meldung „Kellerbehandlungen“), für eine Maische ihre Maßnahmen. Läuft mit dem Client des
// Benutzers (Server und Browser); vollständig und in Blöcken – ein Teilergebnis ergäbe falsche Anteile.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle, inBloecken } from '@/lib/supabase/alle'
import { maischeNummer } from '@/lib/wein/maische'
import { maischeAnteilZeilen, type MaischeAnteilZeile, type MaischeBehandlung, type MaischeMostZeile } from '@/lib/wein/maischeAnteile'

type R = Record<string, any>
type Ergebnis<T> = { data: T; error: null } | { data: null; error: string }

const zuBehandlung = (b: R): MaischeBehandlung => {
  const einheit = typeof b.einheit === 'string' && b.einheit.trim() && b.einheit !== '-' ? b.einheit : null
  const menge = b.menge == null || einheit === null ? null : Number(b.menge)
  return {
    id: String(b.id), pressungId: String(b.pressung_id), datum: String(b.datum).slice(0, 10), zeitpunkt: (b.created_at as string | null) ?? null,
    behandlung: ((b.typ as R | null)?.name as string | undefined) ?? (b.typ_name_snapshot as string | null) ?? 'Behandlung',
    menge: menge === null || Number.isNaN(menge) ? null : menge, einheit,
    notizen: typeof b.notizen === 'string' && b.notizen.trim() ? b.notizen.trim() : null,
  }
}

/**
 * Maßnahmen an der Maische je Charge, mit Anteil. Leere Map, wenn keine der Chargen aus einer Maische stammt
 * (dann nach zwei Abfragen fertig). Stornierte Pressungen, Mostzeilen und Behandlungen zählen nicht.
 */
export async function ladeMaischeAnteile(supabase: any, tenantId: string, chargeIds: readonly string[]): Promise<Ergebnis<Map<string, MaischeAnteilZeile[]>>> {
  const leer = new Map<string, MaischeAnteilZeile[]>()
  const ids = [...new Set(chargeIds.filter(Boolean))]
  if (ids.length === 0) return { data: leer, error: null }
  // Mostzeilen der Chargen → ihre Pressungen (pressung_behaelter hat keine tenant_id – der Betrieb folgt über die Pressung)
  const eigene = await inBloecken<R>(ids, bl => (supabase.from('pressung_behaelter') as any)
    .select('id, pressung_id').in('weinausbau_id', bl).is('storniert_am', null).order('id'))
  if (eigene.error) return { data: null, error: `Pressungen der Charge konnten nicht geladen werden (${eigene.error.message})` }
  const kandidaten = [...new Set(eigene.data.map(z => String(z.pressung_id)))]
  if (kandidaten.length === 0) return { data: leer, error: null }
  const pr = await inBloecken<R>(kandidaten, bl => (supabase.from('pressungen') as any)
    .select('id, maische_nr, jahrgang:jahrgang_id(jahrgang)').in('id', bl).eq('tenant_id', tenantId).not('maische_beginn', 'is', null).is('storniert_am', null).order('id'))
  if (pr.error) return { data: null, error: `Maischen der Charge konnten nicht geladen werden (${pr.error.message})` }
  const maischen = pr.data.map(p => String(p.id))
  if (maischen.length === 0) return { data: leer, error: null }
  const nummer = new Map<string, string | null>(pr.data.map(p => [String(p.id), maischeNummer((p.jahrgang as R | null)?.jahrgang ?? null, p.maische_nr as number | null)]))

  const [beh, most] = await Promise.all([
    inBloecken<R>(maischen, bl => (supabase.from('keller_behandlungen') as any)
      .select('id, pressung_id, datum, created_at, typ_name_snapshot, menge, einheit, notizen, typ:typ_id(name)')
      .in('pressung_id', bl).eq('tenant_id', tenantId).is('storniert_am', null).order('datum').order('created_at').order('id')),
    inBloecken<R>(maischen, bl => (supabase.from('pressung_behaelter') as any)
      .select('id, pressung_id, weinausbau_id, menge_liter').in('pressung_id', bl).is('storniert_am', null).order('id')),
  ])
  if (beh.error) return { data: null, error: `Maßnahmen an der Maische konnten nicht geladen werden (${beh.error.message})` }
  if (most.error) return { data: null, error: `Mostzeilen der Maische konnten nicht geladen werden (${most.error.message})` }
  if (beh.data.length === 0) return { data: leer, error: null }

  const mostZeilen: MaischeMostZeile[] = most.data.map(m => ({ pressungId: String(m.pressung_id), chargeId: m.weinausbau_id ? String(m.weinausbau_id) : null, liter: Number(m.menge_liter) || 0 }))
  const behandlungen = beh.data.map(zuBehandlung)
  const je = new Map<string, MaischeAnteilZeile[]>()
  for (const id of ids) {
    const zeilen = maischeAnteilZeilen(id, mostZeilen, behandlungen, nummer)
    if (zeilen.length > 0) je.set(id, zeilen)
  }
  return { data: je, error: null }
}

/** Maßnahmen einer Maische (auch stornierte, gekennzeichnet), neueste zuerst – für die Liste an der Maische */
export async function ladeMassnahmenDerMaische(supabase: any, tenantId: string, pressungId: string): Promise<Ergebnis<R[]>> {
  // storno-sichtbar: die Liste an der Maische zeigt stornierte Maßnahmen gekennzeichnet, ohne Aktionen (wie an der Charge)
  const r = await alle<R>((supabase.from('keller_behandlungen') as any)
    .select('id, datum, created_at, typ_id, typ_name_snapshot, menge, einheit, notizen, storniert_am, storno_grund, storniert_von_name, typ:typ_id(name)')
    .eq('tenant_id', tenantId).eq('pressung_id', pressungId)
    .order('datum', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }))
  if (r.error) return { data: null, error: `Maßnahmen an der Maische konnten nicht geladen werden (${r.error.message})` }
  return { data: r.data, error: null }
}
