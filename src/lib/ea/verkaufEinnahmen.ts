import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { lokalerTag, wienJetzt } from '@/lib/datum/wien'
import { planeVerkaufsEinnahmen, type PlanEinnahme, type PlanPosition, type PlanZahlung } from './verkaufEinnahmenPlan'

// E&A-Einnahmen aus den Zahlungseingängen eines Verkaufs (import_quelle 'verkauf') sind abgeleitete Buchungen: Sie
// folgen den Zahlungen und werden stellvertretend über die Service-Role geschrieben (KAN-149, Nebenbefund 2) – wer
// Zahlungen erfassen darf, aktualisiert damit auch die Einnahme, ohne eigenes Recht in der E&A.
// Seit KAN-149 D2b (30.09.2026) je Zahlung und ohne Löschen: Abweichungen werden gegengebucht (RPC s112_ea_stornieren,
// Datum wie das Original, solange dessen Zeitraum offen ist, sonst heute) und neu gebucht – am Zahlungstag, liegt
// der in einem abgeschlossenen Zeitraum, heute (mit Vermerk). Plan und Regeln: verkaufEinnahmenPlan.ts.
// Die Aufrufer prüfen vorher Betrieb, Schreibsperre und Rechte (Warenwirtschaft oder E&A).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type EinnahmenErgebnis =
  | { ok: true; gesperrt: boolean; storniert: number; angelegt: number }
  | { ok: false; fehler: string }

/** Grund der automatischen Gegenbuchung (≥ 10 Zeichen, Änderungsprotokoll) */
export const GRUND_EINNAHMEN_NEU = 'Automatisch: Einnahmen je Zahlung neu zugeordnet (KAN-149)'

function datumDe(d: string): string {
  const [j, m, t] = d.split('-')
  return `${t}.${m}.${j}`
}

/**
 * Gleicht die Einnahmen eines Verkaufs mit seinen gültigen Zahlungen ab (je Zahlung und USt-Satz).
 * `zahlungen`: alle Zahlungen des Postens – stornierte werden ausgelassen.
 */
export async function abgleichVerkaufsEinnahmen(
  tenantId: string,
  verkaufspostenId: string,
  daten: { positionen: PlanPosition[]; zahlungen: (PlanZahlung & { storniertAm?: string | null })[]; beleg: string },
  /** KAN-105 Teil B: bestehende Einnahmen über alle Lieferscheine der Rechnung erkennen (Standard: nur dieser) */
  lieferscheinIds: readonly string[] = [verkaufspostenId],
): Promise<EinnahmenErgebnis> {
  const admin = createSupabaseAdminClient()

  // storno-sichtbar: Prüfung wertet storniert_am im Code aus (bestehende Einnahmen samt Stornos abgleichen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const basis = (admin.from('ea_transaktionen') as any)
    .select('id, zahlung_id, betrag_netto, ust_satz, is_locked, import_quelle, storniert_am, storno_von_id')
    .eq('tenant_id', tenantId)
  // ein Lieferschein wie bisher; Rechnung über mehrere Lieferscheine: Einnahmen aller ihrer Lieferscheine (KAN-105 Teil B)
  const { data: bestehendeRaw, error: leseErr } = await (lieferscheinIds.length > 1
    ? basis.in('verkaufsposten_id', [...lieferscheinIds])   // alle-ausnahme: Lieferscheine einer Rechnung, fachlich wenige
    : basis.eq('verkaufsposten_id', verkaufspostenId))
  if (leseErr) return { ok: false, fehler: `E&A-Einnahmen des Verkaufs konnten nicht geladen werden: ${(leseErr as R).message}` }
  const bestehende = ((bestehendeRaw ?? []) as R[]).map((e): PlanEinnahme => ({
    id: e.id, zahlung_id: e.zahlung_id ?? null, betrag_netto: Number(e.betrag_netto), ust_satz: Number(e.ust_satz),
    is_locked: !!e.is_locked, import_quelle: e.import_quelle, storniert_am: e.storniert_am ?? null, storno_von_id: e.storno_von_id ?? null,
  }))

  const gueltig = daten.zahlungen.filter(z => !z.storniertAm)
  const plan = planeVerkaufsEinnahmen(daten.positionen, gueltig, bestehende)
  if (plan.gesperrt) return { ok: true, gesperrt: true, storniert: 0, angelegt: 0 }

  // 1. Abweichende bzw. Alt-Einnahmen gegenbuchen
  let storniert = 0
  for (const id of plan.stornieren) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.rpc as any)('s112_ea_stornieren', { p_tenant_id: tenantId, p_id: id, p_grund: GRUND_EINNAHMEN_NEU })
    if (error) {
      return { ok: false, fehler: `E&A-Einnahme des Verkaufs konnte nicht gegengebucht werden: ${(error as R).message}${storniert ? ` (${storniert} bereits gegengebucht)` : ''}` }
    }
    storniert++
  }

  // 2. Neue Einnahmen je Zahlung – am Zahlungstag, sonst (abgeschlossener Zeitraum) heute
  if (plan.anlegen.length === 0) return { ok: true, gesperrt: false, storniert, angelegt: 0 }
  const heute = lokalerTag(wienJetzt())
  const offen = new Map<string, boolean>()
  for (const d of new Set(plan.anlegen.map(a => a.datum))) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.rpc as any)('pruefe_ea_zeitraum_offen', { p_tenant_id: tenantId, p_datum: d })
    if (error) return { ok: false, fehler: `Buchungszeitraum konnte nicht geprüft werden: ${(error as R).message}` }
    offen.set(d, !!((data as R[] | null)?.[0]?.offen))
  }
  const zeilen = plan.anlegen.map(a => {
    const verschoben = !offen.get(a.datum)
    return {
      tenant_id: tenantId,
      typ: 'einnahme',
      import_quelle: 'verkauf',
      verkaufsposten_id: verkaufspostenId,
      zahlung_id: a.zahlung_id,
      datum: verschoben ? heute : a.datum,
      beschreibung: `Zahlungseingang ${daten.beleg}${verschoben ? ` (Zahlung vom ${datumDe(a.datum)})` : ''}`,
      betrag_netto: a.betrag_netto,
      ust_satz: a.ust_satz,
      notizen: verschoben
        ? 'Automatisch erzeugt aus Zahlungseingang (Verkauf) – Zahlungstag liegt in einem abgeschlossenen Zeitraum, daher heute gebucht'
        : 'Automatisch erzeugt aus Zahlungseingang (Verkauf)',
    }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: angelegt, error: insErr } = await (admin.from('ea_transaktionen') as any).insert(zeilen).select('id')
  if (insErr) return { ok: false, fehler: `E&A-Einnahme konnte nicht gebucht werden: ${(insErr as R).message}` }
  return { ok: true, gesperrt: false, storniert, angelegt: ((angelegt ?? []) as R[]).length }
}
