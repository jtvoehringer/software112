// ── Journal: wer hat wann in welchem Bereich was gebucht (KAN-332, 13.10.2026) ──
//
// Quelle ist das Bestandsprotokoll (KAN-35): Seit KAN-332 schreibt es auch Neuanlagen und zu jeder Zeile eine Kennung
// (Name, Nummer, Datum, Menge …). Entscheidungen Jörgen 13.10.2026: Mitarbeiter sehen ihre eigenen Vorgänge, die
// Betriebsleitung alle (Filter nach Benutzer); Anlage, Änderung, Storno, Löschung; alle Bereiche des Protokolls;
// Reiter „Journal“ auf der Übersicht mit Druck und CSV.
//
// Reine Funktionen ohne '@/'-Importe (Tests laden die Datei direkt mit Node): Bereich je Tabelle, Aktion, Beschreibung,
// Link zum Datensatz, Filter aus der URL und die CSV-Spalten. Laden: lib/journal/laden.ts.
//
// KAN-376 (22.10.2026): Mengen von 0 erscheinen nicht mehr („0 L“), eine Schwundbuchung zeigt ihre Schwundmenge; Links
// auch für Tabellen ohne eigene Seite über den Elterndatensatz (JOURNAL_NACHLADEN, nachgeladen in laden.ts).

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
  // UAT 23.10.2026: Produktion (KAN-118) – das Bestandsprotokoll erfasst die Tabellen noch nicht (Stand 23.10.2026);
  // Bezeichnung, Bereich und Link stehen bereit. Bis dahin zeigt die neue Charge ihre Herkunft (PRODUKTION_HERKUNFT).
  produktionen: 'Produktion',
  produktion_eingaenge: 'Produktion – Eingang',
}

