// ── Journal: wer hat wann in welchem Bereich was gebucht (KAN-332, 13.10.2026) ──
//
// Quelle ist das Bestandsprotokoll (KAN-35): Seit KAN-332 schreibt es auch Neuanlagen und zu jeder Zeile eine Kennung
// (Name, Nummer, Datum, Menge …). Entscheidungen Jörgen 13.10.2026: Mitarbeiter sehen ihre eigenen Vorgänge, die
// Betriebsleitung alle (Filter nach Benutzer); Anlage, Änderung, Storno, Löschung; alle Bereiche des Protokolls;
// Reiter „Journal“ auf der Übersicht mit Druck und CSV.
//
// Reine Funktionen ohne '@/'-Importe (Tests laden die Datei direkt mit Node): Bereich je Tabelle, Aktion, Beschreibung,
// Link zum Datensatz, Filter aus der URL und die CSV-Spalten. Laden: lib/journal/laden.ts.

import type { CsvSpalte } from '../csv'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Bezeichnung je Tabelle des Bestandsprotokolls (auch im Änderungsprotokoll verwendet) */
export const TABELLE_LABEL: Record<string, string> = {
  weinausbau: 'Charge',
  keller_umzuege: 'Umzug / Filtration / Schwund',
  verschneidungen: 'Verschneidung',
  verschneidung_quellen: 'Verschneidung – Quelle',
  keller_behandlungen: 'Kellerbehandlung',
  fuellungen: 'Füllung',
  fuellung_chargen: 'Füllung – Chargenanteil',
  fuellung_bewegungen: 'Flaschenbewegung',
  zukauf_posten: 'Zukauf',
  pressungen: 'Pressung',
  pressung_behaelter: 'Pressung – Gebinde',
  pressung_weingaerten: 'Pressung – Weingarten',
  ernte_parzellen: 'Lese (Parzelle)',
  traubenverkauf: 'Traubenverkauf',
  verkaufsposten: 'Verkauf',
  verkauf_positionen: 'Verkaufsposition',
  ama_erntemeldungen: 'AMA-Erntemeldung',
  ama_meldepositionen: 'AMA-Meldeposition',
  weinjahrgaenge: 'Jahrgang',
  // KAN-149 D3 / KAN-150 F1a: E&A-Abschluss und Stammdaten (Löschen, Deaktivieren)
  ea_transaktionen: 'E&A-Buchung',
  zahlungen: 'Zahlung',
  konto_umbuchungen: 'Umbuchung',
  ea_uva: 'UVA',
  ea_monatsabschluss: 'Monatsabschluss',
  ea_belege: 'Beleg',
  weingarten: 'Ried',
  grundstuecke: 'Grundstück',
  pflanzenschutzmittel: 'Pflanzenschutzmittel',
  duengemittel: 'Düngemittel',
  ea_kategorien: 'E&A-Kategorie',
  ea_dauerauftraege: 'Dauerauftrag',
  keller_behandlungstypen: 'Kellerbehandlungstyp',
  // KAN-97: Prüfnummernantrag (Statuswechsel mit Grund)
  dac_antrag: 'DAC-/Prüfnummernantrag',
  pruefnummernantraege: 'Prüfnummernantrag (Formular)',
  // KAN-88: Pflanzenschutz- und Düngeaufzeichnung, Mittel-Lager
  behandlungen: 'Maßnahme',
  behandlung_grundstuecke: 'Maßnahme – Grundstück',
  psm_lager_bewegungen: 'PSM-Lagerbuchung',
  duengemittel_lager_bewegungen: 'Dünger-Lagerbuchung',
  betriebsmittel_lager_bewegungen: 'Betriebsmittel-Lagerbuchung',
  // KAN-332: weitere Tabellen des Protokolls
  lesen: 'Lese',
  rechnungen: 'Rechnung',
  transportbescheinigungen: 'Transportbescheinigung',
  exportauftraege: 'Exportauftrag',
  weinanalysen: 'Weinanalyse',
  betriebsmittel: 'Betriebsmittel',
}

