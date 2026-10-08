// ── Behördenmeldung „rechnungsausgangsjournal“ (24.09.2026) ────────────────────
//
// Ausgangsrechnungsjournal für die Betriebsprüfung (§ 11 UStG fortlaufende Nummer,
// § 131 BAO): je Verkaufsbeleg (verkaufsposten) des Zeitraums eine Zeile mit
// Rechnungsnummer, Datum, Kunde, UID, Netto und USt je Steuersatz, Brutto sowie Storno
// (storniert am in Wiener Zeit). Stornierte Rechnungen bleiben mit ihren Beträgen im
// Journal (Lückenlosigkeit) und sind als storniert gekennzeichnet. Lücken und doppelte
// Rechnungsnummern meldet die Datei als Hinweis (X-Warnungen).
// Eine Ladefunktion für die Druckseite /buchhaltung/rechnungsjournal UND die CSV
// (/meldungen/rechnungsausgangsjournal/csv?von=&bis=). Die alte Route /api/export/verkauf
// bleibt unverändert (KAN-54).
// Berechnung wie die Rechnung (weinhandel/verkauf/[id]): Positionsbrutto × (1 − Rabatt) ×
// (1 − Sonderrabatt), Netto je Satz = Σ Brutto / (1 + Satz), USt = Netto × Satz;
// Positionen ohne Preis zählen nicht, fehlender Satz = 13 %.
// KAN-105 (08.10.2026): Quelle ist die Rechnung (Tabelle rechnungen, KAN-102) mit den Positionen aller ihrer Lieferscheine –
// nicht berechnete Lieferscheine stehen nicht im Journal, Sammelrechnungen als eine Zeile.
// KAN-105 Teil B (08.10.2026, Entscheidung Jörgen): Export-Rechnungen (Exportauftrag mit ausgestellter Exportrechnung)
// stehen mit ihrer Exportnummer als eigener Nummernkreis im Journal – steuerfreie Ausfuhr (0 %), Rechnungsdatum =
// Datum des Auftrags (wie auf der Exportrechnung), Lückenprüfung je Kreis. Einen Zahlungsstatus führt der Export nicht.

