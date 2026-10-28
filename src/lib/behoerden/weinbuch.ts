// ── Weinbuch je Charge und Weinbuch-Sammlung – Seiten UND CSV (24.09.2026) ─────
//
// Quelle bleibt buildWeinbuch() (lib/wein/weinbuch.ts): dieselben TimelineEvents wie auf
// /kellerbuch/weinausbau/[id]/buch und /reports/weinbuecher-sammlung. Die CSV hat eine
// Zeile je Ereignis: Charge, Datum, Art, Titel, Details (mit „ | “ verbunden), Status.
// Die Sammlung lädt höchstens WEINBUCH_SAMMLUNG_MAX Chargen, je WEINBUCH_SAMMLUNG_PARALLEL gleichzeitig
// (KAN-385: ohne Grenze lud die Seite alle Chargen des Betriebs nacheinander und kam nicht zustande).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import type { CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { buildWeinbuch, type EventTyp, type Weinbuch } from '@/lib/wein/weinbuch'
import { pnStandAm } from '@/lib/kellerbuch/pruefnummerVerlauf'
import { wienTag } from '@/lib/datum/wien'
import { ladeJournalBeginn } from '@/lib/kellerbuch/journal'
import { bkiRebsorteKuerzel, fehlendeKuerzelHinweise } from '@/lib/wein/bki_kuerzel'
import { text, type R } from './kellerbuch-hilfen'
import { AktionsFehler } from '@/lib/fehler'
import { MeldungsFehler } from './typen'

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
  eroeffnung:       'Eröffnungsbestand',   // KAN-44: Mengenbewegungen aus dem Journal
  zukauf:           'Zukauf',
  verkauf:          'Fassverkauf',
  bestand:          'Mengenbewegung',
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
  /** KAN-200: aktuell gültige Prüfnummer der Charge (Kopf) */
  pruefnummer: string | null
  /** 'JJJJ-MM-TT' bzw. Zeitpunkt (DAC-Anträge) – die CSV rechnet Zeitpunkte in Wiener Zeit um */
  datum: string
  art: string
  titel: string
  details: string
  status: string | null
  /** KAN-365: Gebinde, aus dem der Wein kam (Umzug, Verschnitt) */
  quellgebinde: string | null
  /** KAN-365: für den Tankbestand gültige Prüfnummer der Charge am Datum der Zeile (sonst leer) */
  pruefnummerAmDatum: string | null
}

/** Kalendertag einer Zeile: reines Datum bleibt, Zeitpunkte (DAC-Anträge) in Wiener Zeit */
function zeilenTag(datum: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) return datum
  const d = new Date(datum)
  return Number.isNaN(d.getTime()) ? null : wienTag(d)
}

