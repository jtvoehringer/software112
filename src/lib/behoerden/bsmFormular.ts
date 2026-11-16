// ── Bestandsmeldung im Aufbau des BKI-Formulars „Bestandsmeldung“ (KAN-473, BKI-Sitzung 16.11.2026) ────────────────
//
// Das Formular (St. Dr. Lager-Nr. 152, Stichtag 31.07.) hat neun Spalten – Wein und Sturm, Wein mit Sorte und Jahrgang,
// Landwein, Qualitätswein, Prädikatswein, Perlwein und Schaumwein, Erzeugnisse aus anderen EU-Staaten u. EU-Verschnitt,
// Wein aus Drittländern, Sonstige Erzeugnisse – und die Zeilen Bestand lt. letzter Meldung, Zugang (Ernte und
// Fasszukauf, Flaschenzukauf, abgewerteter Wein), Abgang (Fassverkauf in Österreich / ins Ausland, Flaschenverkauf,
// abgewerteter Wein, Eigenverbrauch u. Schwund), Summe neuer Bestand, davon weiß, davon rot/rosé – alles in Litern.
//
// Reine Umrechnung der vorhandenen BSM-Summen (bsm.ts, je Herkunft und Buchungsart) in diesen Aufbau – keine eigene
// Bestandsrechnung. Buchungsarten, die das Formular nicht kennt (Verschnitt, Umstufung, Zugang aus Behandlung,
// Verarbeitung, Inventurdifferenz, Umbuchungen), stehen in der Abstimmzeile „Sonstige Veränderungen (nicht im
// Formular)“: Sie ist der Rest, mit dem je Spalte „alter Bestand + Zugang − Abgang = neuer Bestand“ aufgeht.
// Zellen in ganzen Litern; Summen addieren die gerundeten Zellen (Druck = CSV).

import { runden, type CsvSpalte } from '@/lib/csv'
import type { BsmSummenZeile, Herkunft, SpalteSchluessel } from './bsm'
import { amaBeitrag } from './erntemeldungFormular'

export const BSM_FORMULAR_SPALTEN = [
  { key: 'wein_sturm', label: 'Wein und Sturm' },
  { key: 'sorte', label: 'Wein mit Sorte und Jahrgang' },
  { key: 'landwein', label: 'Landwein' },
  { key: 'qualitaetswein', label: 'Qualitätswein' },
  { key: 'praedikatswein', label: 'Prädikatswein' },
  { key: 'perl_schaum', label: 'Perlwein und Schaumwein' },
  { key: 'eu', label: 'Erzeugnisse aus anderen EU-Staaten u. EU-Verschnitt' },
  { key: 'drittland', label: 'Wein aus Drittländern' },
  { key: 'sonstige', label: 'Sonstige Erzeugnisse' },
] as const
export type BsmFormularSpalte = typeof BSM_FORMULAR_SPALTEN[number]['key']

/** Formularspalte einer Zelle: EU und Drittland sind je EINE Spalte, die Qualitätsspalten gelten nur für Österreich */
export function formularSpalte(herkunft: Herkunft, spalte: SpalteSchluessel): BsmFormularSpalte {
  if (herkunft === 'EU') return 'eu'
  if (herkunft === 'DRITT') return 'drittland'
  switch (spalte) {
    case 'most_sturm': case 'wein': return 'wein_sturm'
    case 'rebsortenwein': return 'sorte'
    case 'landwein': return 'landwein'
    case 'qualitaetswein': return 'qualitaetswein'
    case 'praedikatswein': return 'praedikatswein'
    case 'perl_schaumwein': return 'perl_schaum'
    default: return 'sonstige'   // „Sonstige Erzeugnisse“ und Mengen ohne Zuordnung
  }
}

export type BsmFormularZeilenKey =
  | 'bestand_alt' | 'ernte_fass' | 'flaschenzukauf' | 'abw_zu' | 'summe_zugang'
  | 'fass_at' | 'fass_ausland' | 'flaschenverkauf' | 'abw_ab' | 'schwund' | 'summe_abgang'
  | 'sonstige_veraenderung' | 'bestand_neu' | 'davon_weiss' | 'davon_rot'

