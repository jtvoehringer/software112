// ── Behördenmeldung „anlagenverzeichnis“: Anlagenverzeichnis / Anlagenspiegel (24.09.2026) ──
//
// Anlagenverzeichnis nach § 7 Abs. 3 EStG (GWG § 13 EStG) je Jahr: eine Zeile je Anlage,
// die im Jahr vorhanden war, mit Anschaffung, AK, Nutzungsdauer, Methode, Buchwert 1.1.,
// Zugang, Abgang, AfA des Jahres, kumulierter AfA und Buchwert 31.12. Rechenlogik
// unverändert aus lib/ea/anlagen.ts (anlagenspiegelZeilen). Eine Ladefunktion für die
// Druckseite /buchhaltung/anlagen/spiegel UND die CSV (/meldungen/anlagenverzeichnis/csv?jahr=);
// die Druck-Summen addieren die hier gelieferten, bereits gerundeten Zeilenwerte.

import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { afaSatzProzent, anlagenspiegelZeilen, type Anlage, type SpiegelZeile } from '@/lib/ea/anlagen'
import { sachkonto, summe, text } from './buchhaltung-gemeinsam'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type AnlagenParameter = { jahr: number }

export const AFA_METHODE: Record<string, string> = { linear: 'linear', degressiv: 'degressiv', gwg: 'GWG' }

/** ea_anlagen-Zeile → Anlage (Zahlen als number, Datum 'JJJJ-MM-TT') */
export function anlageAusZeile(r: R): Anlage {
  return {
    id: r.id, name: r.name, gruppe: r.gruppe ?? null, konto_nr: r.konto_nr === null || r.konto_nr === undefined ? null : Number(r.konto_nr),
    anschaffung_am: String(r.anschaffung_am).slice(0, 10), ak_netto: Number(r.ak_netto), nutzungsdauer_jahre: Number(r.nutzungsdauer_jahre),
    methode: r.methode, degressiv_satz: r.degressiv_satz === null || r.degressiv_satz === undefined ? null : Number(r.degressiv_satz),
    restwert: Number(r.restwert ?? 0), abgang_am: r.abgang_am ? String(r.abgang_am).slice(0, 10) : null,
    veraeusserungserloes: r.veraeusserungserloes === null || r.veraeusserungserloes === undefined ? null : Number(r.veraeusserungserloes),
  }
}

export type AnlagenZeile = {
  anlage: Anlage
  gruppe: string
  bezeichnung: string
  konto: string | null
  anschaffung: string
  akNetto: number
  /** Nutzungsdauer in Jahren; bei GWG leer */
  nutzungsdauer: number | null
  methode: string
  afaSatz: number
  buchwertAnfang: number
  zugang: number
  abgang: number
  afa: number
  halbjahr: boolean
  kumulierteAfa: number
  buchwertEnde: number
  abgangAm: string | null
  restbuchwertAbgang: number | null
  erloes: number | null
  abgegangen: boolean
  gwg: boolean
}

/** Spiegelzeile (lib/ea/anlagen) → Verzeichniszeile mit kaufmännisch gerundeten Beträgen */
export function anlagenZeile(z: SpiegelZeile): AnlagenZeile {
  const a = z.anlage
  const r2 = (n: number) => runden(n, 2)
  return {
    anlage: a,
    gruppe: text(a.gruppe) ?? 'Ohne Gruppe',
    bezeichnung: a.name,
    konto: sachkonto(a.konto_nr),
    anschaffung: a.anschaffung_am,
    akNetto: r2(a.ak_netto),
    nutzungsdauer: a.methode === 'gwg' ? null : a.nutzungsdauer_jahre,
    methode: AFA_METHODE[a.methode] ?? a.methode,
    afaSatz: runden(afaSatzProzent(a), 2),
    buchwertAnfang: r2(z.buchwertAnfang),
    zugang: r2(z.zugang),
    abgang: r2(z.abgang),
    afa: r2(z.afa),
    halbjahr: z.halb,
    kumulierteAfa: r2(z.kumulierteAfa),
    buchwertEnde: r2(z.buchwertEnde),
    abgangAm: z.abgegangen ? a.abgang_am : null,
    restbuchwertAbgang: z.abgegangen ? r2(z.restbuchwertAbgang) : null,
    erloes: z.abgegangen ? r2(z.erloes) : null,
    abgegangen: z.abgegangen,
    gwg: a.methode === 'gwg',
  }
}

