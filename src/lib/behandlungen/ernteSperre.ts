// ── Maßnahmen nach der Lese der Ried gesperrt (KAN-169, 07.10.2026) ─────────────────────────────────────
// Ticket: Wurde eine Ried gelesen, sind Maßnahmen, die diese Ried betreffen, nicht mehr bearbeitbar oder stornierbar.
// Dieselbe Regel wie der Datenbank-Trigger a_freeze_ernte (s112_massnahme_geerntet): eine nicht stornierte Lese
// (ernte_parzellen, Ried direkt oder über das Grundstück) an einer Ried der Maßnahme – Ried der Maßnahme oder eines
// ihrer Grundstücke – mit Lesedatum am oder nach dem Datum der Maßnahme. Maßnahmen nach der Lese bleiben frei.
// Korrektur nur durch die Betriebsleitung („Mit Grund korrigieren“, s112_freeze_korrektur).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle, inBloecken } from '@/lib/supabase/alle'

/** Grund der Sperre – wie im Trigger (Meldung „Gesperrt: …“) */
export const MASSNAHME_ERNTE_GRUND = 'Ried nach der Maßnahme geerntet'

export type MassnahmeRieden = { id: string; datum: string | null; rieden: readonly string[] }
export type Lese = { ried: string; datum: string }

/** Erste Lese einer Ried der Maßnahme am oder nach ihrem Datum (TT-Vergleich als JJJJ-MM-TT), sonst null */
export function sperrendeLese(m: MassnahmeRieden, lesen: readonly Lese[]): string | null {
  if (!m.datum) return null
  const tag = m.datum.slice(0, 10)
  let erste: string | null = null
  for (const l of lesen) {
    if (!m.rieden.includes(l.ried) || l.datum < tag) continue
    if (erste === null || l.datum < erste) erste = l.datum
  }
  return erste
}

/**
 * Gesperrte Maßnahmen → Datum der sperrenden Lese. Lädt die nicht stornierten Lesen der betroffenen Rieden (direkt
 * und über Grundstücke ohne Ried in der Lesezeile) – Fehler werfen, keine Teilmenge (gesperrt hieße sonst frei).
 */
export async function ladeErnteSperren(supabase: any, tenantId: string, massnahmen: readonly MassnahmeRieden[]): Promise<Map<string, string>> {
  const rieden = [...new Set(massnahmen.filter(m => m.datum).flatMap(m => m.rieden))]
  const ergebnis = new Map<string, string>()
  if (rieden.length === 0) return ergebnis
  const q = (t: string) => (supabase.from(t) as any)
  // tenant-isolation-ignore: ernte_parzellen ohne tenant_id, Filter über den Jahrgang (!inner)
  const direkt = await inBloecken<{ weingarten_id: string; ernte_datum: string }>(rieden, b =>
    alle(q('ernte_parzellen').select('id, weingarten_id, ernte_datum, jahrgang:jahrgang_id!inner(tenant_id)').eq('jahrgang.tenant_id', tenantId)
      .is('storniert_am', null).in('weingarten_id', b).order('id')))
  if (direkt.error) throw new Error(`Lesen konnten nicht geladen werden (${direkt.error.message ?? 'unbekannter Fehler'})`)
  const gst = await inBloecken<{ id: string; weingarten_id: string }>(rieden, b =>
    alle(q('grundstuecke').select('id, weingarten_id').eq('tenant_id', tenantId).in('weingarten_id', b).order('id')))
  if (gst.error) throw new Error(`Grundstücke konnten nicht geladen werden (${gst.error.message ?? 'unbekannter Fehler'})`)
  const riedVonGst = new Map(gst.data.map(g => [g.id, g.weingarten_id]))
  // tenant-isolation-ignore: ernte_parzellen ohne tenant_id, Filter über den Jahrgang (!inner)
  const ueberGst = await inBloecken<{ grundstueck_id: string; ernte_datum: string }>([...riedVonGst.keys()], b =>
    alle(q('ernte_parzellen').select('id, grundstueck_id, ernte_datum, jahrgang:jahrgang_id!inner(tenant_id)').eq('jahrgang.tenant_id', tenantId)
      .is('storniert_am', null).is('weingarten_id', null).in('grundstueck_id', b).order('id')))
  if (ueberGst.error) throw new Error(`Lesen konnten nicht geladen werden (${ueberGst.error.message ?? 'unbekannter Fehler'})`)
  const lesen: Lese[] = [
    ...direkt.data.filter(e => e.ernte_datum).map(e => ({ ried: e.weingarten_id, datum: String(e.ernte_datum).slice(0, 10) })),
    ...ueberGst.data.filter(e => e.ernte_datum && riedVonGst.has(e.grundstueck_id))
      .map(e => ({ ried: riedVonGst.get(e.grundstueck_id) as string, datum: String(e.ernte_datum).slice(0, 10) })),
  ]
  for (const m of massnahmen) {
    const l = sperrendeLese(m, lesen)
    if (l) ergebnis.set(m.id, l)
  }
  return ergebnis
}