/** Buchungsarten je Formularzeile – jede Buchungsart höchstens einmal (Test) */
export const BSM_FORMULAR_ZUORDNUNG: Readonly<Record<'ernte_fass' | 'flaschenzukauf' | 'abw_zu' | 'fass_at' | 'fass_ausland' | 'flaschenverkauf' | 'abw_ab' | 'schwund', readonly string[]>> = {
  ernte_fass: ['ERNTE', 'ZK_FASS', 'ZK_TRAUB', 'ZK_MAISC', 'ZK_MOST'],
  flaschenzukauf: ['ZK_FLA'],
  abw_zu: ['ZU_ABW'],
  fass_at: ['VK_FA_AT'],
  fass_ausland: ['VK_FA_AU'],
  flaschenverkauf: ['VK_FL_AT', 'VK_FL_AU'],
  abw_ab: ['AB_ABW'],
  schwund: ['SCHWUND'],
}

export const BSM_FORMULAR_ZEILEN: readonly { key: BsmFormularZeilenKey; abschnitt: 'Bestand' | 'Zugang' | 'Abgang' | 'Abstimmung'; bezeichnung: string; summe?: boolean }[] = [
  { key: 'bestand_alt', abschnitt: 'Bestand', bezeichnung: 'Bestand lt. letzter Meldung' },
  { key: 'ernte_fass', abschnitt: 'Zugang', bezeichnung: 'Ernte und Fasszukauf' },
  { key: 'flaschenzukauf', abschnitt: 'Zugang', bezeichnung: 'Flaschenzukauf' },
  { key: 'abw_zu', abschnitt: 'Zugang', bezeichnung: 'abgewerteter Wein' },
  { key: 'summe_zugang', abschnitt: 'Zugang', bezeichnung: 'Summe Zugang', summe: true },
  { key: 'fass_at', abschnitt: 'Abgang', bezeichnung: 'Fassverkauf in Österreich' },
  { key: 'fass_ausland', abschnitt: 'Abgang', bezeichnung: 'Fassverkauf ins Ausland' },
  { key: 'flaschenverkauf', abschnitt: 'Abgang', bezeichnung: 'Flaschenverkauf' },
  { key: 'abw_ab', abschnitt: 'Abgang', bezeichnung: 'abgewerteter Wein' },
  { key: 'schwund', abschnitt: 'Abgang', bezeichnung: 'Eigenverbrauch u. Schwund' },
  { key: 'summe_abgang', abschnitt: 'Abgang', bezeichnung: 'Summe Abgang', summe: true },
  { key: 'sonstige_veraenderung', abschnitt: 'Abstimmung', bezeichnung: 'Sonstige Veränderungen (nicht im Formular)' },
  { key: 'bestand_neu', abschnitt: 'Bestand', bezeichnung: 'Summe neuer Bestand', summe: true },
  { key: 'davon_weiss', abschnitt: 'Bestand', bezeichnung: 'davon weiß' },
  { key: 'davon_rot', abschnitt: 'Bestand', bezeichnung: 'davon rot/rosé' },
]

export type BsmFormularZeile = {
  von: string
  bis: string
  key: BsmFormularZeilenKey
  abschnitt: string
  bezeichnung: string
  werte: Record<BsmFormularSpalte, number>
  summe: number
}

export type BsmFormular = {
  zeilen: BsmFormularZeile[]
  /** Beitragserklärung: verkaufte Menge (Fass + Flasche) über 3.000 Liter */
  beitrag: ReturnType<typeof amaBeitrag>
  warnungen: string[]
}

const leer = (): Record<BsmFormularSpalte, number> => ({ wein_sturm: 0, sorte: 0, landwein: 0, qualitaetswein: 0, praedikatswein: 0, perl_schaum: 0, eu: 0, drittland: 0, sonstige: 0 })
const SPALTEN = BSM_FORMULAR_SPALTEN.map(s => s.key)

