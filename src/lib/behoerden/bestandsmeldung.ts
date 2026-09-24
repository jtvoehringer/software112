// ── Weinbestandsmeldung – Bestand am ABRUFDATUM (Behördenmeldung, 24.09.2026) ──────
//
// Genau der Inhalt des Abschnitts „Weinbestandsmeldung“ auf /reports/ama:
//   A – Flaschenwein            fuellungen (aktiv, bestand_flaschen > 0)
//   B – Wein in Gebinden        weinausbau (aktiv, nicht abgeschlossen, menge_liter > 0)
// Das ist der Bestand am Tag des Abrufs, KEIN Stichtagsbestand zum 31. Juli – die
// Datei sagt das im Namen, in der Spalte „Bestand am“ und als Warnung. Den echten
// Stichtagsbestand (?stichtag=, Rekonstruktion aus den Bewegungen) baut KAN-43.
//
// Druckseite und CSV nutzen diese Ladefunktion; Zeilenwerte sind gerundet (Liter 2,
// hl 3 Stellen wie bisher im Ausdruck), die Summen im Ausdruck addieren genau diese.
// Farbe (Weinart der Charge, sonst aus der BKI-Kürzelliste) und Qualitätsstufe je Position
// (Review 25.09.2026) – danach gliedert das amtliche Formular.
// Gebinde der Kellergemeinschaft: Namen über lade_behaelter (SECURITY DEFINER) –
// fremde Gebinde heißen „a1 · Weingut X“; Wein anderer Betriebe zählt nie mit.

