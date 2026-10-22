/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import 'server-only'

// ── Journal laden (KAN-332) – gemeinsam für Seite /dashboard/journal und CSV /api/export/journal ──
// Mitarbeiter sehen nur ihre eigenen Vorgänge (auch die Datenbank lässt nur diese durch: Policy bestandsprotokoll_eigene),
// die Betriebsleitung (system_admin/tenant_admin) alle, mit Filter nach Benutzer. Namen aus profiles (Mitglieder
// gemeinsamer Betriebe, RLS profiles_lesen).

import { alle, inBloecken } from '@/lib/supabase/alle'
import { AktionsFehler } from '@/lib/fehler'
import { VERWALTUNG_ROLLEN } from '@/lib/auth/pflichtmeldung'
import type { UserRole } from '@/lib/auth/roles'
import { folgetag, wienTagesbeginnUtc } from '@/lib/behoerden/kellerbuch-hilfen'
import { JOURNAL_BEREICHE, JOURNAL_NACHLADEN, journalZeilen, nachAktion, nachzuladendeIds, type JournalFilter, type JournalZeile } from './journal'

type R = Record<string, any>

export type JournalErgebnis = {
  zeilen: JournalZeile[]
  /** Betriebsleitung: alle Vorgänge und Filter nach Benutzer; sonst nur die eigenen */
  alleSichtbar: boolean
  /** Auswahl „Benutzer“ (nur Betriebsleitung): Mitglieder des Betriebs */
  benutzer: { id: string; name: string }[]
}

export function darfAlleSehen(role: UserRole | null | undefined): boolean {
  return !!role && (VERWALTUNG_ROLLEN as readonly string[]).includes(role)
}

export async function ladeJournal(
  supabase: any,
  ctx: { tenantId: string; userId: string; role: UserRole | null },
  f: JournalFilter,
): Promise<JournalErgebnis> {
  const alleSichtbar = darfAlleSehen(ctx.role)
  const benutzerFilter = alleSichtbar ? f.benutzer : ctx.userId

  let q = (supabase.from('bestandsprotokoll') as any)
    .select('id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, benutzer_id, grund, erstellt_am, kennung')
    .eq('tenant_id', ctx.tenantId)
    .gte('erstellt_am', wienTagesbeginnUtc(f.von))
    .lt('erstellt_am', wienTagesbeginnUtc(folgetag(f.bis)))
  if (benutzerFilter) q = q.eq('benutzer_id', benutzerFilter)
  if (f.bereich) {
    const tabellen = JOURNAL_BEREICHE.find(b => b.key === f.bereich)?.tabellen ?? []
    // alle-ausnahme: feste Tabellenliste eines Bereichs (höchstens 10 Namen), keine Daten
    q = q.in('tabelle', [...tabellen])
  }
  if (f.aktion === 'anlage') q = q.eq('aktion', 'INSERT')
  else if (f.aktion === 'loeschung') q = q.eq('aktion', 'DELETE')
  else if (f.aktion) q = q.eq('aktion', 'UPDATE')

  const [prot, mitglieder] = await Promise.all([
    alle<R>(q.order('erstellt_am', { ascending: false }).order('id', { ascending: false })),
    alleSichtbar
      ? alle<R>((supabase.from('tenant_memberships') as any).select('user_id').eq('tenant_id', ctx.tenantId).order('user_id'))
      : Promise.resolve({ data: [{ user_id: ctx.userId }], error: null }),
  ])
  if (prot.error) throw new AktionsFehler(`Journal konnte nicht geladen werden: ${prot.error.message}`)
  if (mitglieder.error) throw new AktionsFehler(`Mitglieder konnten nicht geladen werden: ${mitglieder.error.message}`)

  const ids = [...new Set([
    ...mitglieder.data.map(m => m.user_id as string),
    ...prot.data.map(p => p.benutzer_id as string | null).filter((b): b is string => !!b),
  ])]
  const namen = new Map<string, string>()
  if (ids.length > 0) {
    const { data, error } = await inBloecken<R>(ids, b => (supabase.from('profiles') as any).select('id, full_name, display_name').in('id', b))
    if (error) throw new AktionsFehler(`Benutzernamen konnten nicht geladen werden: ${error.message}`)
    for (const p of (data ?? []) as R[]) namen.set(p.id, (p.full_name || p.display_name || 'Benutzer') as string)
  }

  const daten = await ladeJournalDaten(supabase, ctx.tenantId, prot.data)
  const zeilen = nachAktion(journalZeilen(prot.data, namen, daten), f.aktion)
  const benutzer = alleSichtbar
    ? mitglieder.data.map(m => ({ id: m.user_id as string, name: namen.get(m.user_id) ?? 'Benutzer' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    : []
  return { zeilen, alleSichtbar, benutzer }
}

/**
 * KAN-376: Datensätze zu den Protokollzeilen nachladen (JOURNAL_NACHLADEN) – für Links über den Elterndatensatz und die
 * Schwundmenge. Je Tabelle in Blöcken, nur der eigene Betrieb (tenant_id bzw. über die eingebettete Elternzeile, !inner).
 * Gelöschte bzw. nicht (mehr) sichtbare Datensätze fehlen in der Map und bleiben ohne Link.
 */
export async function ladeJournalDaten(supabase: any, tenantId: string, roh: readonly R[]): Promise<Map<string, Map<string, R>>> {
  const ergebnis = new Map<string, Map<string, R>>()
  await Promise.all([...nachzuladendeIds(roh)].map(async ([tabelle, ids]) => {
    const { spalten, mandant } = JOURNAL_NACHLADEN[tabelle]
    // tenant-isolation-ignore: Tabelle aus JOURNAL_NACHLADEN, Betriebsfilter über `mandant` (tenant_id bzw. Elternzeile)
    const { data, error } = await inBloecken<R>(ids, b => alle<R>((supabase.from(tabelle) as any)
      .select(spalten)
      .eq(mandant, tenantId)
      .in('id', b)
      .order('id', { ascending: true })))
    if (error) throw new AktionsFehler(`Journal: ${tabelle} konnte nicht geladen werden: ${error.message}`)
    ergebnis.set(tabelle, new Map((data ?? []).map(z => [z.id as string, z])))
  }))
  return ergebnis
}
