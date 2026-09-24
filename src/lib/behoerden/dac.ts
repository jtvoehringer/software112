// ── Behördenmeldung „DAC- und Prüfnummernanträge“ (Liste, 24.09.2026) ─────────────
//
// Eine Ladefunktion für die Übersicht /dac UND die CSV (/meldungen/dac-antraege/csv):
// alle DAC-Anträge des Betriebs (wie die Übersicht: auch inaktive, neueste zuerst)
// mit Bezeichnung, DAC-Region, Jahrgang, Rebsorte, Menge, Alkohol, Status,
// Einreichung, Prüfnummer und Bescheid.
//
// Isomorph ohne Server-Importe – Tests: scripts/tests/verkehr.test.mjs

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { feld, textOderNull, type R } from './verkehr-hilfen'

export const DAC_REGION_LABEL: Record<string, string> = {
  weinviertel: 'Weinviertel', kamptal: 'Kamptal', kremstal: 'Kremstal',
  wachau: 'Wachau', wagram: 'Wagram', traisental: 'Traisental',
  carnuntum: 'Carnuntum', leithaberg: 'Leithaberg', neusiedlersee: 'Neusiedlersee',
  mittelburgenland: 'Mittelburgenland', eisenberg: 'Eisenberg', rosalia: 'Rosalia',
  wiener_gemischter_satz: 'Wiener Gemischter Satz', sonstiges: 'Sonstiges',
}

export const DAC_STATUS_LABEL: Record<string, string> = {
  entwurf: 'Entwurf',
  eingereicht: 'Eingereicht',
  in_pruefung: 'In Prüfung',
  genehmigt: 'Genehmigt',
  abgelehnt: 'Abgelehnt',
}

export type DacAntragZeile = {
  id: string
  bezeichnung: string | null
  /** Schlüssel (z. B. 'weinviertel') und Anzeigetext */
  dacRegion: string | null
  dacRegionLabel: string | null
  jahrgang: number | null
  rebsorte: string | null
  mengeLiter: number | null
  alkoholProzent: number | null
  status: string | null
  statusLabel: string | null
  eingereichtAm: string | null
  pruefnummer: string | null
  bescheidAm: string | null
  aktiv: boolean
}

export const SPALTEN_DAC_ANTRAEGE: CsvSpalte<DacAntragZeile>[] = [
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'DAC-Region', typ: 'text', wert: z => z.dacRegionLabel },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'Menge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.mengeLiter },
  { kopf: 'Alkohol (% vol)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.alkoholProzent },
  { kopf: 'Status', typ: 'text', wert: z => z.statusLabel },
  { kopf: 'Eingereicht am', typ: 'datum', wert: z => z.eingereichtAm },
  { kopf: 'Staatliche Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Bescheid am', typ: 'datum', wert: z => z.bescheidAm },
  { kopf: 'Aktiv', typ: 'janein', wert: z => z.aktiv },
]

function zahlOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** DB-Zeile (dac_antrag) → Listenzeile, Zahlen bereits gerundet */
export function dacZeile(a: R): DacAntragZeile {
  const region = textOderNull(a.dac_region)
  const status = textOderNull(a.status)
  const menge = zahlOderNull(a.menge_liter)
  const alkohol = zahlOderNull(a.alkohol_prozent)
  const jahrgang = zahlOderNull(a.jahrgang)
  return {
    id: String(a.id),
    bezeichnung: textOderNull(a.bezeichnung),
    dacRegion: region,
    dacRegionLabel: region ? (DAC_REGION_LABEL[region] ?? region) : null,
    jahrgang: jahrgang === null ? null : Math.trunc(jahrgang),
    rebsorte: textOderNull(a.rebsorte),
    mengeLiter: menge === null ? null : runden(menge, STELLEN.liter),
    alkoholProzent: alkohol === null ? null : runden(alkohol, STELLEN.prozent),
    status,
    statusLabel: status ? (DAC_STATUS_LABEL[status] ?? status) : null,
    eingereichtAm: textOderNull(a.eingereicht_am),
    pruefnummer: feld(a.pruefnummer) || null,
    bescheidAm: textOderNull(a.bescheid_am),
    aktiv: a.aktiv !== false,
  }
}

type Client = any

/** Alle DAC-Anträge des Betriebs (neueste zuerst, inkl. inaktiver) – für /dac und die CSV */
export async function ladeDacAntraege(supabase: Client, tenantId: string): Promise<{ zeilen: DacAntragZeile[]; warnungen: string[] }> {
  const { data, error } = await alle<R>((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, eingereicht_am, bescheid_am, aktiv, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id'))
  if (error) throw new Error(`Laden fehlgeschlagen (dac_antrag): ${error.message}`)
  return { zeilen: data.map(dacZeile), warnungen: [] }
}
