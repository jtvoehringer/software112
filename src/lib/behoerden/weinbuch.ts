// ── Weinbuch je Charge und Weinbuch-Sammlung – Seiten UND CSV (24.09.2026) ─────
//
// Quelle bleibt buildWeinbuch() (lib/wein/weinbuch.ts): dieselben TimelineEvents wie auf
// /kellerbuch/weinausbau/[id]/buch und /reports/weinbuecher-sammlung. Die CSV hat eine
// Zeile je Ereignis: Charge, Datum, Art, Titel, Details (mit „ | “ verbunden), Status.
// Die Sammlung lädt die Weinbücher nacheinander (jedes stößt selbst ~10 Abfragen an).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import type { CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { buildWeinbuch, type EventTyp, type Weinbuch } from '@/lib/wein/weinbuch'
import { bkiRebsorteKuerzel, fehlendeKuerzelHinweise } from '@/lib/wein/bki_kuerzel'
import { text, type R } from './kellerbuch-hilfen'

export const WEINBUCH_TYP_LABEL: Record<EventTyp, string> = {
  feldbehandlung:   'Feldbehandlung',
  ernte:            'Ernte / Lese',
  pressung:         'Pressung',
  umzug:            'Umzug',
  kellerbehandlung: 'Kellerbehandlung',
  analyse:          'Analyse',
  dac:              'DAC / Prüfnummer',
  verschneidung:    'Verschneidung',
  umstufung:        'Abstufung',
  schwund:          'Schwund',
  fuellung:         'Füllung',
}

export const WEINBUCH_STATUS_LABEL: Record<string, string> = {
  ernte: 'Ernte', gaerung: 'Gärung', ausbau: 'Ausbau', abfuellung: 'Abfüllung', abgeschlossen: 'Abgeschlossen',
}

export type WeinbuchZeile = {
  charge: string
  jahrgang: number | null
  rebsorte: string | null
  kuerzel: string | null
  gebinde: string | null
  /** 'JJJJ-MM-TT' bzw. Zeitpunkt (DAC-Anträge) – die CSV rechnet Zeitpunkte in Wiener Zeit um */
  datum: string
  art: string
  titel: string
  details: string
  status: string | null
}

/** Eine Zeile je TimelineEvent */
export function weinbuchZeilen(wb: Weinbuch): WeinbuchZeile[] {
  return wb.events.map(e => ({
    charge: wb.wa.name,
    jahrgang: wb.wa.jahrgang ?? null,
    rebsorte: text(wb.wa.rebsorte),
    kuerzel: bkiRebsorteKuerzel(text(wb.wa.rebsorte)),
    gebinde: text(wb.wa.behaelter_name),
    datum: e.datum,
    art: WEINBUCH_TYP_LABEL[e.typ] ?? e.typ,
    titel: e.titel,
    details: e.details.filter(Boolean).join(' | '),
    status: text(e.badge),
  }))
}

export const SPALTEN_WEINBUCH: CsvSpalte<WeinbuchZeile>[] = [
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Gebinde (aktuell)', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  { kopf: 'Ereignis', typ: 'text', wert: z => z.titel },
  { kopf: 'Details', typ: 'text', wert: z => z.details },
  { kopf: 'Status', typ: 'text', wert: z => z.status },
]

/** Hinweise eines Weinbuchs: aus buildWeinbuch() plus Rebsorte ohne amtliches Kürzel (KAN-36) */
function weinbuchWarnungen(wb: Weinbuch, mitCharge: boolean): string[] {
  const praefix = mitCharge ? `Charge „${wb.wa.name}“: ` : ''
  return [
    ...(wb.warnungen ?? []).map(w => praefix + w),
    ...fehlendeKuerzelHinweise([wb.wa.rebsorte], { einheit: ['Charge', 'Chargen'], stammdaten: 'Charge' }),
  ]
}

/** Weinbuch einer Charge – null, wenn die Charge im aktiven Betrieb nicht existiert */
export async function ladeWeinbuch(
  supabase: any,
  tenantId: string,
  p: { chargeId: string },
): Promise<{ weinbuch: Weinbuch; zeilen: WeinbuchZeile[]; warnungen: string[] } | null> {
  const weinbuch = await buildWeinbuch(supabase, p.chargeId, tenantId)
  if (!weinbuch) return null
  return { weinbuch, zeilen: weinbuchZeilen(weinbuch), warnungen: weinbuchWarnungen(weinbuch, false) }
}

export type WeinbuchFilter = { jahrgang: number | null; sorte: string | null; bezeichnung: string | null }

/** Weinbücher aller Chargen (auch abgeschlossener), die den Filtern entsprechen */
export async function ladeWeinbuchSammlung(
  supabase: any,
  tenantId: string,
  f: WeinbuchFilter,
): Promise<{ weinbuecher: Weinbuch[]; zeilen: WeinbuchZeile[]; warnungen: string[] }> {
  let q = (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte')
    .eq('tenant_id', tenantId)
  if (f.jahrgang !== null) q = q.eq('jahrgang', f.jahrgang)
  if (f.sorte) q = q.eq('rebsorte', f.sorte)
  if (f.bezeichnung) q = q.eq('name', f.bezeichnung)
  const { data, error } = await alle<R>(q.order('jahrgang', { ascending: false }).order('name').order('id'))
  if (error) throw new Error(`Chargen konnten nicht geladen werden: ${error.message}`)

  // Nacheinander (nicht parallel) – jedes Weinbuch stößt selbst ~10 parallele Abfragen an
  const weinbuecher: Weinbuch[] = []
  let fehlend = 0
  for (const c of data) {
    const wb = await buildWeinbuch(supabase, c.id, tenantId)
    if (wb) weinbuecher.push(wb)
    else fehlend++
  }
  const warnungen = fehlend > 0 ? [`${fehlend} ${fehlend === 1 ? 'Weinbuch konnte' : 'Weinbücher konnten'} nicht geladen werden.`] : []
  for (const wb of weinbuecher) warnungen.push(...(wb.warnungen ?? []).map(w => `Charge „${wb.wa.name}“: ${w}`))
  warnungen.push(...fehlendeKuerzelHinweise(weinbuecher.map(wb => wb.wa.rebsorte), { einheit: ['Charge', 'Chargen'], stammdaten: 'Charge' }))
  return { weinbuecher, zeilen: weinbuecher.flatMap(weinbuchZeilen), warnungen }
}

/** Auswahllisten für die Filter der Sammlung (Jahrgänge, Sorten, Bezeichnungen) */
export async function ladeWeinbuchFilter(supabase: any, tenantId: string): Promise<{ jahrgaenge: number[]; sorten: string[]; bezeichnungen: string[] }> {
  const { data, error } = await alle<R>((supabase.from('weinausbau') as any)
    .select('id, jahrgang, rebsorte, name')
    .eq('tenant_id', tenantId)
    .order('id'))
  if (error) throw new Error(`Chargen konnten nicht geladen werden: ${error.message}`)
  const jahrgaenge = [...new Set(data.map(c => c.jahrgang).filter((j): j is number => typeof j === 'number'))].sort((a, b) => b - a)
  const sorten = [...new Set(data.map(c => text(c.rebsorte)).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'de'))
  const bezeichnungen = [...new Set(data.map(c => text(c.name)).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'de'))
  return { jahrgaenge, sorten, bezeichnungen }
}
