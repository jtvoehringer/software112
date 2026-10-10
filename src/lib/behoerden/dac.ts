// ── Behördenmeldung „DAC- und Prüfnummernanträge“ (Liste, 24.09.2026) ─────────────
//
// Eine Ladefunktion für die Übersicht /dac UND die CSV (/meldungen/dac-antraege/csv):
// alle DAC-Anträge des Betriebs (wie die Übersicht: auch inaktive, neueste zuerst)
// mit Bezeichnung, DAC-Region, Jahrgang, Rebsorte, Menge, Alkohol, Status,
// Einreichung, Prüfnummer und Bescheid. KAN-150 F2: stornierte Anträge bleiben mit Vermerk in der Liste.
//
// Isomorph ohne Server-Importe – Tests: scripts/tests/verkehr.test.mjs

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { feld, textOderNull, type R } from './verkehr-hilfen'
import { PN_STATUS_LABEL, pnFormatHinweis } from '../dac/workflow'
import { sortenKuerzel } from '@/lib/wein/bki_kuerzel'
import { AktionsFehler } from '@/lib/fehler'

export const DAC_REGION_LABEL: Record<string, string> = {
  weinviertel: 'Weinviertel', kamptal: 'Kamptal', kremstal: 'Kremstal',
  wachau: 'Wachau', wagram: 'Wagram', traisental: 'Traisental',
  carnuntum: 'Carnuntum', leithaberg: 'Leithaberg', neusiedlersee: 'Neusiedlersee',
  mittelburgenland: 'Mittelburgenland', eisenberg: 'Eisenberg', rosalia: 'Rosalia',
  wiener_gemischter_satz: 'Wiener Gemischter Satz', sonstiges: 'Sonstiges',
}

// KAN-97: Statusmodell des Prüfnummernantrags (DB-Wert 'genehmigt' = „Zugeteilt“)
export const DAC_STATUS_LABEL: Record<string, string> = PN_STATUS_LABEL

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
  /** KAN-98: seit wann der Status gilt (timestamptz) */
  statusSeit: string | null
  eingereichtAm: string | null
  pruefnummer: string | null
  bescheidAm: string | null
  aktiv: boolean
  /** KAN-150 F2: Zeitpunkt, Benutzer und Grund des Stornos (null = gültig) */
  storniertAm: string | null
  storniertVon: string | null
  stornoGrund: string | null
}

export const SPALTEN_DAC_ANTRAEGE: CsvSpalte<DacAntragZeile>[] = [
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'DAC-Region', typ: 'text', wert: z => z.dacRegionLabel },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  // KAN-89: Vorgabe BKI – neben der Sorte das Sortenkürzel
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => sortenKuerzel(z.rebsorte) },
  { kopf: 'Menge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.mengeLiter },
  { kopf: 'Alkohol (% vol)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.alkoholProzent },
  { kopf: 'Status', typ: 'text', wert: z => z.statusLabel },
  { kopf: 'Status seit', typ: 'zeitpunkt', wert: z => z.statusSeit },   // KAN-98
  { kopf: 'Eingereicht am', typ: 'datum', wert: z => z.eingereichtAm },
  { kopf: 'Staatliche Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Bescheid am', typ: 'datum', wert: z => z.bescheidAm },
  { kopf: 'Aktiv', typ: 'janein', wert: z => z.aktiv },
  { kopf: 'Storniert am', typ: 'zeitpunkt', wert: z => z.storniertAm },
  { kopf: 'Storno-Grund', typ: 'text', wert: z => z.stornoGrund },
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
    statusSeit: textOderNull(a.status_seit),
    eingereichtAm: textOderNull(a.eingereicht_am),
    pruefnummer: feld(a.pruefnummer) || null,
    bescheidAm: textOderNull(a.bescheid_am),
    aktiv: a.aktiv !== false,
    storniertAm: textOderNull(a.storniert_am),
    storniertVon: textOderNull(a.storniert_von_name),
    stornoGrund: textOderNull(a.storno_grund),
  }
}

type Client = any

/** Alle DAC-Anträge des Betriebs (neueste zuerst, inkl. inaktiver) – für /dac und die CSV */
export async function ladeDacAntraege(supabase: Client, tenantId: string): Promise<{ zeilen: DacAntragZeile[]; warnungen: string[] }> {
  const { data, error } = await alle<R>((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, status_seit, pruefnummer, eingereicht_am, bescheid_am, aktiv, created_at, storniert_am, storniert_von_name, storno_grund')   // storno-sichtbar: Liste zeigt Stornos mit Vermerk
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id'))
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (dac_antrag): ${error.message}`)
  const zeilen = data.map(dacZeile)
  // KAN-98: Prüfnummern in ungewöhnlichem Format als Warnung (nicht gesperrt – die Nummer vergibt das Bundesamt)
  const warnungen = zeilen.filter(z => !z.storniertAm).map(z => {
    const h = pnFormatHinweis(z.pruefnummer)
    return h ? `${z.bezeichnung ?? 'Antrag'}: ${h}` : null
  }).filter((w): w is string => !!w)
  return { zeilen, warnungen }
}