/** Bereiche des Journals (Filter „Bereich“) mit ihren Tabellen */
export const JOURNAL_BEREICHE = [
  { key: 'kellerbuch', label: 'Kellerbuch', tabellen: ['weinausbau', 'keller_umzuege', 'verschneidungen', 'verschneidung_quellen', 'keller_behandlungen', 'keller_behandlungstypen', 'zukauf_posten', 'dac_antrag', 'pruefnummernantraege', 'weinanalysen', 'produktionen', 'produktion_eingaenge'] },
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
/** KAN-376: Zahl nur, wenn sie (gerundet) nicht 0 ist – zahl(0) ist der String "0" und damit truthy („22.10.2026 · 0 L“) */
const zahlOhneNull = (v: unknown, stellen = 2) => {
  const z = zahl(v, stellen)
  return z && z !== '0' && z !== '−0' ? z : null
}
const tag = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : null
const txt = (v: unknown) => typeof v === 'string' && v.trim() !== '' ? v.trim() : (typeof v === 'number' ? String(v) : null)

/** Kurzbeschreibung eines Datensatzes aus Kennung (seit KAN-332) bzw. alt/neu (ältere Zeilen); KAN-376: `daten` = der
 *  nachgeladene Datensatz (niedrigster Vorrang – die Kennung hält den Stand zum Zeitpunkt der Buchung) */
export function beschreibung(kennung: R | null, alt: R | null = null, neu: R | null = null, daten: R | null = null): string {
  const q: R = { ...(daten ?? {}), ...(alt ?? {}), ...(neu ?? {}), ...(kennung ?? {}) }
  // KAN-376: Schwundbuchung (keller_umzuege, umzug_typ 'schwund') hat menge_liter 0 – die Menge steht in schwund_liter
  // bzw. brutto_liter; umzug_typ und Mengen kommen aus dem nachgeladenen Datensatz (die Kennung hat nur datum/menge_liter)
  const schwund = q.umzug_typ === 'schwund' ? zahlOhneNull(q.schwund_liter) ?? zahlOhneNull(q.brutto_liter) : null
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
  if (schwund) teile.push(`Schwund ${schwund} L`)
  else if (zahlOhneNull(q.menge_liter)) teile.push(`${zahlOhneNull(q.menge_liter)} L`)
  if (zahlOhneNull(q.menge_kg)) teile.push(`${zahlOhneNull(q.menge_kg)} kg`)
  if (zahlOhneNull(q.anzahl_flaschen, 0)) teile.push(`${zahlOhneNull(q.anzahl_flaschen, 0)} Fl.`)
  if (q.menge_liter == null && q.menge_kg == null && zahlOhneNull(q.menge)) teile.push(`Menge ${zahlOhneNull(q.menge)}`)
  const betrag = q.betrag_brutto ?? q.betrag ?? q.betrag_netto
  if (zahlOhneNull(betrag)) teile.push(`€ ${zahlOhneNull(betrag)}`)
  // UAT 23.10.2026: Produktion (Art und Zielmenge) bzw. Charge aus einer Produktion
  if (!name && q.ziel_menge != null && PRODUKTION_ART[q.art]) {
    teile.unshift(PRODUKTION_ART[q.art])
    if (zahlOhneNull(q.ziel_menge)) teile.push(`${zahlOhneNull(q.ziel_menge)} L`)
  }
  const ausProduktion = produktionHerkunftText(q.produktion)
  if (ausProduktion) teile.push(ausProduktion)
  if (txt(q.status) && !teile.length) teile.push(`Status ${q.status}`)
  return teile.join(' · ') || '–'
}

/**
 * KAN-376: Datensätze, die laden.ts nach dem Laden der Protokollzeilen je Tabelle nachlädt (in Blöcken, nur der eigene
 * Betrieb) – für den Link über den Elterndatensatz und Zusatzfelder der Beschreibung (Schwundmenge). `mandant` ist die
 * Spalte für den Betriebsfilter (bei Tabellen ohne tenant_id über die eingebettete Elternzeile, !inner).
 */
// storno-sichtbar: nur Verweise auf Charge, Pressung bzw. Lese für den Link – auch stornierte Zeilen haben eine Seite
export const JOURNAL_NACHLADEN: Readonly<Record<string, { spalten: string; mandant: string }>> = {
  keller_umzuege: { spalten: 'id, von_weinausbau_id, nach_weinausbau_id, umzug_typ, menge_liter, schwund_liter, brutto_liter', mandant: 'tenant_id' },
  verschneidungen: { spalten: 'id, ziel_weinausbau_id', mandant: 'tenant_id' },
  verschneidung_quellen: { spalten: 'id, verschneidung:verschneidung_id!inner(tenant_id, ziel_weinausbau_id)', mandant: 'verschneidung.tenant_id' },
  keller_behandlungen: { spalten: 'id, weinausbau_id, behaelter_id', mandant: 'tenant_id' },
  fuellung_chargen: { spalten: 'id, fuellung_id', mandant: 'tenant_id' },
  fuellung_bewegungen: { spalten: 'id, fuellung_id', mandant: 'tenant_id' },
  verkauf_positionen: { spalten: 'id, verkaufsposten_id', mandant: 'tenant_id' },
  zahlungen: { spalten: 'id, verkaufsposten_id, rechnung_id', mandant: 'tenant_id' },
  transportbescheinigungen: { spalten: 'id, verkaufsposten_id', mandant: 'tenant_id' },
  pressungen: { spalten: 'id, jahrgang_id, lese_id', mandant: 'tenant_id' },
  pressung_behaelter: { spalten: 'id, weinausbau_id, pressung:pressung_id!inner(tenant_id, jahrgang_id, lese_id, storniert_am)', mandant: 'pressung.tenant_id' },
  pressung_weingaerten: { spalten: 'id, pressung:pressung_id!inner(tenant_id, jahrgang_id, lese_id, storniert_am)', mandant: 'pressung.tenant_id' },
  ernte_parzellen: { spalten: 'id, jahrgang_id, lese_id, jahrgang:weinjahrgaenge!ernte_parzellen_jahrgang_id_fkey!inner(tenant_id)', mandant: 'jahrgang.tenant_id' },
  lesen: { spalten: 'id, jahrgang_id', mandant: 'tenant_id' },
  traubenverkauf: { spalten: 'id, verkaufsposten_id', mandant: 'tenant_id' },
  ama_erntemeldungen: { spalten: 'id, jahrgang_id', mandant: 'tenant_id' },
  weinanalysen: { spalten: 'id, weinausbau_id', mandant: 'tenant_id' },
  pruefnummernantraege: { spalten: 'id, dac_antrag_id', mandant: 'tenant_id' },
  grundstuecke: { spalten: 'id, weingarten_id', mandant: 'tenant_id' },
  // UAT 23.10.2026: Produktion → Ziel-Charge
  produktionen: { spalten: 'id, ziel_weinausbau_id, art, wein_liter, ziel_menge', mandant: 'tenant_id' },
  produktion_eingaenge: { spalten: 'id, weinausbau_id, produktion:produktion_id!inner(tenant_id, ziel_weinausbau_id)', mandant: 'produktion.tenant_id' },
}

/**
 * UAT 23.10.2026: Herkunft einer Charge aus einer Produktion – laden.ts lädt zu jeder Charge im Journal die Produktionen,
 * deren Ziel sie ist (Tabelle produktionen, Betriebsfilter tenant_id), und legt sie als `produktion` an den Datensatz der
 * Charge; die Beschreibung nennt dann „aus Produktion Schaumwein / Sekt (1.100 L)“. Auch stornierte (mit Vermerk).
 */
// storno-sichtbar: die Herkunft einer Charge bleibt auch nach dem Storno der Produktion sichtbar (mit Vermerk)
export const PRODUKTION_HERKUNFT = { tabelle: 'produktionen', spalten: 'id, ziel_weinausbau_id, art, wein_liter, ziel_menge, storniert_am' } as const

/** Art der Produktion (wie PRODUKTION_ART_LABEL in lib/kellerbuch/produktion.ts) */
const PRODUKTION_ART: Record<string, string> = {
  spritzer: 'Perlweinspritzer / Spritzer', mischgetraenk: 'Weinmischgetränk', perlwein: 'Perlwein', schaumwein: 'Schaumwein / Sekt', petnat: 'PetNat',
}

/** Text „aus Produktion …“ für die Beschreibung einer Charge; null ohne Produktion */
export function produktionHerkunftText(produktionen: unknown): string | null {
  if (!Array.isArray(produktionen) || produktionen.length === 0) return null
  return (produktionen as R[]).map(p => {
    const menge = zahlOhneNull(p.ziel_menge)
    return `aus Produktion ${PRODUKTION_ART[p.art] ?? 'Produktion'}${menge ? ` (${menge} L)` : ''}${p.storniert_am ? ' – storniert' : ''}`
  }).join(', ')
}

/** Charge-ids im Journal (ohne Löschungen), deren Herkunft aus einer Produktion nachzuladen ist */
export function chargenFuerProduktionHerkunft(roh: readonly R[]): string[] {
  return [...new Set(roh.filter(p => p.tabelle === 'weinausbau' && p.aktion !== 'DELETE' && sid(p.datensatz_id)).map(p => p.datensatz_id as string))].sort()
}

const sid = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const charge = (id: unknown) => (sid(id) ? `/kellerbuch/weinausbau/${id}` : null)
const pressungSeite = (p: R | null | undefined) =>
  sid(p?.jahrgang_id) ? `/kellerbuch/pressungen?jahrgang=${p!.jahrgang_id}${sid(p!.lese_id) ? `&lese=${p!.lese_id}` : ''}` : null
const leseSeite = (jahrgang: unknown, lese: unknown) => (sid(jahrgang) ? `/erntemeldung/${jahrgang}${sid(lese) ? `?lese=${lese}` : ''}` : null)

/** Link zum Datensatz (nur, wenn er noch existieren kann und eine Seite dafür da ist). KAN-376: `d` = der nachgeladene
 *  Datensatz (JOURNAL_NACHLADEN) – Tabellen ohne eigene Seite verlinken über ihren Elterndatensatz; fehlt er (gelöscht,
 *  nicht geladen), gibt es keinen Link. */
export function journalLink(tabelle: string, id: string | null, aktion: JournalAktion, d: R | null = null): string | null {
  if (!id || aktion === 'loeschung') return null
  switch (tabelle) {
    // KAN-376: über den Elterndatensatz
    case 'keller_umzuege': return charge(d?.von_weinausbau_id) ?? charge(d?.nach_weinausbau_id)
    case 'verschneidungen': return charge(d?.ziel_weinausbau_id)
    case 'verschneidung_quellen': return charge((d?.verschneidung as R | null)?.ziel_weinausbau_id)
    case 'keller_behandlungen': return charge(d?.weinausbau_id) ?? (sid(d?.behaelter_id) ? `/kellerbuch/behaelter/${d!.behaelter_id}/behandlungen` : null)
    case 'fuellung_chargen':
    case 'fuellung_bewegungen': return sid(d?.fuellung_id) ? `/weinhandel/fuellungen/${d!.fuellung_id}/edit` : null
    case 'verkauf_positionen': return sid(d?.verkaufsposten_id) ? `/weinhandel/verkauf/${d!.verkaufsposten_id}` : null
    case 'zahlungen': return sid(d?.verkaufsposten_id) ? `/weinhandel/verkauf/${d!.verkaufsposten_id}` : sid(d?.rechnung_id) ? `/weinhandel/rechnungen/${d!.rechnung_id}` : null
    case 'transportbescheinigungen': return sid(d?.verkaufsposten_id) ? `/weinhandel/verkauf/${d!.verkaufsposten_id}/transportbescheinigung` : '/weinhandel/transportbescheinigungen'
    case 'pressungen': return pressungSeite(d)
    case 'pressung_behaelter': return charge(d?.weinausbau_id) ?? pressungSeite(d?.pressung as R | null)
    case 'pressung_weingaerten': return pressungSeite(d?.pressung as R | null)
    case 'ernte_parzellen': return leseSeite(d?.jahrgang_id, d?.lese_id)
    case 'lesen': return leseSeite(d?.jahrgang_id, id)
    case 'traubenverkauf': return sid(d?.verkaufsposten_id) ? `/weinhandel/verkauf/${d!.verkaufsposten_id}` : '/weinhandel/traubenverkauf'
    case 'ama_erntemeldungen': return sid(d?.jahrgang_id) ? `/erntemeldung/${d!.jahrgang_id}` : null
    case 'weinanalysen': return sid(d?.weinausbau_id) ? `/kellerbuch/weinausbau/${d!.weinausbau_id}/analysen` : null
    case 'pruefnummernantraege': return sid(d?.dac_antrag_id) ? `/dac/${d!.dac_antrag_id}/antrag` : null
    case 'grundstuecke': return sid(d?.weingarten_id) ? `/weingarten/${d!.weingarten_id}` : null
    // UAT 23.10.2026: Produktion → die erzeugte Charge
    case 'produktionen': return charge(d?.ziel_weinausbau_id)
    case 'produktion_eingaenge': return charge((d?.produktion as R | null)?.ziel_weinausbau_id) ?? charge(d?.weinausbau_id)
    // KAN-376: Listen ohne Einzelseite
    case 'ea_transaktionen': return '/buchhaltung'
    case 'ea_uva': return '/buchhaltung/uva'
    case 'ea_monatsabschluss': return '/buchhaltung/monatsabschluss'
    case 'ea_kategorien': return '/buchhaltung/kategorien'
    case 'ea_dauerauftraege': return '/buchhaltung/dauerauftraege'
    case 'psm_lager_bewegungen':
    case 'duengemittel_lager_bewegungen':
    case 'betriebsmittel_lager_bewegungen':
    case 'pflanzenschutzmittel':
    case 'duengemittel':
    case 'betriebsmittel': return '/behandlungen/lager'
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

/** KAN-376: nachgeladene Datensätze je Tabelle und id (JOURNAL_NACHLADEN) */
export type JournalDaten = ReadonlyMap<string, ReadonlyMap<string, R>>

/** KAN-376: welche Datensätze laden.ts nachladen muss – je Tabelle aus JOURNAL_NACHLADEN die ids (ohne Löschungen) */
export function nachzuladendeIds(roh: readonly R[]): Map<string, string[]> {
  const m = new Map<string, Set<string>>()
  for (const p of roh) {
    const id = sid(p.datensatz_id)
    if (!id || p.aktion === 'DELETE' || !JOURNAL_NACHLADEN[p.tabelle]) continue
    if (!m.has(p.tabelle)) m.set(p.tabelle, new Set())
    m.get(p.tabelle)!.add(id)
  }
  return new Map([...m].map(([t, ids]) => [t, [...ids].sort()]))
}

/** Protokollzeilen → Journalzeilen (reine Umformung); KAN-376: `daten` = nachgeladene Datensätze für Link und Beschreibung */
export function journalZeilen(roh: readonly R[], namen: ReadonlyMap<string, string>, daten: JournalDaten = new Map()): JournalZeile[] {
  return roh.map(p => {
    const spalten = Array.isArray(p.geaenderte_spalten) ? (p.geaenderte_spalten as string[]) : null
    const neu = (p.neu ?? null) as R | null
    const alt = (p.alt ?? null) as R | null
    const aktion = aktionDerZeile(p.aktion, spalten, neu)
    const benutzerId = typeof p.benutzer_id === 'string' ? p.benutzer_id : null
    const datensatzId = typeof p.datensatz_id === 'string' ? p.datensatz_id : null
    const d = aktion === 'loeschung' || !datensatzId ? null : (daten.get(p.tabelle)?.get(datensatzId) ?? null)
    return {
      id: p.id,
      zeitpunkt: p.erstellt_am,
      bereich: bereichDerTabelle(p.tabelle)?.label ?? 'Sonstiges',
      vorgang: TABELLE_LABEL[p.tabelle] ?? p.tabelle,
      aktion,
      aktionText: AKTION_TEXT[aktion],
      beschreibung: beschreibung((p.kennung ?? null) as R | null, aktion === 'loeschung' ? alt : null, neu, d),
      felder: aktion === 'aenderung' && spalten?.length ? spalten.join(', ') : null,
      grund: typeof p.grund === 'string' && p.grund.trim() ? p.grund.trim() : null,
      benutzerId,
      benutzer: benutzerId ? (namen.get(benutzerId) ?? 'ehemaliges Mitglied') : 'System',
      link: journalLink(p.tabelle, datensatzId, aktion, d),
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
