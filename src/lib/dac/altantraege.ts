// ── Prüfbericht für Prüfnummernanträge vor dem Workflow (KAN-197, 06.10.2026) ──
//
// Anträge, die vor KAN-97 (04.10.2026) eingereicht wurden, haben keine Ereignisse in pruefnummer_ereignisse und
// keinen Charge-Snapshot; niemand hat geprüft, ob ihre Angaben noch zum Wein passen. Altantrag = nicht storniert,
// Status ≠ Entwurf, ohne Ereignis. Befunde je Antrag:
//  - Zugeteilt ohne Prüfnummer bzw. ohne Bescheiddatum, fehlendes Einreichdatum, Bescheid vor Einreichung, keine Charge
//  - für offene und zugeteilte Anträge die Regeln aus KAN-72/83/99 (antragVerletzung): Zugang in die Charge nach der
//    Einreichung, Ende der Gültigkeit für den Tankbestand, Bestand größer als beantragt − abgefüllt
// Nur ein Bericht für die Betriebsleitung – keine automatische Statusänderung. Korrektur über den Statuswechsel bzw.
// „Mit Grund korrigieren“ (KAN-196) auf der Seite des Antrags.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle, inBloecken } from '@/lib/supabase/alle'
import { antragVerletzung, pnDatumDe, pnZugangText, type PnChargeDaten } from '@/lib/kellerbuch/pruefnummer'
import { ladePruefnummerDaten } from '@/lib/kellerbuch/pruefnummerLaden'
import { pnStatusLabel } from './workflow'
import { AktionsFehler } from '@/lib/fehler'

type R = Record<string, any>

export type AltantragBefund = {
  id: string
  bezeichnung: string
  status: string
  pruefnummer: string | null
  befunde: string[]
}

const liter = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} l`
const leer = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
const tag = (v: unknown) => (leer(v) ? null : String(v).slice(0, 10))

/** Befunde eines Altantrags (leer = unauffällig). `daten` = Prüfnummer-Daten seiner Charge (null ohne Charge). */
export function altantragBefunde(a: R, daten: PnChargeDaten | null, heute: string): string[] {
  const b: string[] = []
  const status = String(a.status ?? '')
  if (status === 'genehmigt' && leer(a.pruefnummer)) b.push('„Zugeteilt“, aber keine Prüfnummer erfasst.')
  if (status === 'genehmigt' && leer(a.bescheid_am)) b.push('„Zugeteilt“, aber kein Bescheiddatum erfasst.')
  if (leer(a.eingereicht_am)) b.push('Einreichdatum fehlt – Zugänge in die Charge lassen sich nicht sicher prüfen.')
  const ein = tag(a.eingereicht_am)
  const bes = tag(a.bescheid_am)
  if (ein && bes && bes < ein) b.push(`Bescheid (${pnDatumDe(bes)}) liegt vor der Einreichung (${pnDatumDe(ein)}).`)
  if (leer(a.weinausbau_id)) {
    b.push('Keiner Charge zugeordnet – Zugänge und Menge nicht prüfbar.')
    return b
  }
  if (!['eingereicht', 'in_pruefung', 'genehmigt'].includes(status)) return b
  const antrag = daten?.antraege.find(x => x.id === a.id) ?? null
  if (!daten || !antrag) {
    b.push('Charge nicht gefunden – Zugänge und Menge nicht prüfbar.')
    return b
  }
  const v = antragVerletzung(antrag, daten, heute)
  if (v?.grund === 'menge' && v.menge) {
    b.push(`Bestand ${liter(v.menge.bestandLiter)} größer als beantragt ${liter(v.menge.beantragtLiter)} − abgefüllt ${liter(v.menge.abgefuelltLiter)} (höchstens ${liter(Math.max(0, v.menge.zulaessigLiter))}).`)
  } else if (v && v.grund !== 'menge') {
    b.push(`Wein passt nicht mehr zum Antrag: ${pnZugangText(v.grund, v.ereignisDatum)}.`)
  }
  return b
}

/** Prüfbericht aller Altanträge des Betriebs (Altantrag = nicht storniert, Status ≠ Entwurf, ohne Ereignis) */
export async function ladeAltantragPruefung(supabase: any, tenantId: string, heute: string): Promise<AltantragBefund[]> {
  const aRes = await alle<R>((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, status, pruefnummer, eingereicht_am, bescheid_am, weinausbau_id')
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)
    .neq('status', 'entwurf')
    .order('id'))
  if (aRes.error) throw new AktionsFehler(`Prüfnummernanträge konnten nicht geladen werden: ${aRes.error.message}`)
  if (aRes.data.length === 0) return []
  const eRes = await inBloecken<R>(aRes.data.map(a => a.id), block => alle<R>((supabase.from('pruefnummer_ereignisse') as any)
    .select('id, dac_antrag_id')
    .eq('tenant_id', tenantId)
    .in('dac_antrag_id', block)
    .order('id')))
  if (eRes.error) throw new AktionsFehler(`Ereignisse der Prüfnummernanträge konnten nicht geladen werden: ${eRes.error.message}`)
  const mitEreignis = new Set(eRes.data.map(e => String(e.dac_antrag_id)))
  const alt = aRes.data.filter(a => !mitEreignis.has(String(a.id)))
  if (alt.length === 0) return []
  const daten = await ladePruefnummerDaten(supabase, tenantId, alt.map(a => a.weinausbau_id), { heute })
  return alt
    .map(a => ({
      id: String(a.id),
      bezeichnung: String(a.bezeichnung ?? ''),
      status: pnStatusLabel(a.status),
      pruefnummer: leer(a.pruefnummer) ? null : String(a.pruefnummer),
      befunde: altantragBefunde(a, a.weinausbau_id ? daten.get(String(a.weinausbau_id)) ?? null : null, heute),
    }))
    .sort((x, y) => y.befunde.length - x.befunde.length || x.bezeichnung.localeCompare(y.bezeichnung, 'de'))
}