export function bsmFormular(summen: readonly BsmSummenZeile[], zeitraum: { von: string; bis: string }): BsmFormular {
  /** Summe der BSM-Zeilen mit diesen Positionen und diesem Teil, je Formularspalte – erst summieren, dann auf ganze Liter */
  const aus = (positionen: readonly string[], teil = 'gesamt'): Record<BsmFormularSpalte, number> => {
    const roh = leer()
    for (const z of summen) {
      if (z.teil !== teil || !positionen.includes(z.position)) continue
      for (const [spalte, liter] of Object.entries(z.werte) as [SpalteSchluessel, number][]) roh[formularSpalte(z.herkunft, spalte)] += liter
    }
    for (const k of SPALTEN) roh[k] = runden(roh[k], 0)
    return roh
  }
  const rechne = (f: (k: BsmFormularSpalte) => number) => { const w = leer(); for (const k of SPALTEN) w[k] = f(k); return w }

  const w: Partial<Record<BsmFormularZeilenKey, Record<BsmFormularSpalte, number>>> = {}
  w.bestand_alt = aus(['ANFANG'])
  for (const [key, codes] of Object.entries(BSM_FORMULAR_ZUORDNUNG)) w[key as BsmFormularZeilenKey] = aus(codes)
  w.summe_zugang = rechne(k => w.ernte_fass![k] + w.flaschenzukauf![k] + w.abw_zu![k])
  w.summe_abgang = rechne(k => w.fass_at![k] + w.fass_ausland![k] + w.flaschenverkauf![k] + w.abw_ab![k] + w.schwund![k])
  w.bestand_neu = aus(['STICHTAG'])
  w.davon_weiss = aus(['STICHTAG'], 'davon weiß')
  w.davon_rot = aus(['STICHTAG'], 'davon rot (inkl. Rosé)')
  // Rest, mit dem die Rechnung je Spalte aufgeht (Verschnitt, Umstufung, Behandlung, Verarbeitung, Inventur …)
  w.sonstige_veraenderung = rechne(k => w.bestand_neu![k] - w.bestand_alt![k] - w.summe_zugang![k] + w.summe_abgang![k])

  const zeilen: BsmFormularZeile[] = BSM_FORMULAR_ZEILEN.map(d => {
    const werte = w[d.key]!
    return { von: zeitraum.von, bis: zeitraum.bis, key: d.key, abschnitt: d.abschnitt, bezeichnung: d.bezeichnung, werte, summe: SPALTEN.reduce((s, k) => s + werte[k], 0) }
  })
  const summe = (key: BsmFormularZeilenKey) => zeilen.find(z => z.key === key)!.summe

  const warnungen: string[] = []
  const ohneFarbe = summe('bestand_neu') - summe('davon_weiss') - summe('davon_rot')
  if (Math.abs(ohneFarbe) >= 1) warnungen.push(`Bestandsmeldung (Formular): ${ohneFarbe.toLocaleString('de-DE')} l des neuen Bestands haben keine Farbe (weder weiß noch rot/rosé) – Weinart bzw. Rebsorte an Charge oder Füllung ergänzen.`)
  if (zeilen.some(z => z.key === 'sonstige_veraenderung' && SPALTEN.some(k => z.werte[k] !== 0))) {
    warnungen.push('Bestandsmeldung (Formular): Die Zeile „Sonstige Veränderungen“ enthält Mengen aus Buchungen, für die das Formular keine Zeile hat (Verschnitt, Umstufung, Zugang aus Behandlung, Verarbeitung, Inventur) – Einzelheiten im Kontrolljournal.')
  }
  return { zeilen, beitrag: amaBeitrag(summe('fass_at') + summe('fass_ausland') + summe('flaschenverkauf')), warnungen }
}

/** CSV: dieselben Zeilen und Spalten wie der Druck, ganze Liter */
export const SPALTEN_BSM_FORMULAR: CsvSpalte<BsmFormularZeile>[] = [
  { kopf: 'Zeitraum von', typ: 'datum', wert: z => z.von },
  { kopf: 'Zeitraum bis', typ: 'datum', wert: z => z.bis },
  { kopf: 'Abschnitt', typ: 'text', wert: z => z.abschnitt },
  { kopf: 'Zeile', typ: 'text', wert: z => z.bezeichnung },
  ...BSM_FORMULAR_SPALTEN.map((s): CsvSpalte<BsmFormularZeile> => ({ kopf: `${s.label} (l)`, typ: 'ganzzahl', wert: z => z.werte[s.key] })),
  { kopf: 'Summe (l)', typ: 'ganzzahl', wert: z => z.summe },
]