import { momentaufnahmenAnwenden } from '../stammdaten/momentaufnahme'
import { rundeText, runden, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { text, zahl } from './buchhaltung-gemeinsam'
import { alsBeleg, lieferscheineSelect } from '@/lib/verkauf/rechnungen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type RechnungsjournalParameter = { von: string; bis: string }

export const JOURNAL_SAETZE = [20, 13, 10] as const

export type RechnungsjournalZeile = {
  id: string
  rechnungsnummer: string | null
  datum: string
  kunde: string | null
  kundennummer: string | null
  uid: string | null
  land: string | null
  netto20: number | null
  ust20: number | null
  netto13: number | null
  ust13: number | null
  netto10: number | null
  ust10: number | null
  /** Netto zu 0 % (steuerfrei, Ausfuhr, ig Lieferung) */
  netto0: number | null
  /** Netto/USt zu anderen Sätzen (nur in den Gesamtspalten, Hinweis in X-Warnungen) */
  nettoSonstige: number | null
  nettoGesamt: number
  ustGesamt: number
  brutto: number
  storniert: boolean
  /** verkaufsposten.storniert_am (timestamptz) */
  storniertAm: string | null
  /** KAN-149 D1: wer storniert hat und warum (ältere Stornos ohne) */
  storniertVon: string | null
  stornoGrund: string | null
  bezahlt: boolean
  /** verkaufsposten.bezahlt_am (timestamptz) */
  bezahltAm: string | null
  /** KAN-105: Herkunft – Rechnung (Weinhandel) oder Export-Rechnung (Exportauftrag, eigener Nummernkreis) */
  quelle: 'rechnung' | 'export'
  /** Link zum Beleg in der App (Druckseite; nicht in der CSV) */
  href: string | null
}

export const SPALTEN_RECHNUNGSJOURNAL: CsvSpalte<RechnungsjournalZeile>[] = [
  { kopf: 'Rechnungsnr.', typ: 'code', wert: z => z.rechnungsnummer },
  { kopf: 'Rechnungsdatum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Kunde', typ: 'text', wert: z => z.kunde },
  { kopf: 'Kundennr.', typ: 'code', wert: z => z.kundennummer },
  { kopf: 'UID', typ: 'code', wert: z => z.uid },
  { kopf: 'Land', typ: 'code', wert: z => z.land },
  { kopf: 'Netto 20 % (€)', typ: 'betrag', wert: z => z.netto20 },
  { kopf: 'USt 20 % (€)', typ: 'betrag', wert: z => z.ust20 },
  { kopf: 'Netto 13 % (€)', typ: 'betrag', wert: z => z.netto13 },
  { kopf: 'USt 13 % (€)', typ: 'betrag', wert: z => z.ust13 },
  { kopf: 'Netto 10 % (€)', typ: 'betrag', wert: z => z.netto10 },
  { kopf: 'USt 10 % (€)', typ: 'betrag', wert: z => z.ust10 },
  { kopf: 'Netto steuerfrei (€)', typ: 'betrag', wert: z => z.netto0 },
  { kopf: 'Netto gesamt (€)', typ: 'betrag', wert: z => z.nettoGesamt },
  { kopf: 'USt gesamt (€)', typ: 'betrag', wert: z => z.ustGesamt },
  { kopf: 'Brutto (€)', typ: 'betrag', wert: z => z.brutto },
  { kopf: 'Storniert', typ: 'janein', wert: z => z.storniert },
  { kopf: 'Storniert am', typ: 'datum', wert: z => z.storniertAm },
  { kopf: 'Storniert von', typ: 'text', wert: z => z.storniertVon },
  { kopf: 'Storno-Grund', typ: 'text', wert: z => z.stornoGrund },
  { kopf: 'Bezahlt', typ: 'janein', wert: z => z.bezahlt },
  { kopf: 'Bezahlt am', typ: 'datum', wert: z => z.bezahltAm },
]

/** Ein Verkaufsbeleg (mit Positionen, Kontakt/Firma) → Journalzeile; sonstige = abweichende Steuersätze */
export function rechnungsjournalZeile(p: R): { zeile: RechnungsjournalZeile; sonstigeSaetze: number[] } {
  const roh = new Map<number, { brutto: number; netto: number }>()
  for (const pos of (p.verkauf_positionen ?? []) as R[]) {
    if (pos.preis_brutto === null || pos.preis_brutto === undefined) continue
    const satz = zahl(pos.ust_satz) ?? 13
    const effektiv = (zahl(pos.preis_brutto) ?? 0) * (zahl(pos.menge) ?? 0)
      * (1 - (zahl(pos.rabatt_pct) ?? 0) / 100) * (1 - (zahl(pos.sonderrabatt_pct) ?? 0) / 100)
    const g = roh.get(satz) ?? { brutto: 0, netto: 0 }
    g.brutto += effektiv
    g.netto += effektiv / (1 + satz / 100)
    roh.set(satz, g)
  }
  const netto = (s: number) => (roh.has(s) ? runden(roh.get(s)!.netto, 2) : null)
  const ust = (s: number) => (roh.has(s) ? runden(roh.get(s)!.netto * s / 100, 2) : null)
  const sonstigeSaetze = [...roh.keys()].filter(s => s !== 0 && !(JOURNAL_SAETZE as readonly number[]).includes(s)).sort((a, b) => a - b)
  const nettoSonstige = sonstigeSaetze.length ? runden(sonstigeSaetze.reduce((s, k) => s + roh.get(k)!.netto, 0), 2) : null
  const ustSonstige = sonstigeSaetze.reduce((s, k) => s + runden(roh.get(k)!.netto * k / 100, 2), 0)

  const teileNetto = [netto(20), netto(13), netto(10), netto(0), nettoSonstige]
  const teileUst = [ust(20), ust(13), ust(10)]
  const nettoGesamt = runden(teileNetto.reduce<number>((s, v) => s + (v ?? 0), 0), 2)
  const ustGesamt = runden(teileUst.reduce<number>((s, v) => s + (v ?? 0), 0) + ustSonstige, 2)
  const brutto = runden([...roh.values()].reduce((s, g) => s + g.brutto, 0), 2)

  const firma = (p.firma ?? null) as R | null
  const kontakt = (p.kontakt ?? null) as R | null
  const kontaktName = kontakt ? text([kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ')) : null
  return {
    zeile: {
      id: String(p.id),
      rechnungsnummer: text(p.rechnungsnummer),
      datum: String(p.datum).slice(0, 10),
      kunde: text(firma?.name) ?? kontaktName,
      // Kundennummer wie auf der Rechnung (Accountnummer), ersatzweise das BMD-Debitorenkonto
      kundennummer: text(firma?.accountnummer) ?? text(kontakt?.accountnummer) ?? text(firma?.debitor_nr) ?? text(kontakt?.debitor_nr),
      uid: text(firma?.uid_nummer),
      land: text(firma?.land) ?? text(kontakt?.land),
      netto20: netto(20), ust20: ust(20), netto13: netto(13), ust13: ust(13), netto10: netto(10), ust10: ust(10),
      netto0: netto(0), nettoSonstige,
      nettoGesamt, ustGesamt, brutto,
      storniert: !!p.storniert,
      storniertAm: p.storniert ? text(p.storniert_am) : null,
      storniertVon: p.storniert ? text(p.storniert_von_name) : null,
      stornoGrund: p.storniert ? text(p.storno_grund) : null,
      bezahlt: !!p.bezahlt,
      bezahltAm: p.bezahlt ? text(p.bezahlt_am) : null,
      quelle: p.quelle === 'export' ? 'export' : 'rechnung',
      href: text(p.href),
    },
    sonstigeSaetze,
  }
}

/**
 * KAN-105: Exportauftrag mit ausgestellter Exportrechnung → Beleg wie eine Rechnung (für rechnungsjournalZeile):
 * Exportnummer als Rechnungsnummer, Positionen zu 0 % (steuerfreie Ausfuhr, Preis je Einheit netto = brutto).
 */
export function exportAlsBeleg(a: R): R {
  return {
    ...a,
    rechnungsnummer: a.referenz ?? null,
    storniert: !!a.storniert_am,
    bezahlt: false,
    bezahlt_am: null,
    verkauf_positionen: ((a.exportauftrag_positionen ?? []) as R[]).map(p => ({ preis_brutto: p.preis_eur ?? null, menge: p.menge, ust_satz: 0 })),
    quelle: 'export',
    href: `/weinexport/${a.id}`,
  }
}

/** Nummer in Muster (Text vor/nach der letzten Ziffernfolge) und Zähler zerlegen */
function zerlegen(nr: string): { muster: string; vor: string; nach: string; zahl: number; stellen: number } | null {
  const m = /^(.*?)(\d+)(\D*)$/.exec(nr)
  if (!m) return null
  return { muster: `${m[1]}#${m[3]}`, vor: m[1], nach: m[3], zahl: Number(m[2]), stellen: m[2].length }
}

/**
 * Lücken und Doppelte in fortlaufenden Rechnungsnummern (je Nummernmuster, z. B. „RE-2026-####“).
 * Lücken nur zwischen der kleinsten und größten Nummer des Zeitraums.
 */
export function rechnungsnummernPruefen(nummern: readonly (string | null)[]): string[] {
  const hinweise: string[] = []
  const gruppen = new Map<string, { vor: string; nach: string; stellen: number; zahlen: number[] }>()
  const gezaehlt = new Map<string, number>()
  for (const n of nummern) {
    if (!n) continue
    gezaehlt.set(n, (gezaehlt.get(n) ?? 0) + 1)
    const z = zerlegen(n)
    if (!z || !Number.isSafeInteger(z.zahl)) continue
    const g = gruppen.get(z.muster) ?? { vor: z.vor, nach: z.nach, stellen: z.stellen, zahlen: [] }
    g.stellen = Math.min(g.stellen, z.stellen)
    g.zahlen.push(z.zahl)
    gruppen.set(z.muster, g)
  }
  for (const [n, anzahl] of gezaehlt) if (anzahl > 1) hinweise.push(`Rechnungsnummer ${n} kommt ${anzahl}-mal vor.`)
  for (const g of gruppen.values()) {
    const zahlen = [...new Set(g.zahlen)].sort((a, b) => a - b)
    const nr = (x: number) => `${g.vor}${String(x).padStart(g.stellen, '0')}${g.nach}`
    for (let i = 1; i < zahlen.length; i++) {
      const fehlend = zahlen[i] - zahlen[i - 1] - 1
      if (fehlend <= 0) continue
      hinweise.push(fehlend === 1
        ? `Lücke in den Rechnungsnummern: ${nr(zahlen[i - 1] + 1)} fehlt im Zeitraum.`
        : `Lücke in den Rechnungsnummern: ${nr(zahlen[i - 1] + 1)} bis ${nr(zahlen[i] - 1)} fehlen im Zeitraum (${fehlend} Nummern).`)
    }
  }
  return hinweise
}

/** Natürliche Sortierung von Rechnungsnummern ('RE-9' vor 'RE-10') */
function nummernVergleich(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, 'de', { numeric: true })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeRechnungsjournal(supabase: any, tenantId: string, p: RechnungsjournalParameter): Promise<{ zeilen: RechnungsjournalZeile[]; warnungen: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roh, error } = await alle<R>((supabase.from('rechnungen') as any)
    .select(`id, datum, rechnungsnummer, aktiv, storniert, storniert_am, storniert_von_name, storno_grund, bezahlt, bezahlt_am, partner_daten, storno_positionen,
      kontakt:kontakte!kontakt_id(vorname, nachname, accountnummer, debitor_nr, land),
      firma:firmen!firma_id(name, uid_nummer, accountnummer, debitor_nr, land),
      ${lieferscheineSelect('preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz')}`)
    .eq('tenant_id', tenantId)
    .gte('datum', p.von)
    .lte('datum', p.bis)
    .order('datum').order('id'))
  if (error) throw new Error(`Laden fehlgeschlagen (rechnungen): ${error.message}`)

  // KAN-105: Export-Rechnungen – Exportaufträge des Zeitraums mit ausgestellter Exportrechnung
  // storno-sichtbar: stornierte Export-Rechnungen bleiben gekennzeichnet im Journal (Lückenlosigkeit der Nummern)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: exRoh, error: exErr } = await alle<R>((supabase.from('exportauftraege') as any)
    .select(`id, datum, referenz, aktiv, storniert_am, storniert_von_name, storno_grund, partner_daten,
      kontakt:kontakte!kontakt_id(vorname, nachname, accountnummer, debitor_nr, land),
      firma:firmen!firma_id(name, uid_nummer, accountnummer, debitor_nr, land),
      exportauftrag_positionen(preis_eur, menge),
      export_dokumente!inner(dokument_art, status)`)
    .eq('tenant_id', tenantId)
    .eq('export_dokumente.dokument_art', 'rechnung')
    .eq('export_dokumente.status', 'ausgestellt')
    .gte('datum', p.von)
    .lte('datum', p.bis)
    .order('datum').order('id'))
  if (exErr) throw new Error(`Laden fehlgeschlagen (exportauftraege): ${exErr.message}`)

  const data: R[] = [
    ...roh.map(r => ({ ...alsBeleg(r), quelle: 'rechnung', href: `/weinhandel/rechnungen/${r.id}` })),
    ...exRoh.map(exportAlsBeleg),
  ]
  momentaufnahmenAnwenden(data, ['kontakt', 'firma'])   // KAN-150 F1c: Käufer wie auf der Rechnung

  const warnungen: string[] = []
  const zeilen: RechnungsjournalZeile[] = []
  const sonstige = new Set<number>()
  let deaktiviert = 0
  for (const posten of data) {
    const { zeile, sonstigeSaetze } = rechnungsjournalZeile(posten)
    sonstigeSaetze.forEach(s => sonstige.add(s))
    if (posten.aktiv === false) deaktiviert++
    zeilen.push(zeile)
  }
  zeilen.sort((a, b) => a.datum.localeCompare(b.datum) || nummernVergleich(a.rechnungsnummer, b.rechnungsnummer) || a.id.localeCompare(b.id))

  // Lückenprüfung je Nummernkreis: Rechnungen und Export-Rechnungen getrennt
  warnungen.push(...rechnungsnummernPruefen(zeilen.filter(z => z.quelle === 'rechnung').map(z => z.rechnungsnummer)))
  const exporte = zeilen.filter(z => z.quelle === 'export')
  warnungen.push(...rechnungsnummernPruefen(exporte.map(z => z.rechnungsnummer)).map(h => `Export-Rechnungen: ${h}`))
  if (exporte.length > 0) {
    warnungen.push(`${exporte.length} ${exporte.length === 1 ? 'Export-Rechnung ist' : 'Export-Rechnungen sind'} mit der Exportnummer (eigener Nummernkreis, steuerfreie Ausfuhr) enthalten – ohne Zahlungsstatus.`)
  }
  const ohneNummer = zeilen.filter(z => !z.rechnungsnummer).length
  if (ohneNummer > 0) warnungen.push(`${ohneNummer} ${ohneNummer === 1 ? 'Verkaufsbeleg hat' : 'Verkaufsbelege haben'} keine Rechnungsnummer.`)
  if (sonstige.size > 0) {
    warnungen.push(`Steuersätze ohne eigene Spalte (${[...sonstige].map(s => `${rundeText(s, 2).replace(/\.?0+$/, '').replace('.', ',')} %`).join(', ')}) – nur in „Netto gesamt“ und „USt gesamt“ enthalten.`)
  }
  if (deaktiviert > 0) warnungen.push(`${deaktiviert} deaktivierte ${deaktiviert === 1 ? 'Verkaufsbeleg ist' : 'Verkaufsbelege sind'} der Vollständigkeit halber enthalten.`)
  const storniert = zeilen.filter(z => z.storniert).length
  if (storniert > 0) warnungen.push(`${storniert} ${storniert === 1 ? 'Rechnung ist' : 'Rechnungen sind'} storniert und mit ihren ursprünglichen Beträgen aufgeführt (Spalte „Storniert“) – für Summen herausfiltern.`)
  return { zeilen, warnungen }
}
