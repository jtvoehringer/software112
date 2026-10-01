import 'server-only'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import type { Bezuege } from './bezugText'

// Stammdaten mit Bezug nur deaktivieren (KAN-150 F1, Entscheidung Jörgen 26.09.2026): Vor dem Löschen fragen die
// Actions die Bezüge ab (RPC s112_stammdaten_bezuege, Migration 20261001071534) und bieten bei Bezug „Deaktivieren“
// an. Die Datenbank sperrt das Löschen ohnehin (Trigger a_stammdaten_loeschsperre, 42501) – die Abfrage liefert nur
// die bessere Meldung.

export type StammdatenTabelle =
  | 'weingarten' | 'grundstuecke' | 'kontakte' | 'firmen' | 'pflanzenschutzmittel' | 'duengemittel'
  | 'ea_kategorien' | 'ea_dauerauftraege' | 'keller_behandlungstypen'

export async function ladeBezuege(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, tabelle: StammdatenTabelle, id: string,
): Promise<Bezuege> {
  const { data, error } = await supabase.rpc('s112_stammdaten_bezuege', { p_tenant_id: tenantId, p_tabelle: tabelle, p_id: id })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Bezüge konnten nicht geprüft werden'))
  const b: Bezuege = {}
  for (const [k, n] of Object.entries((data ?? {}) as Record<string, unknown>)) {
    if (Number(n) > 0) b[k] = Number(n)
  }
  return b
}

/** Löschsperre der Datenbank (42501 aus dem Trigger, z. B. bei gleichzeitiger Buchung) */
export function istBezugsSperre(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  return e?.code === '42501' && /deaktivieren statt löschen/.test(String(e.message ?? ''))
}
