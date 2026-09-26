import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// E&A-Einnahmen aus den Zahlungseingängen eines Verkaufs (import_quelle 'verkauf') sind
// abgeleitete Buchungen: Sie folgen den Zahlungen und werden stellvertretend über die
// Service-Role geschrieben (KAN-149, Nebenbefund 2). Mit dem Benutzer-Client löschte ein
// Mitarbeiter mit Freigabe E&A still 0 Zeilen (RLS ea_tx_delete: nur Betriebs-Manager) und
// legte trotzdem neu an – ab der zweiten Zahlung stand die Einnahme doppelt in der UVA; ohne
// Freigabe E&A scheiterte das Anlegen und die Einnahme fehlte ganz.
// Die Aufrufer prüfen vorher Betrieb, Schreibsperre und Rechte (Warenwirtschaft oder E&A).
// Gesperrte Zeilen (übermittelte UVA, is_locked) werden nie verändert.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type VerkaufsEinnahme = {
  datum: string
  beschreibung: string
  betrag_netto: number
  ust_satz: number
  notizen: string
}

export type EinnahmenErgebnis =
  | { ok: true; gesperrt: boolean; entfernt: number; angelegt: number }
  | { ok: false; fehler: string }

/**
 * Ersetzt die nicht gesperrten abgeleiteten Einnahmen eines Verkaufspostens durch `neu`
 * (leer = nur entfernen).
 *  - `beiGesperrtenNichtsAendern` (Sync): Ist eine Einnahme des Postens gesperrt, bleibt alles
 *    unverändert (`gesperrt: true`) – wie bisher, sonst stünde der Zahlungseingang doppelt drin.
 *  - ohne (Storno): nur die nicht gesperrten entfernen, gesperrte bleiben stehen.
 * Wurden nicht alle alten Zeilen entfernt, wird nichts neu angelegt (keine Doppelbuchung).
 */
export async function ersetzeVerkaufsEinnahmen(
  tenantId: string,
  verkaufspostenId: string,
  neu: VerkaufsEinnahme[],
  opt: { beiGesperrtenNichtsAendern: boolean },
): Promise<EinnahmenErgebnis> {
  const admin = createSupabaseAdminClient()

  const { data: bestehendeRaw, error: leseErr } = await (admin.from('ea_transaktionen') as any)
    .select('id, is_locked, import_quelle')
    .eq('tenant_id', tenantId)
    .eq('verkaufsposten_id', verkaufspostenId)
  if (leseErr) return { ok: false, fehler: `E&A-Einnahmen des Verkaufs konnten nicht geladen werden: ${(leseErr as R).message}` }
  const bestehende = (bestehendeRaw ?? []) as R[]

  const gesperrt = bestehende.some(b => b.is_locked)
  if (gesperrt && opt.beiGesperrtenNichtsAendern) return { ok: true, gesperrt: true, entfernt: 0, angelegt: 0 }

  const alt = bestehende.filter(b => !b.is_locked && b.import_quelle === 'verkauf').map(b => b.id as string)
  let entfernt = 0
  if (alt.length > 0) {
    const { data: geloescht, error: delErr } = await (admin.from('ea_transaktionen') as any)
      .delete()
      .in('id', alt)
      .eq('tenant_id', tenantId)
      .eq('verkaufsposten_id', verkaufspostenId)
      .eq('is_locked', false)
      .select('id')
    if (delErr) return { ok: false, fehler: `E&A-Einnahmen des Verkaufs konnten nicht entfernt werden: ${(delErr as R).message}` }
    entfernt = ((geloescht ?? []) as R[]).length
    // Eine Zeile wurde inzwischen gesperrt oder gelöscht (paralleler Vorgang): nichts neu anlegen
    if (entfernt !== alt.length) {
      return { ok: false, fehler: `Von ${alt.length} E&A-Einnahmen des Verkaufs wurden nur ${entfernt} entfernt – es wurde nichts neu gebucht. Bitte die Seite neu laden und die Zahlung erneut speichern.` }
    }
  }

  if (neu.length === 0) return { ok: true, gesperrt, entfernt, angelegt: 0 }

  const { data: angelegt, error: insErr } = await (admin.from('ea_transaktionen') as any)
    .insert(neu.map(e => ({
      ...e,
      tenant_id: tenantId,
      typ: 'einnahme',
      import_quelle: 'verkauf',
      verkaufsposten_id: verkaufspostenId,
    })))
    .select('id')
  if (insErr) return { ok: false, fehler: `E&A-Einnahme konnte nicht gebucht werden: ${(insErr as R).message}` }
  return { ok: true, gesperrt, entfernt, angelegt: ((angelegt ?? []) as R[]).length }
}