export const SPALTEN_ANLAGENVERZEICHNIS: CsvSpalte<AnlagenZeile>[] = [
  { kopf: 'Gruppe', typ: 'text', wert: z => z.gruppe },
  { kopf: 'Anlage', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Konto', typ: 'code', wert: z => z.konto },
  { kopf: 'Anschaffung', typ: 'datum', wert: z => z.anschaffung },
  { kopf: 'AK netto (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.akNetto },
  { kopf: 'Nutzungsdauer (Jahre)', typ: 'ganzzahl', wert: z => z.nutzungsdauer },
  { kopf: 'Methode', typ: 'text', wert: z => z.methode },
  { kopf: 'AfA-Satz (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.afaSatz },
  { kopf: 'Buchwert 1.1. (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.buchwertAnfang },
  { kopf: 'Zugang (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.zugang },
  { kopf: 'Abgang (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.abgang },
  { kopf: 'AfA (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.afa },
  { kopf: 'Halbjahres-AfA', typ: 'janein', wert: z => z.halbjahr },
  { kopf: 'kum. AfA (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.kumulierteAfa },
  { kopf: 'Buchwert 31.12. (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.buchwertEnde },
  { kopf: 'Abgang am', typ: 'datum', wert: z => z.abgangAm },
  { kopf: 'Restbuchwert Abgang (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.restbuchwertAbgang },
  { kopf: 'Veräußerungserlös netto (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.erloes },
  { kopf: 'GWG', typ: 'janein', wert: z => z.gwg },
]

export type AnlagenSummen = {
  anzahlAktiv: number
  akNetto: number
  buchwertAnfang: number
  zugang: number
  abgang: number
  afa: number
  kumulierteAfa: number
  buchwertEnde: number
  restbuchwertAbgaenge: number
  erloese: number
}

/** Summen aus den (gerundeten) Zeilen – für Druck-Fußzeile und Zwischensummen */
export function anlagenSummen(zeilen: readonly AnlagenZeile[]): AnlagenSummen {
  return {
    anzahlAktiv: zeilen.filter(z => !z.abgegangen).length,
    akNetto: summe(zeilen.map(z => z.akNetto)),
    buchwertAnfang: summe(zeilen.map(z => z.buchwertAnfang)),
    zugang: summe(zeilen.map(z => z.zugang)),
    abgang: summe(zeilen.map(z => z.abgang)),
    afa: summe(zeilen.map(z => z.afa)),
    kumulierteAfa: summe(zeilen.map(z => z.kumulierteAfa)),
    buchwertEnde: summe(zeilen.map(z => z.buchwertEnde)),
    restbuchwertAbgaenge: summe(zeilen.map(z => z.restbuchwertAbgang)),
    erloese: summe(zeilen.map(z => z.erloes)),
  }
}

/** Verzeichnis eines Jahres aus den geladenen Anlagen (rein) – Zeilen, Summen, Hinweise */
export function anlagenverzeichnis(anlagen: Anlage[], jahr: number): { zeilen: AnlagenZeile[]; warnungen: string[]; summen: AnlagenSummen } {
  const zeilen = anlagenspiegelZeilen(anlagen, jahr).zeilen.map(anlagenZeile)
  const warnungen: string[] = []
  const ohneKonto = zeilen.filter(z => !z.konto).length
  if (ohneKonto > 0) warnungen.push(`${ohneKonto} ${ohneKonto === 1 ? 'Anlage hat' : 'Anlagen haben'} kein Anlagenkonto.`)
  return { zeilen, warnungen, summen: anlagenSummen(zeilen) }
}

/** Alle Anlagen des Betriebs (für die Jahreswahl) und das Verzeichnis des Jahres */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAnlagenverzeichnis(supabase: any, tenantId: string, p: AnlagenParameter): Promise<{ zeilen: AnlagenZeile[]; warnungen: string[]; anlagen: Anlage[]; summen: AnlagenSummen }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle<R>((supabase.from('ea_anlagen') as any)
    .select('id, name, gruppe, konto_nr, anschaffung_am, ak_netto, nutzungsdauer_jahre, methode, degressiv_satz, restwert, abgang_am, veraeusserungserloes')
    .eq('tenant_id', tenantId)
    .order('anschaffung_am').order('name').order('id'))
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (ea_anlagen): ${error.message}`)

  const anlagen = data.map(anlageAusZeile)
  return { ...anlagenverzeichnis(anlagen, p.jahr), anlagen }
}
