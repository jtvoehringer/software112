// KAN-436 E1: Exportauftrag für „Rechnung stellen“ bzw. „Muster ausbuchen“ laden und nach denselben Regeln prüfen –
// für die Anzeige am Auftrag, die Server Action und die Gegenprüfung in createVerkauf (eine Quelle).
import type { SupabaseClient } from '@supabase/supabase-js'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { alle } from '@/lib/supabase/alle'
import { exportFaktura, musterBuchung, type Faktura, type FakturaAuftrag, type FakturaExportPosition } from './fakturierung'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type FakturaGeladen = {
  auftrag: FakturaAuftrag & { id: string; referenz: string | null }
  faktura: Faktura
  muster: { fehler: string[]; flaschen: number }
}

/** null = Exportauftrag nicht gefunden (bzw. fremder Betrieb) */
export async function ladeExportFaktura(supabase: SupabaseClient, tenantId: string, exportId: string): Promise<FakturaGeladen | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [aRes, pRes, cRes] = await Promise.all([
    // storno-sichtbar: ein stornierter Auftrag wird geladen, damit die Meldung „ist storniert“ lautet (nicht „nicht gefunden“)
    sb.from('exportauftraege')
      .select('id, referenz, status, storniert_am, mustersendung, verkaufsposten_id, muster_ausgebucht_am, kontakt_id, firma_id, destination_land, kunde_uid, fracht_eur, versicherung_eur')
      .eq('id', exportId).eq('tenant_id', tenantId).maybeSingle(),
    // tenant-isolation-ignore: exportauftrag_positionen ohne tenant_id – der Auftrag ist oben auf den Betrieb geprüft
    alle<R>(sb.from('exportauftrag_positionen')
      .select('id, fullung_id, beschreibung, menge, einheit, preis_eur, flaschen_je_karton, sort_order, fuellungen(name, bezeichnung)')
      .eq('exportauftrag_id', exportId).order('sort_order').order('id')),
    sb.from('tenant_einstellungen').select('export_flaschen_je_karton').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (aRes.error) throw new AktionsFehler(dbFehlerText(aRes.error, 'Der Exportauftrag konnte nicht geladen werden'))
  if (pRes.error) throw new AktionsFehler(dbFehlerText(pRes.error, 'Die Positionen des Exportauftrags konnten nicht geladen werden'))
  if (cRes.error) throw new AktionsFehler(dbFehlerText(cRes.error, 'Die Einstellungen konnten nicht geladen werden'))
  const a = aRes.data as R | null
  if (!a) return null
  const standard = Number.isInteger(cRes.data?.export_flaschen_je_karton) ? (cRes.data.export_flaschen_je_karton as number) : null
  const positionen: FakturaExportPosition[] = (pRes.data ?? []).map(p => ({
    fullung_id: p.fullung_id, beschreibung: p.beschreibung, menge: p.menge, einheit: p.einheit, preis_eur: p.preis_eur,
    flaschen_je_karton: p.flaschen_je_karton, fuellungName: p.fuellungen?.bezeichnung ?? p.fuellungen?.name ?? null,
  }))
  return {
    auftrag: a as FakturaGeladen['auftrag'],
    faktura: exportFaktura(a, positionen, standard),
    muster: musterBuchung(a, positionen, standard),
  }
}