/** Bereiche des Journals (Filter „Bereich“) mit ihren Tabellen */
export const JOURNAL_BEREICHE = [
  { key: 'kellerbuch', label: 'Kellerbuch', tabellen: ['weinausbau', 'keller_umzuege', 'verschneidungen', 'verschneidung_quellen', 'keller_behandlungen', 'keller_behandlungstypen', 'zukauf_posten', 'dac_antrag', 'pruefnummernantraege', 'weinanalysen'] },
  { key: 'lese', label: 'Lese & Pressung', tabellen: ['weinjahrgaenge', 'lesen', 'ernte_parzellen', 'pressungen', 'pressung_behaelter', 'pressung_weingaerten', 'traubenverkauf', 'ama_erntemeldungen', 'ama_meldepositionen'] },
  { key: 'warenwirtschaft', label: 'Füllung & Verkauf', tabellen: ['fuellungen', 'fuellung_chargen', 'fuellung_bewegungen', 'verkaufsposten', 'verkauf_positionen', 'rechnungen', 'transportbescheinigungen', 'exportauftraege'] },
  { key: 'ea', label: 'E&A-Rechnung', tabellen: ['ea_transaktionen', 'zahlungen', 'konto_umbuchungen', 'ea_belege', 'ea_uva', 'ea_monatsabschluss', 'ea_kategorien', 'ea_dauerauftraege'] },
  { key: 'weingarten', label: 'Rieden & Maßnahmen', tabellen: ['weingarten', 'grundstuecke', 'behandlungen', 'behandlung_grundstuecke'] },
  { key: 'lager', label: 'Betriebsmittel-Lager', tabellen: ['pflanzenschutzmittel', 'duengemittel', 'betriebsmittel', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen', 'betriebsmittel_lager_bewegungen'] },
] as const

export type JournalBereich = (typeof JOURNAL_BEREICHE)[number]['key']

export function bereichDerTabelle(tabelle: string): (typeof JOURNAL_BEREICHE)[number] | null {
  return JOURNAL_BEREICHE.find(b => (b.tabellen as readonly string[]).includes(tabelle)) ?? null
}

export const JOURNAL_AKTIONEN = [
  { key: 'anlage', label: 'Anlage' },
  { key: 'aenderung', label: 'Änderung' },
  { key: 'storno', label: 'Storno' },
  { key: 'loeschung', label: 'Löschung' },
] as const
export type JournalAktion = (typeof JOURNAL_AKTIONEN)[number]['key']

/** Aktion einer Protokollzeile: Storno ist eine Änderung, die storniert_am (bzw. storniert) setzt */
export function aktionDerZeile(aktion: string, spalten: readonly string[] | null, neu: R | null): JournalAktion {
  if (aktion === 'INSERT') return 'anlage'
  if (aktion === 'DELETE') return 'loeschung'
  const s = spalten ?? []
  if ((s.includes('storniert_am') && neu?.storniert_am != null) || (s.includes('storniert') && neu?.storniert === true)) return 'storno'
  return 'aenderung'
}

/** Zahl wie im Projekt üblich: Tausenderpunkt, Dezimalkomma, Nachkommanullen weg (toLocaleString('de-AT') setzt ein
 *  schmales Leerzeichen als Tausendertrennzeichen) */
const zahl = (v: unknown, stellen = 2) => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const [g, k] = Math.abs(n).toFixed(stellen).split('.')
  const rest = (k ?? '').replace(/0+$/, '')
  return `${n < 0 ? '−' : ''}${g.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${rest ? `,${rest}` : ''}`
}
const tag = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : null
const txt = (v: unknown) => typeof v === 'string' && v.trim() !== '' ? v.trim() : (typeof v === 'number' ? String(v) : null)

/** Kurzbeschreibung eines Datensatzes aus Kennung (seit KAN-332) bzw. alt/neu (ältere Zeilen) */
export function beschreibung(kennung: R | null, alt: R | null = null, neu: R | null = null): string {
  const q: R = { ...(alt ?? {}), ...(neu ?? {}), ...(kennung ?? {}) }
  const teile: string[] = []
  const name = ['name', 'bezeichnung', 'rechnungsnummer', 'transaktions_nr', 'liefernummer', 'tbs_nummer', 'belegnummer',
    'pruefnummer', 'beschreibung', 'dateiname'].map(k => txt(q[k])).find(Boolean)
  if (name) teile.push(name.length > 80 ? `${name.slice(0, 79)}…` : name)
  if (q.lfd_nr != null && !name) teile.push(`Nr. ${q.lfd_nr}`)
  if (!name && txt(q.rebsorte)) teile.push([txt(q.rebsorte), txt(q.jahrgang)].filter(Boolean).join(' '))
  if (q.jahr != null && q.monat != null) teile.push(`${String(q.monat).padStart(2, '0')}/${q.jahr}`)
  else if (q.zeitraum != null && q.jahr != null) teile.push(`${q.zeitraum} ${q.jahr}`)
  const d = tag(q.datum) ?? tag(q.ernte_datum)
  if (d) teile.push(d)
  if (q.menge_liter != null && zahl(q.menge_liter)) teile.push(`${zahl(q.menge_liter)} L`)
  if (q.menge_kg != null && zahl(q.menge_kg)) teile.push(`${zahl(q.menge_kg)} kg`)
  if (q.anzahl_flaschen != null && zahl(q.anzahl_flaschen, 0)) teile.push(`${zahl(q.anzahl_flaschen, 0)} Fl.`)
  if (q.menge != null && q.menge_liter == null && q.menge_kg == null && zahl(q.menge)) teile.push(`Menge ${zahl(q.menge)}`)
  const betrag = q.betrag_brutto ?? q.betrag ?? q.betrag_netto
  if (betrag != null && zahl(betrag)) teile.push(`€ ${zahl(betrag)}`)
  if (txt(q.status) && !teile.length) teile.push(`Status ${q.status}`)
  return teile.join(' · ') || '–'
}

/** Link zum Datensatz (nur, wenn er noch existieren kann und eine Seite dafür da ist) */
export function journalLink(tabelle: string, id: string | null, aktion: JournalAktion): string | null {
  if (!id || aktion === 'loeschung') return null
  switch (tabelle) {
    case 'weinausbau': return `/kellerbuch/weinausbau/${id}`
    case 'verkaufsposten': return `/weinhandel/verkauf/${id}`
    case 'rechnungen': return `/weinhandel/rechnungen/${id}`
    case 'fuellungen': return `/weinhandel/fuellungen/${id}/edit`
    case 'zukauf_posten': return `/weinhandel/zukauf/${id}/edit`
    case 'behandlungen': return `/behandlungen/${id}/edit`
    case 'weingarten': return `/weingarten/${id}`
    case 'dac_antrag': return `/dac/${id}`
    case 'ea_belege': return `/buchhaltung/belege/${id}`
    case 'exportauftraege': return `/weinexport/${id}`
    case 'weinjahrgaenge': return `/erntemeldung/${id}`
    default: return null
  }
}

export type JournalZeile = {
  id: number | string
  zeitpunkt: string
  bereich: string
  vorgang: string
  aktion: JournalAktion
  aktionText: string
  beschreibung: string
  felder: string | null
  grund: string | null
  benutzerId: string | null
  benutzer: string
  link: string | null
}

const AKTION_TEXT: Record<JournalAktion, string> = Object.fromEntries(JOURNAL_AKTIONEN.map(a => [a.key, a.label])) as Record<JournalAktion, string>

/** Protokollzeilen → Journalzeilen (reine Umformung) */
export function journalZeilen(roh: readonly R[], namen: ReadonlyMap<string, string>): JournalZeile[] {
  return roh.map(p => {
    const spalten = Array.isArray(p.geaenderte_spalten) ? (p.geaenderte_spalten as string[]) : null
    const neu = (p.neu ?? null) as R | null
    const alt = (p.alt ?? null) as R | null
    const aktion = aktionDerZeile(p.aktion, spalten, neu)
    const benutzerId = typeof p.benutzer_id === 'string' ? p.benutzer_id : null
    return {
      id: p.id,
      zeitpunkt: p.erstellt_am,
      bereich: bereichDerTabelle(p.tabelle)?.label ?? 'Sonstiges',
      vorgang: TABELLE_LABEL[p.tabelle] ?? p.tabelle,
      aktion,
      aktionText: AKTION_TEXT[aktion],
      beschreibung: beschreibung((p.kennung ?? null) as R | null, aktion === 'loeschung' ? alt : null, neu),
      felder: aktion === 'aenderung' && spalten?.length ? spalten.join(', ') : null,
      grund: typeof p.grund === 'string' && p.grund.trim() ? p.grund.trim() : null,
      benutzerId,
      benutzer: benutzerId ? (namen.get(benutzerId) ?? 'ehemaliges Mitglied') : 'System',
      link: journalLink(p.tabelle, typeof p.datensatz_id === 'string' ? p.datensatz_id : null, aktion),
    }
  })
}

/** Nach Aktion filtern (Änderung und Storno sind beide UPDATE und lassen sich erst nach dem Laden trennen) */
export function nachAktion(zeilen: readonly JournalZeile[], aktion: JournalAktion | null): JournalZeile[] {
  return aktion ? zeilen.filter(z => z.aktion === aktion) : [...zeilen]
}

export type JournalFilter = { von: string; bis: string; bereich: JournalBereich | null; aktion: JournalAktion | null; benutzer: string | null }

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tag minus n Tage (Kalendertage, stringbasiert über UTC – keine Zeitzonenverschiebung) */
export function tageZurueck(tag: string, n: number): string {
  const d = new Date(`${tag}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Filter aus der URL; Standard: die letzten 30 Tage bis heute (Wien) */
export function journalFilter(sp: Record<string, string | string[] | undefined>, heute: string): JournalFilter {
  const eins = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v.trim() : '' }
  let von = DATUM_RE.test(eins('von')) ? eins('von') : tageZurueck(heute, 29)
  let bis = DATUM_RE.test(eins('bis')) ? eins('bis') : heute
  if (von > bis) [von, bis] = [bis, von]
  const bereich = JOURNAL_BEREICHE.find(b => b.key === eins('bereich'))?.key ?? null
  const aktion = JOURNAL_AKTIONEN.find(a => a.key === eins('aktion'))?.key ?? null
  const benutzer = UUID_RE.test(eins('benutzer')) ? eins('benutzer').toLowerCase() : null
  return { von, bis, bereich, aktion, benutzer }
}

/** Suchparameter eines Filters (für CSV-Link und Formular) */
export function filterParameter(f: JournalFilter): Record<string, string> {
  const p: Record<string, string> = { von: f.von, bis: f.bis }
  if (f.bereich) p.bereich = f.bereich
  if (f.aktion) p.aktion = f.aktion
  if (f.benutzer) p.benutzer = f.benutzer
  return p
}

export const SPALTEN_JOURNAL: CsvSpalte<JournalZeile>[] = [
  { kopf: 'Zeitpunkt', typ: 'zeitpunkt', wert: z => z.zeitpunkt },
  { kopf: 'Bereich', typ: 'text', wert: z => z.bereich },
  { kopf: 'Vorgang', typ: 'text', wert: z => z.vorgang },
  { kopf: 'Aktion', typ: 'text', wert: z => z.aktionText },
  { kopf: 'Datensatz', typ: 'text', wert: z => z.beschreibung },
  { kopf: 'Geänderte Felder', typ: 'text', wert: z => z.felder },
  { kopf: 'Grund', typ: 'text', wert: z => z.grund },
  { kopf: 'Benutzer', typ: 'text', wert: z => z.benutzer },
]