import { STELLEN, runden, wienHeute, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { bkiFarbe, bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { datumAT, kuerzelWarnungen, textOderNull, zahlOderNull } from './ernte_hilfen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

/** hl im Bestand mit 3 Stellen (wie der bisherige Ausdruck) */
export const HL_STELLEN_BESTAND = 3
/** Flaschengröße, wenn an der Füllung keine erfasst ist (wie bisher im Ausdruck) */
export const FLASCHE_ML_STANDARD = 750

export type BestandZeile = {
  abschnitt: 'A' | 'B'
  /** Abrufdatum 'JJJJ-MM-TT' (Wiener Zeit) */
  bestandAm: string
  bezeichnung: string | null
  jahrgang: number | null
  rebsorte: string | null
  kuerzel: string | null
  /** Rot/Weiß/Rosé – Weinart der Charge, sonst aus der BKI-Kürzelliste; null = nicht bestimmbar */
  farbe: string | null
  /** Qualitätsstufe (Anzeige-Bezeichnung) */
  qualitaet: string | null
  /** nur B: Gebinde (fremde Gebinde „a1 · Weingut X“) */
  behaelter: string | null
  /** nur A */
  flaschengroesseMl: number | null
  /** nur A */
  flaschen: number | null
  liter: number | null
  hl: number | null
}

export type BestandsmeldungDaten = {
  bestandAm: string
  flaschen: BestandZeile[]
  gebinde: BestandZeile[]
  /** A und B in einer Liste (CSV) */
  zeilen: BestandZeile[]
  summe: { flaschen: number; flaschenHl: number; gebindeHl: number; gesamtHl: number }
  warnungen: string[]
}

const FARBE_LABEL: Record<string, string> = { rot: 'Rot', weiss: 'Weiß', rose: 'Rosé' }

/** Farbe: Weinart der Charge (rot/weiss/rose), sonst aus der BKI-Kürzelliste */
function farbeAus(weinart: unknown, rebsorte: string | null): string | null {
  if (typeof weinart === 'string' && FARBE_LABEL[weinart]) return FARBE_LABEL[weinart]
  const f = bkiFarbe(rebsorte)
  return f ? FARBE_LABEL[f] : null
}

export const ABSCHNITT_LABEL: Record<BestandZeile['abschnitt'], string> = {
  A: 'A – Flaschenwein',
  B: 'B – Wein in Gebinden (Tank / Fass)',
}

/** Kennzeichnung für Dateiname und Hinweise */
export function bestandKennzeichnung(bestandAm: string): string {
  return `Bestand am ${bestandAm} – kein Stichtagsbestand`
}

export async function ladeBestandsmeldung(
  supabase: Client,
  tenantId: string,
  opts: { bestandAm?: string } = {},
): Promise<BestandsmeldungDaten> {
  const bestandAm = opts.bestandAm ?? wienHeute()
  const warnungen: string[] = [
    `Bestand am ${datumAT(bestandAm)} (Abrufdatum) – KEIN Stichtagsbestand zum 31. Juli. Für die Weinbestandsmeldung den Bestand zum Stichtag prüfen; die Stichtagsberechnung folgt.`,
  ]

  const [fRes, wRes] = await Promise.all([
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('fuellungen') as any)
        .select('id, name, jahrgang, rebsorte, qualitaet, flaschengroesse_ml, bestand_flaschen, weinausbau:weinausbau_id(weinart)')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .gt('bestand_flaschen', 0)
        .order('name')
        .order('id'),
    ),
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinausbau') as any)
        .select('id, name, jahrgang, rebsorte, qualitaetsstufe, weinart, menge_liter, status, behaelter_id, behaelter:behaelter_id(name)')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .neq('status', 'abgeschlossen')
        .gt('menge_liter', 0)
        .order('jahrgang', { ascending: false })
        .order('name')
        .order('id'),
    ),
  ])
  if (fRes.error) throw new Error(`Laden fehlgeschlagen (fuellungen): ${fRes.error.message}`)
  if (wRes.error) throw new Error(`Laden fehlgeschlagen (weinausbau): ${wRes.error.message}`)

  // Gebindenamen inkl. Kellergemeinschaft; scheitert die RPC, bleibt der eigene Name
  const gebindeName = new Map<string, string>()
  if (wRes.data.some(w => w.behaelter_id)) {
    try {
      for (const b of await ladeBehaelter(supabase, tenantId)) gebindeName.set(b.id, b.anzeigeName)
    } catch {
      warnungen.push('Gebindenamen der Kellergemeinschaft konnten nicht geladen werden – bei Partner-Gebinden fehlt der Betriebsname.')
    }
  }

  let ohneGroesse = 0
  const flaschen: BestandZeile[] = fRes.data.map(f => {
    const anzahl = zahlOderNull(f.bestand_flaschen) ?? 0
    const erfasst = zahlOderNull(f.flaschengroesse_ml)
    if (erfasst === null) ohneGroesse++
    const ml = erfasst ?? FLASCHE_ML_STANDARD
    const rebsorte = textOderNull(f.rebsorte)
    return {
      abschnitt: 'A', bestandAm,
      bezeichnung: textOderNull(f.name),
      jahrgang: zahlOderNull(f.jahrgang),
      rebsorte, kuerzel: bkiRebsorteKuerzel(rebsorte),
      farbe: farbeAus((f.weinausbau as R | null)?.weinart, rebsorte),
      qualitaet: textOderNull(f.qualitaet) ? qualitaetLabel(f.qualitaet) : null,
      behaelter: null,
      flaschengroesseMl: ml,
      flaschen: anzahl,
      liter: runden((anzahl * ml) / 1000, STELLEN.liter),
      hl: runden((anzahl * ml) / 100000, HL_STELLEN_BESTAND),
    }
  })
  if (ohneGroesse > 0) {
    warnungen.push(`${ohneGroesse} ${ohneGroesse === 1 ? 'Füllung' : 'Füllungen'} ohne Flaschengröße – ${FLASCHE_ML_STANDARD} ml angenommen (wie im Ausdruck).`)
  }

  const gebinde: BestandZeile[] = wRes.data.map(w => {
    const liter = zahlOderNull(w.menge_liter) ?? 0
    const rebsorte = textOderNull(w.rebsorte)
    return {
      abschnitt: 'B', bestandAm,
      bezeichnung: textOderNull(w.name),
      jahrgang: zahlOderNull(w.jahrgang),
      rebsorte, kuerzel: bkiRebsorteKuerzel(rebsorte),
      farbe: farbeAus(w.weinart, rebsorte),
      qualitaet: textOderNull(w.qualitaetsstufe) ? qualitaetLabel(w.qualitaetsstufe) : null,
      behaelter: (w.behaelter_id ? gebindeName.get(w.behaelter_id) : undefined) ?? textOderNull((w.behaelter as R | null)?.name),
      flaschengroesseMl: null,
      flaschen: null,
      liter: runden(liter, STELLEN.liter),
      hl: runden(liter / 100, HL_STELLEN_BESTAND),
    }
  })

  const zeilen = [...flaschen, ...gebinde]
  warnungen.push(...kuerzelWarnungen(zeilen.map(z => z.rebsorte), ['Position', 'Positionen']))
  const ohneFarbe = zeilen.filter(z => z.farbe === null).length
  if (ohneFarbe > 0) warnungen.push(`${ohneFarbe} ${ohneFarbe === 1 ? 'Position' : 'Positionen'} ohne bestimmbare Farbe (weder Weinart der Charge noch eindeutige Rebsorte) – Spalte „Farbe“ leer gelassen.`)

  const summe = (liste: BestandZeile[]) => runden(liste.reduce((s, z) => s + (z.hl ?? 0), 0), HL_STELLEN_BESTAND)
  const flaschenHl = summe(flaschen)
  const gebindeHl = summe(gebinde)
  return {
    bestandAm,
    flaschen,
    gebinde,
    zeilen,
    summe: {
      flaschen: flaschen.reduce((s, z) => s + (z.flaschen ?? 0), 0),
      flaschenHl,
      gebindeHl,
      gesamtHl: runden(flaschenHl + gebindeHl, HL_STELLEN_BESTAND),
    },
    warnungen,
  }
}

export const SPALTEN_BESTANDSMELDUNG: CsvSpalte<BestandZeile>[] = [
  { kopf: 'Bestand am', typ: 'datum', wert: z => z.bestandAm },
  { kopf: 'Abschnitt', typ: 'text', wert: z => ABSCHNITT_LABEL[z.abschnitt] },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Farbe', typ: 'text', wert: z => z.farbe },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => z.qualitaet },
  { kopf: 'Behälter', typ: 'text', wert: z => z.behaelter },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: z => z.flaschengroesseMl },
  { kopf: 'Flaschen', typ: 'ganzzahl', wert: z => z.flaschen },
  { kopf: 'Menge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.liter },
  { kopf: 'Menge (hl)', typ: 'dezimal', stellen: HL_STELLEN_BESTAND, wert: z => z.hl },
]
