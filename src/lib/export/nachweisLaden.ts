// ── Weinexport: Nachweise laden (KAN-440 Teil 2) ──
// Für die Detailseite (Nachweise eines Auftrags) sowie Liste und Dashboard (Aufträge mit offenem Nachweis). Die Regeln
// selbst stehen in lib/export/nachweise.ts (nachweisFrist) – hier nur das Laden, immer im eigenen Betrieb.
import { alle, inBloecken } from '@/lib/supabase/alle'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { lieferfall } from '@/lib/export/grunddaten'
import { nachweisFrist, nachweisOffen, type NachweisFrist } from '@/lib/export/nachweise'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type NachweisZeile = { id: string; art: string; datum: string; dateiname: string; notiz: string | null; erstellt_am: string | null }

/** Nachweise eines Exportauftrags, älteste zuerst */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeExportNachweise(supabase: any, tenantId: string, auftragId: string): Promise<NachweisZeile[]> {
  const { data, error } = await alle<R>(supabase.from('export_nachweise')
    .select('id, art, datum, dateiname, notiz, erstellt_am')
    .eq('tenant_id', tenantId).eq('exportauftrag_id', auftragId)
    .order('datum').order('erstellt_am').order('id'))
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Nachweise konnten nicht geladen werden'))
  return data.map(z => ({ id: String(z.id), art: String(z.art), datum: String(z.datum), dateiname: String(z.dateiname), notiz: z.notiz ?? null, erstellt_am: z.erstellt_am ?? null }))
}

export type OffenerNachweis = { id: string; referenz: string | null; frist: NachweisFrist }

/**
 * Stand des Nachweises je Exportauftrag des Betriebs (nur Aufträge, bei denen etwas offen ist): für die Spalte in der
 * Liste und die Karte im Dashboard. Sortiert nach Dringlichkeit (überfällig zuerst, dann nach dem Fristende).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeOffeneNachweise(supabase: any, tenantId: string, heute: string): Promise<OffenerNachweis[]> {
  const auftraege = await alle<R>(supabase.from('exportauftraege')
    .select('id, referenz, status, storniert_am, mustersendung, verkaufsposten_id, abschluss_ohne_nachweis, versanddatum, destination_land, kunde_uid')
    .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null).eq('mustersendung', false)
    .order('id'))
  if (auftraege.error) throw new AktionsFehler(dbFehlerText(auftraege.error, 'Exportaufträge konnten nicht geladen werden'))
  // nur Aufträge, bei denen die Lieferung läuft: Rechnung gestellt bzw. ab „Versendet“
  const kandidaten = auftraege.data.filter(a => a.verkaufsposten_id || a.status === 'versendet' || a.status === 'abgeschlossen')
  if (kandidaten.length === 0) return []

  const nachweise = await alle<R>(supabase.from('export_nachweise')
    .select('id, exportauftrag_id').eq('tenant_id', tenantId).order('id'))
  if (nachweise.error) throw new AktionsFehler(dbFehlerText(nachweise.error, 'Nachweise konnten nicht geladen werden'))
  const anzahl = new Map<string, number>()
  for (const n of nachweise.data) anzahl.set(String(n.exportauftrag_id), (anzahl.get(String(n.exportauftrag_id)) ?? 0) + 1)

  // Rechnungsdatum = Datum des Verkaufs zum Auftrag (die Verknüpfung löst sich beim Storno des Verkaufs von selbst)
  const verkaufIds = [...new Set(kandidaten.map(a => a.verkaufsposten_id).filter(Boolean).map(String))]
  // storno-sichtbar: gesucht ist genau der mit dem Exportauftrag verknüpfte Verkauf – ein stornierter ist nicht mehr verknüpft
  const verkaeufe = await inBloecken<R>(verkaufIds, b => alle<R>(supabase.from('verkaufsposten')
    .select('id, datum').eq('tenant_id', tenantId).in('id', b).order('id')))
  if (verkaeufe.error) throw new AktionsFehler(dbFehlerText(verkaeufe.error, 'Rechnungen zu den Exportaufträgen konnten nicht geladen werden'))
  const rechnungsdatum = new Map(verkaeufe.data.map(v => [String(v.id), (v.datum ?? null) as string | null]))

  const rang: Record<string, number> = { ueberfaellig: 0, warnung: 1, hinweis: 2, offen: 3 }
  return kandidaten
    .map(a => ({
      id: String(a.id), referenz: (a.referenz ?? null) as string | null,
      frist: nachweisFrist({
        status: a.status, storniert_am: a.storniert_am, mustersendung: a.mustersendung, verkaufsposten_id: a.verkaufsposten_id,
        abschluss_ohne_nachweis: a.abschluss_ohne_nachweis, versanddatum: a.versanddatum,
        nachweise: anzahl.get(String(a.id)) ?? 0,
        rechnungsdatum: a.verkaufsposten_id ? rechnungsdatum.get(String(a.verkaufsposten_id)) ?? null : null,
        gebiet: lieferfall(a).gebiet,
      }, heute),
    }))
    .filter(z => nachweisOffen(z.frist))
    .sort((x, y) => (rang[x.frist.stufe] - rang[y.frist.stufe]) || String(x.frist.faelligAm ?? '9999').localeCompare(String(y.frist.faelligAm ?? '9999')) || x.id.localeCompare(y.id))
}