/** Eine Zeile je TimelineEvent */
export function weinbuchZeilen(wb: Weinbuch): WeinbuchZeile[] {
  const pnAm = (datum: string): string | null => {
    const t = zeilenTag(datum)
    const s = t && wb.pnVerlauf ? pnStandAm(wb.pnVerlauf, t) : null
    return s?.art === 'gueltig' ? s.pruefnummer : null
  }
  return wb.events.map(e => ({
    charge: wb.wa.name,
    jahrgang: wb.wa.jahrgang ?? null,
    rebsorte: text(wb.wa.rebsorte),
    kuerzel: bkiRebsorteKuerzel(text(wb.wa.rebsorte)),
    gebinde: text(wb.wa.behaelter_name),
    pruefnummer: text(wb.wa.pruefnummer),
    datum: e.datum,
    art: WEINBUCH_TYP_LABEL[e.typ] ?? e.typ,
    titel: e.titel,
    details: e.details.filter(Boolean).join(' | '),
    status: text(e.badge),
    quellgebinde: text(e.quellgebinde),
    pruefnummerAmDatum: pnAm(e.datum),
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
  // KAN-200: aktuell gültige Prüfnummer der Charge (auch übernommen) – am Ende, damit die bisherigen Spalten bleiben
  { kopf: 'Prüfnummer der Charge (aktuell)', typ: 'text', wert: z => z.pruefnummer },
  // KAN-365 (UAT 27.10.2026): Quellgebinde als eigene Spalte (bisher nur im Text „Details“) und die am Datum der Zeile
  // gültige Prüfnummer – ebenfalls am Ende, die bisherigen Spalten bleiben
  { kopf: 'Quellgebinde', typ: 'text', wert: z => z.quellgebinde },
  { kopf: 'Prüfnummer (gültig am Datum)', typ: 'text', wert: z => z.pruefnummerAmDatum },
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

/** KAN-385: höchstens so viele Weinbücher je Abruf (Seite und CSV) – sonst enger filtern */
export const WEINBUCH_SAMMLUNG_MAX = 30
/** KAN-385: so viele Weinbücher gleichzeitig (jedes stößt selbst rund 20 Abfragen an) */
export const WEINBUCH_SAMMLUNG_PARALLEL = 5

export type WeinbuchCharge = { id: string; name: string | null; jahrgang: number | null; rebsorte: string | null; status: string | null }

export function zuVieleChargenText(anzahl: number): string {
  return `${anzahl} Chargen entsprechen der Auswahl – höchstens ${WEINBUCH_SAMMLUNG_MAX} je Weinbuch-Sammlung. Bitte enger filtern (Jahrgang, Sorte oder Bezeichnung).`
}

/** Chargen (auch abgeschlossene), die den Filtern entsprechen – ohne ihre Weinbücher */
export async function ladeWeinbuchChargen(supabase: any, tenantId: string, f: WeinbuchFilter): Promise<WeinbuchCharge[]> {
  let q = (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, status')
    .eq('tenant_id', tenantId)
  if (f.jahrgang !== null) q = q.eq('jahrgang', f.jahrgang)
  if (f.sorte) q = q.eq('rebsorte', f.sorte)
  if (f.bezeichnung) q = q.eq('name', f.bezeichnung)
  const { data, error } = await alle<R>(q.order('jahrgang', { ascending: false }).order('name').order('id'))
  if (error) throw new AktionsFehler(`Chargen konnten nicht geladen werden: ${error.message}`)
  return data.map(c => ({ id: c.id, name: text(c.name), jahrgang: typeof c.jahrgang === 'number' ? c.jahrgang : null, rebsorte: text(c.rebsorte), status: text(c.status) }))
}

/** f auf jedes Element, höchstens n gleichzeitig; Ergebnis in der Reihenfolge der Eingabe */
export async function begrenztParallel<T, E>(liste: T[], n: number, f: (x: T) => Promise<E>): Promise<E[]> {
  const ergebnis: E[] = new Array(liste.length)
  let naechster = 0
  const arbeiter = async () => {
    while (naechster < liste.length) {
      const i = naechster++
      ergebnis[i] = await f(liste[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, arbeiter))
  return ergebnis
}

/** Weinbücher der Chargen, die den Filtern entsprechen – mehr als WEINBUCH_SAMMLUNG_MAX → MeldungsFehler 400 */
export async function ladeWeinbuchSammlung(
  supabase: any,
  tenantId: string,
  f: WeinbuchFilter,
  vorab?: WeinbuchCharge[],
): Promise<{ weinbuecher: Weinbuch[]; zeilen: WeinbuchZeile[]; warnungen: string[] }> {
  const chargen = vorab ?? await ladeWeinbuchChargen(supabase, tenantId, f)
  if (chargen.length > WEINBUCH_SAMMLUNG_MAX) throw new MeldungsFehler(400, zuVieleChargenText(chargen.length))

  // Journalbeginn einmal (KAN-44); je WEINBUCH_SAMMLUNG_PARALLEL Weinbücher gleichzeitig (KAN-385)
  const journalBeginn = await ladeJournalBeginn(supabase, tenantId)
  const geladen = await begrenztParallel(chargen, WEINBUCH_SAMMLUNG_PARALLEL, c => buildWeinbuch(supabase, c.id, tenantId, { journalBeginn }))
  const weinbuecher = geladen.filter((wb): wb is Weinbuch => !!wb)
  const fehlend = geladen.length - weinbuecher.length
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
  if (error) throw new AktionsFehler(`Chargen konnten nicht geladen werden: ${error.message}`)
  const jahrgaenge = [...new Set(data.map(c => c.jahrgang).filter((j): j is number => typeof j === 'number'))].sort((a, b) => b - a)
  const sorten = [...new Set(data.map(c => text(c.rebsorte)).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'de'))
  const bezeichnungen = [...new Set(data.map(c => text(c.name)).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'de'))
  return { jahrgaenge, sorten, bezeichnungen }
}
