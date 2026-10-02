// ── Weinbestandsmeldung (BSM) nach Buchungsarten je Meldezeitraum – Behördenmeldung (KAN-43 Etappe 2, 02.10.2026) ──
//
// Entscheidung Jörgen 02.10.2026: BSM = 1.8.–31.7. (Weinwirtschaftsjahr, Stichtag 31. Juli, § 29 Weingesetz 2009).
// Das Geschäftsjahr des Betriebs (Kalenderjahr) betrifft die BSM nicht; der Zeitraum ist trotzdem frei wählbar
// (?von=JJJJ-MM-TT&bis=JJJJ-MM-TT, Schnellwahl „Kalenderjahr“ nur als zusätzliche Auswertung, keine BSM).
// Standard: STANDARD_BSM_ZEITRAUM – das zuletzt abgeschlossene Weinwirtschaftsjahr (vor dem 1. August das davor).
//
// Rechnung je Zelle (Herkunft AT/EU/Drittland × BSM-Spalte × Meldefarbe × offen/Flasche):
//   Anfangsbestand = Bestand am Ende des Vortags von „von“ (bestandZum, wie die Weinbestandsmeldung Etappe 1)
//                    + Eröffnungsbestände mit Stichtag im Zeitraum (KAN-42)
//   + Σ Zugänge − Σ Abgänge je BSM-Buchungsart (kat_buchungsart, Spiegel lib/katalog/bki.ts)
//   = Endbestand lt. Rechnung  ↔  Bestand zum „bis“ (bestandZum) – jede Differenz wird als Warnung ausgewiesen.
// Beide Bestände und alle Buchungen kommen aus EINER Ladung (ladeBestandsGrundlage): dieselben Bewegungen wie
// Bewegungsbuch und Stichtagsbestand (ladeBewegungenBetrieb), Flaschen über Abfüllung, fuellung_bewegungen und
// Flaschenverkäufe. Storno-Gegenbuchungen stehen am Storno-Tag in derselben Buchungsart mit umgekehrtem Vorzeichen.
//
// Zuordnung interne Bewegung → BSM-Buchungsart: BSM_ZUORDNUNG (unten, auch auf der Druckseite).
// Abwertung (R9): Wechselt bei Umzug, Filtration oder Füllung die BSM-Spalte (Qualitätsstufe, Zusatzbezeichnung bzw.
// Erzeugnis nur, wenn sich die Spalte ändert), wird die neutrale Umbuchung zu AB_ABW in der alten und ZU_ABW in der
// neuen Spalte. Verschnitt bucht die Quellen als VS_AB und das Ergebnis als VS_ZU; ändert sich dabei die Spalte des
// Ziel-Weins, geht der schon vorhandene Wein der Ziel-Charge per AB_ABW/ZU_ABW um (ebenso beim Umzug in eine
// bestehende Charge). Eine Aufwertung (höhere Spalte) wird gebucht, aber als Warnung gemeldet.
//
// Gliederungsmerkmale zum Buchungszeitpunkt: Qualitätsangabe der Charge aus den Momentaufnahmen (verschneidungen.
// ziel_qualitaet_vorher …, keller_umzuege-Zielzeile qualitaet_vorher …), sonst die heutige; Farbe (weinart bzw.
// Rebsorte), Rebsorte/Jahrgang (Wein vs. Rebsortenwein) und Ursprungsland (land_iso) sind die heutigen Stammdaten –
// Grenze ohne Bewegungsjournal (AP3). Zukauf und Füllung buchen in den Merkmalen der Charge bzw. der Füllung.
//
// Druckseite (/reports/bestandsmeldung-bsm) und CSV (Register „bsm“, „bsm-kontrolljournal“) nutzen ladeBsm();
// Mengen in Liter (2 Stellen), je Zeile zusätzlich hl (3 Stellen). Die Summen addieren die gerundeten Zeilenwerte.
// Weindatenbank-Format (Wein-ONLINE) ist nicht spezifiziert – Standardprofil EXCEL_AT.

import { STELLEN, runden, wienHeute, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { KAT_BUCHUNGSART, KAT_ERZEUGNIS, katalogQualitaet, meldeFarbe, type BsmSpalte, type MeldeFarbe } from '@/lib/katalog/bki'
import { istEuLand, landAnzeige, normalisiereLand } from '@/lib/katalog/laender'
import { normalisiereQualitaet, type QualitaetsAngabe } from '@/lib/wein/qualitaetsrang'
import { bkiFarbe } from '@/lib/wein/bki_kuerzel'
import { istFlaschenEroeffnung } from '@/lib/kellerbuch/eroeffnungsStichtag'
import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { fmtNum } from '@/lib/format'
import { bestandJePosten, istNegativ, ladeBestandsGrundlage, type BestandsGrundlage, type ChargenPosten, type FuellungsPosten } from './bestandsmeldung'
import { bestandAmStichtag, standardStichtag } from './bestandZum'
import { stornoText, type Bewegung } from './bewegungsbuch'
import { datumAT, textOderNull, zahlOderNull } from './ernte_hilfen'
import { istTag, tag } from './kellerbuch-hilfen'
import { parameterFehler, type ParameterFehler } from './typen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

/** hl je Zeile mit 3 Stellen (wie die Weinbestandsmeldung) */
export const HL_STELLEN_BSM = 3
/** Unter einem halben Zentiliter gilt eine Menge als 0 */
const NULL_UNTER = 0.005

// ── Meldezeitraum ─────────────────────────────────────────────────────────────────────────────────────

export type BsmZeitraumArt = 'weinwirtschaftsjahr' | 'kalenderjahr'
/** Standard des Meldezeitraums – Entscheidung Jörgen 02.10.2026: BSM = Weinwirtschaftsjahr 1.8.–31.7. */
export const STANDARD_BSM_ZEITRAUM: BsmZeitraumArt = 'weinwirtschaftsjahr'

export type BsmZeitraum = { von: string; bis: string }
export type BsmParameter = BsmZeitraum & {
  /** nur Kontrolljournal: Filter auf Buchungsarten (Kürzel); leer = alle */
  arten: string[]
}

/** Weinwirtschaftsjahr ab 1. August `beginnJahr` (bis 31. Juli des Folgejahres) */
export function weinwirtschaftsjahr(beginnJahr: number): BsmZeitraum {
  return { von: `${beginnJahr}-08-01`, bis: `${beginnJahr + 1}-07-31` }
}

export function kalenderjahr(jahr: number): BsmZeitraum {
  return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` }
}

/** Beginnjahr des Weinwirtschaftsjahres, in dem `datum` liegt */
export function wjBeginnJahr(datum: string): number {
  const j = Number(datum.slice(0, 4))
  return datum.slice(5, 10) >= '08-01' ? j : j - 1
}

/** „2025/26“ */
export function wjLabel(beginnJahr: number): string {
  return `${beginnJahr}/${String(beginnJahr + 1).slice(2)}`
}

/** Standard-Meldezeitraum: zuletzt abgeschlossenes Weinwirtschaftsjahr (bis = standardStichtag) bzw. Kalenderjahr */
export function standardBsmZeitraum(heute: string, art: BsmZeitraumArt = STANDARD_BSM_ZEITRAUM): BsmZeitraum {
  if (art === 'kalenderjahr') return kalenderjahr(Number(heute.slice(0, 4)) - 1)
  return weinwirtschaftsjahr(Number(standardStichtag(heute).slice(0, 4)) - 1)
}

export const istWeinwirtschaftsjahr = (z: BsmZeitraum) =>
  z.von.slice(5) === '08-01' && z.bis.slice(5) === '07-31' && Number(z.bis.slice(0, 4)) === Number(z.von.slice(0, 4)) + 1

/** Kalendertag davor ('JJJJ-MM-TT') */
export function vortag(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Schnellwahlen der Druckseite (Kalenderjahr ausdrücklich nur als Auswertung) */
export function bsmSchnellwahlen(heute: string): { label: string; von: string; bis: string }[] {
  const wjLaufend = wjBeginnJahr(heute)
  const kj = Number(heute.slice(0, 4))
  const wj = (j: number) => ({ label: `Weinwirtschaftsjahr ${wjLabel(j)}`, ...weinwirtschaftsjahr(j) })
  return [
    wj(wjLaufend - 1),
    wj(wjLaufend - 2),
    { label: `laufendes Weinwirtschaftsjahr ${wjLabel(wjLaufend)} bis heute`, von: weinwirtschaftsjahr(wjLaufend).von, bis: heute },
    { label: `Kalenderjahr ${kj - 1} (Auswertung, keine BSM)`, ...kalenderjahr(kj - 1) },
    { label: `Kalenderjahr ${kj} bis heute (Auswertung, keine BSM)`, von: `${kj}-01-01`, bis: heute },
  ]
}

/** Kürzel aller Buchungsarten (Filter des Kontrolljournals) */
const ALLE_CODES = new Set(KAT_BUCHUNGSART.map(b => b.code))

/**
 * ?von=&bis= (beide oder keiner; leer → Standard), ?art=CODE[,CODE] (Kontrolljournal). bis höchstens heute
 * (der Bestand ist nur bis heute bestimmbar), von ≤ bis.
 */
export function bsmParameter(sp: URLSearchParams, heute: string = wienHeute()): BsmParameter | ParameterFehler {
  const von = (sp.get('von') ?? '').trim()
  const bis = (sp.get('bis') ?? '').trim()
  const arten = (sp.get('art') ?? '').split(',').map(a => a.trim().toUpperCase()).filter(Boolean)
  const unbekannt = arten.filter(a => !ALLE_CODES.has(a))
  if (unbekannt.length > 0) return parameterFehler(`Unbekannte Buchungsart: ${unbekannt.join(', ')}.`)
  if (!von && !bis) return { ...standardBsmZeitraum(heute), arten }
  if (!von || !bis) return parameterFehler('Bitte Beginn (von) und Ende (bis) des Meldezeitraums angeben.')
  if (!istTag(von) || !istTag(bis)) return parameterFehler('Ungültiger Zeitraum – bitte als JJJJ-MM-TT angeben (z. B. ?von=2025-08-01&bis=2026-07-31).')
  if (von > bis) return parameterFehler(`Der Beginn ${datumAT(von)} liegt nach dem Ende ${datumAT(bis)}.`)
  if (bis > heute) return parameterFehler(`Das Ende ${datumAT(bis)} liegt in der Zukunft – ein Bestand ist nur bis heute (${datumAT(heute)}) bestimmbar.`)
  return { von, bis, arten }
}

/** Kennzeichnung für Dateiname und Überschrift */
export function bsmKennzeichnung(z: BsmZeitraum): string {
  return istWeinwirtschaftsjahr(z) ? `WJ ${wjLabel(Number(z.von.slice(0, 4)))}` : `${z.von} bis ${z.bis}`
}

// ── Spalten, Farbe, Herkunft ──────────────────────────────────────────────────────────────────────────

export type Herkunft = 'AT' | 'EU' | 'DRITT'
export type Gebinde = 'offen' | 'flasche'
/** BSM-Spalte bzw. 'ohne' (keine Zuordnung möglich, z. B. Industriewein) */
export type SpalteSchluessel = BsmSpalte | 'ohne'

export const BSM_SPALTEN: readonly { key: BsmSpalte; label: string; rang: number | null }[] = [
  { key: 'wein', label: 'Wein', rang: 0 },
  { key: 'rebsortenwein', label: 'Rebsortenwein', rang: 1 },
  { key: 'landwein', label: 'Landwein', rang: 2 },
  { key: 'qualitaetswein', label: 'Qualitätswein', rang: 3 },
  { key: 'praedikatswein', label: 'Prädikatswein', rang: 4 },
  { key: 'perl_schaumwein', label: 'Perlwein und Schaumwein', rang: null },
  { key: 'sonstige', label: 'Sonstige Erzeugnisse', rang: null },
]
export const SPALTE_OHNE_LABEL = 'ohne Zuordnung'
export const spalteLabel = (s: BsmSpalte | null) => (s ? BSM_SPALTEN.find(x => x.key === s)?.label ?? s : SPALTE_OHNE_LABEL)
const spalteRang = (s: BsmSpalte | null) => (s ? BSM_SPALTEN.find(x => x.key === s)?.rang ?? null : null)

export const HERKUNFT_LABEL: Record<Herkunft, string> = { AT: 'Österreich', EU: 'andere EU-Mitgliedstaaten', DRITT: 'Drittland' }
export const GEBINDE_LABEL: Record<Gebinde, string> = { offen: 'offen (Fass/Tank)', flasche: 'Flasche' }
export const FARBE_LABEL_BSM: Record<MeldeFarbe, string> = { W: 'weiß', R: 'rot (inkl. Rosé)' }

/** Erzeugnisse der Spalte „Perlwein und Schaumwein“ bzw. „Sonstige Erzeugnisse“ (R8b) */
const PERL_SCHAUM = new Set(['SEKTGU', 'PERLWEIN', 'SCHAUMW', 'PETNAT'])
const SONSTIGE_ERZEUGNISSE = new Set(['LIKOERW', 'AROMAW', 'WEINHALT', 'ENTALK'])
const NICHT_BSM = new Set(KAT_ERZEUGNIS.filter(e => !e.bsmRelevant).map(e => e.code))

/** Gliederungsmerkmale eines Weins zu einem Zeitpunkt */
export type Merkmale = {
  angabe: QualitaetsAngabe
  weinart: string | null
  rebsorte: string | null
  jahrgang: number | null
  land: string | null
}

/**
 * BSM-Spalte: Erzeugnis Sekt/Perlwein/Schaumwein/PetNat → Perl- und Schaumwein, Likör-/aromatisierter Wein,
 * weinhaltiges Getränk, entalkoholisiert → Sonstige; sonst nach der Stufe (kat_qualitaetsstufe.bsm_spalte),
 * „Wein“ mit Rebsorte oder Jahrgang → Rebsortenwein. Ohne Stufe: wie „Wein“ (ohneStufe = true).
 * relevant = false: nicht bestandsmeldepflichtig (Traubensaft, R10).
 */
export function bsmSpalte(m: Pick<Merkmale, 'angabe' | 'rebsorte' | 'jahrgang'>): { spalte: BsmSpalte | null; relevant: boolean; ohneStufe: boolean } {
  const erz = m.angabe.erzeugnis
  if (erz && NICHT_BSM.has(erz)) return { spalte: null, relevant: false, ohneStufe: false }
  if (erz && PERL_SCHAUM.has(erz)) return { spalte: 'perl_schaumwein', relevant: true, ohneStufe: false }
  if (erz && SONSTIGE_ERZEUGNISSE.has(erz)) return { spalte: 'sonstige', relevant: true, ohneStufe: false }
  const mitSorte = !!textOderNull(m.rebsorte) || m.jahrgang != null
  const k = katalogQualitaet(m.angabe.stufe)
  if (!k) return { spalte: mitSorte ? 'rebsortenwein' : 'wein', relevant: true, ohneStufe: true }
  if (k.code === 'WEI') return { spalte: mitSorte ? 'rebsortenwein' : 'wein', relevant: true, ohneStufe: false }
  return { spalte: k.bsmSpalte, relevant: true, ohneStufe: false }
}

/** Meldefarbe: weinart (Rosé = rot, R17), sonst aus der Rebsorte (BKI-Kürzelliste); unbekannt → null */
export function bsmFarbe(m: Pick<Merkmale, 'weinart' | 'rebsorte'>): MeldeFarbe | null {
  return meldeFarbe(m.weinart) ?? meldeFarbe(bkiFarbe(m.rebsorte))
}

/** Herkunft aus dem Ursprungsland (ISO); ohne Angabe Österreich (unbekannt = true) */
export function bsmHerkunft(land: string | null | undefined): { herkunft: Herkunft; unbekannt: boolean } {
  const iso = normalisiereLand(land)
  if (!iso) return { herkunft: 'AT', unbekannt: true }
  if (iso === 'AT') return { herkunft: 'AT', unbekannt: false }
  return { herkunft: istEuLand(iso) ? 'EU' : 'DRITT', unbekannt: false }
}

// ── Zuordnung Bewegung → Buchungsart ──────────────────────────────────────────────────────────────────

/** Neutrale interne Vorgänge (heben sich je Spalte auf; ein Rest erscheint als „Umbuchungen“ samt Warnung) */
export const NEUTRALE_CODES = new Set(['UMZUG', 'FILTRAT', 'FUELLUNG'])

/** Dokumentierte Zuordnung (Druckseite „Zuordnung der Buchungsarten“) */
export const BSM_ZUORDNUNG: readonly { vorgang: string; code: string; hinweis?: string }[] = [
  { vorgang: 'Pressung (eigene Ernte)', code: 'ERNTE', hinweis: 'auch Pressungen zugekaufter Trauben (keine Trennung erfasst)' },
  { vorgang: 'Zukauf Wein in eine Charge', code: 'ZK_FASS' },
  { vorgang: 'Zukauf Most', code: 'ZK_MOST' },
  { vorgang: 'Zukauf Trauben', code: 'ZK_TRAUB', hinweis: 'nur in kg (Umrechnung in Liter offen), nicht in der Literrechnung' },
  { vorgang: 'Füllung ohne Charge (nicht Eröffnungsbestand)', code: 'ZK_FLA', hinweis: 'als Flaschenzukauf gezählt – prüfen' },
  { vorgang: 'Tankverkauf an Kunden in Österreich / im Ausland', code: 'VK_FA_AT / VK_FA_AU', hinweis: 'Land der Firma bzw. des Kontakts am Beleg' },
  { vorgang: 'Flaschenverkauf (Stück × Flaschengröße) in Österreich / ins Ausland', code: 'VK_FL_AT / VK_FL_AU' },
  { vorgang: 'Verschnitt: Quell-Charge / Ziel-Charge', code: 'VS_AB / VS_ZU' },
  { vorgang: 'Spaltenwechsel bei Umzug, Filtration, Füllung, Verschnitt (vorhandener Ziel-Wein)', code: 'AB_ABW + ZU_ABW' },
  { vorgang: 'Schwundbuchung, Schwund bei Umzug/Filtration, Füllverlust, Bruch, Eigenverbrauch, Inventur-Mindermenge', code: 'SCHWUND' },
  { vorgang: 'Umzug, Filtration', code: 'UMZUG / FILTRAT', hinweis: 'neutral' },
  { vorgang: 'Füllung (offen → Flasche)', code: 'FUELLUNG', hinweis: 'neutral: Abgang offen = Zugang Flasche' },
  { vorgang: 'Eröffnungsbestand (Tank, Flaschen) mit Stichtag im Zeitraum', code: 'EROEFF', hinweis: 'im Anfangsbestand' },
  { vorgang: 'Inventur-Mehrmenge, Korrektur (+)', code: 'INV_PLUS', hinweis: 'keine BSM-Buchungsart – Warnung' },
  { vorgang: 'Storno', code: 'Buchungsart der stornierten Buchung', hinweis: 'am Storno-Tag mit umgekehrtem Vorzeichen' },
  { vorgang: 'Traubensaft', code: '–', hinweis: 'nicht bestandsmeldepflichtig (R10), ausgeschlossen' },
]

/** Buchungsart einer Keller-Bewegung (Charge, offen); null = keine Mengenbuchung */
export function buchungsartBewegung(art: Bewegung['art'], k: { zukaufArt?: string | null; kundeAusland?: boolean } = {}): string | null {
  switch (art) {
    case 'anfangsbestand': return 'EROEFF'
    case 'pressung': return 'ERNTE'
    case 'zukauf': return k.zukaufArt === 'most' ? 'ZK_MOST' : 'ZK_FASS'
    case 'verkauf': return k.kundeAusland ? 'VK_FA_AU' : 'VK_FA_AT'
    case 'schwund': return 'SCHWUND'
    case 'verschneidung_aus': return 'VS_AB'
    case 'verschneidung_ein': return 'VS_ZU'
    case 'umzug_ein': case 'umzug_aus': return 'UMZUG'
    case 'filtration_ein': case 'filtration_aus': return 'FILTRAT'
    case 'abfuellung': return 'FUELLUNG'
    default: return null
  }
}

/** Buchungsart einer Flaschenbuchung (FlaschenBuchung.art, Stück mit Vorzeichen) */
export function buchungsartFlasche(art: string, menge: number, k: { kundeAusland?: boolean; mitCharge?: boolean; eroeffnung?: boolean } = {}): string {
  switch (art) {
    case 'abfuellung': case 'storno_fuellung':
      return k.eroeffnung ? 'EROEFF' : k.mitCharge ? 'FUELLUNG' : 'ZK_FLA'
    case 'verkauf': case 'verkauf_storno': case 'verkauf_alt': case 'verkauf_alt_storno':
      return k.kundeAusland ? 'VK_FL_AU' : 'VK_FL_AT'
    case 'bruch': case 'eigenverbrauch': case 'schwund':
      return 'SCHWUND'
    case 'anfangsbestand':
      return 'EROEFF'
    default:   // inventur, korrektur
      return menge < 0 ? 'SCHWUND' : 'INV_PLUS'
  }
}

const KAT = new Map(KAT_BUCHUNGSART.map(b => [b.code, b]))
export const buchungsartLabel = (code: string) => KAT.get(code)?.bezeichnung ?? code

// ── Zeilen ────────────────────────────────────────────────────────────────────────────────────────────

export type BsmZelle = { spalte: BsmSpalte | null; farbe: MeldeFarbe | null; herkunft: Herkunft; gebinde: Gebinde }

/** Eine BSM-Buchung (Kontrolljournal): liter > 0 erhöht, < 0 mindert den Bestand der Zelle */
export type BsmBuchung = BsmZelle & {
  datum: string
  code: string
  liter: number
  /** nur ZK_TRAUB: Menge in kg (liter = 0) */
  kg: number | null
  vorgang: string
  charge: string | null
  fuellung: string | null
  gegenstelle: string | null
  beleg: string | null
  storno: string | null
  hinweis: string | null
}

export type BsmPosition = 'ANFANG' | 'ENDE' | 'STICHTAG' | 'DIFFERENZ' | 'NEUTRAL' | string

/** Eine Zeile der Summentabelle (Druck und CSV „bsm“) */
export type BsmSummenZeile = {
  von: string
  bis: string
  herkunft: Herkunft
  /** ANFANG, Buchungsart-Kürzel, INV_PLUS, NEUTRAL, ENDE, STICHTAG, DIFFERENZ */
  position: BsmPosition
  bezeichnung: string
  /** Zugang / Abgang / Bestand / Prüfung */
  abschnitt: 'Bestand' | 'Zugang' | 'Abgang' | 'Prüfung'
  /** 'gesamt' bzw. „davon …“ */
  teil: string
  werte: Record<SpalteSchluessel, number>
  summeLiter: number
  summeHl: number
}

export type BsmDaten = {
  zeitraum: BsmZeitraum
  /** Stichtag des Anfangsbestands (Vortag von „von“) */
  anfangAm: string
  heute: string
  istWeinwirtschaftsjahr: boolean
  /** Kontrolljournal, nach Datum */
  buchungen: BsmBuchung[]
  summen: BsmSummenZeile[]
  /** angezeigte Herkunfts-Abschnitte (AT immer) */
  herkuenfte: Herkunft[]
  /** 'ohne' nur, wenn eine Menge keiner Spalte zugeordnet werden kann */
  spalten: SpalteSchluessel[]
  /** Zugekaufte Trauben im Zeitraum (kg, nicht umgerechnet) */
  traubenKg: number
  warnungen: string[]
}

const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`
const auszug = (namen: readonly string[]) => [...new Set(namen)].slice(0, 5).join(', ') + (new Set(namen).size > 5 ? ' …' : '')
const l2 = (x: number) => runden(x, STELLEN.liter)
const fmtL = (x: number) => `${fmtNum(x, 2)} l`

/** Zusätzliche Daten der BSM (Kundenland, Traubenzukauf) */
export type BsmZusatz = {
  /** verkaufsposten je id, Momentaufnahme (partner_daten) bereits angewendet */
  verkaufsposten: Map<string, R>
  /** zukauf_posten art 'trauben' (aktiv) */
  traubenZukauf: R[]
}

export async function ladeBsm(supabase: Client, tenantId: string, z: BsmZeitraum, opts: { heute?: string } = {}): Promise<BsmDaten> {
  const heute = opts.heute ?? wienHeute()
  const [g, vpRes, tzRes] = await Promise.all([
    ladeBestandsGrundlage(supabase, tenantId),
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('verkaufsposten') as any)
        .select('id, datum, rechnungsnummer, partner_daten, kontakt:kontakt_id(vorname, nachname, land), firma:firma_id(name, land)')
        .eq('tenant_id', tenantId)
        .order('id'),
    ),
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('zukauf_posten') as any)
        .select('id, datum, art, einheit, menge, rebsorte, jahrgang, weinart, qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, eingangsrechnungsnummer, partner_daten, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .eq('art', 'trauben')
        .order('datum')
        .order('id'),
    ),
  ])
  if (vpRes.error) throw new Error(`Laden fehlgeschlagen (verkaufsposten): ${vpRes.error.message}`)
  if (tzRes.error) throw new Error(`Laden fehlgeschlagen (zukauf_posten): ${tzRes.error.message}`)
  const verkaufsposten = new Map<string, R>()
  for (const vp of vpRes.data) verkaufsposten.set(vp.id, momentaufnahmeAnwenden(vp, ['kontakt', 'firma']))
  return berechneBsm(g, { verkaufsposten, traubenZukauf: tzRes.data }, z, heute)
}

/** Reine Rechnung (ohne Datenbank) – Tests rufen sie direkt bzw. über ladeBsm() mit der Attrappe */
export function berechneBsm(g: BestandsGrundlage, zusatz: BsmZusatz, z: BsmZeitraum, heute: string): BsmDaten {
  const warnungen: string[] = []
  const anfangAm = vortag(z.von)
  const imZeitraum = (d: string) => !!d && d >= z.von && d <= z.bis

  // ── Hinweise zu den Merkmalen (je Name gesammelt) ──
  const ohneStufe = new Set<string>()
  const ohneFarbe = new Set<string>()
  const landUnbekannt = new Set<string>()
  const nichtRelevant = new Set<string>()
  let kundeLandUnbekannt = 0

  const chargeById = new Map<string, R>(g.betrieb.chargen.map(c => [c.id as string, c]))
  const chargenPosten = new Map<string, ChargenPosten>(g.chargen.map(p => [p.c.id as string, p]))
  const fuellungsPosten = new Map<string, FuellungsPosten>(g.fuellungen.map(p => [p.f.id as string, p]))
  const umzugById = new Map<string, R>(g.betrieb.quellen.umzuege.map(u => [u.id as string, u]))
  const zukaufById = new Map<string, R>(g.betrieb.quellen.zukauf.map(u => [u.id as string, u]))
  const verkaufById = new Map<string, R>(g.betrieb.quellen.verkauf.map(u => [u.id as string, u]))
  const verschnittById = new Map<string, R>(g.betrieb.quellen.verschneidungen.map(u => [u.id as string, u]))

  // Qualitätsereignisse je Charge (Momentaufnahme „vorher“), ohne stornierte Vorgänge
  type Ereignis = { datum: string; vorher: QualitaetsAngabe; rebsorte?: string | null; jahrgang?: number | null }
  const ereignisse = new Map<string, Ereignis[]>()
  const ereignis = (chargeId: string, e: Ereignis) => {
    const liste = ereignisse.get(chargeId) ?? []
    liste.push(e)
    ereignisse.set(chargeId, liste)
  }
  const angabeAus = (stufe: unknown, zusatz: unknown, erzeugnis: unknown) =>
    normalisiereQualitaet({ qualitaetsstufe: textOderNull(stufe), zusatzbezeichnung: textOderNull(zusatz), erzeugnis: textOderNull(erzeugnis) })
  for (const v of g.betrieb.quellen.verschneidungen) {
    if (v.storniert_am || !v.ziel_weinausbau_id || !textOderNull(v.ziel_qualitaet_vorher)) continue
    ereignis(v.ziel_weinausbau_id, {
      datum: tag(v.datum),
      vorher: angabeAus(v.ziel_qualitaet_vorher, v.ziel_zusatz_vorher, v.ziel_erzeugnis_vorher),
      ...(v.ziel_rebsorte_vorher !== undefined && v.ziel_rebsorte_vorher !== null ? { rebsorte: v.ziel_rebsorte_vorher } : {}),
      ...(v.ziel_jahrgang_vorher !== undefined && v.ziel_jahrgang_vorher !== null ? { jahrgang: zahlOderNull(v.ziel_jahrgang_vorher) } : {}),
    })
  }
  for (const u of g.betrieb.quellen.umzuege) {
    if (u.storniert_am || u.zeilen_typ !== 'ziel' || !u.nach_weinausbau_id || !textOderNull(u.qualitaet_vorher)) continue
    ereignis(u.nach_weinausbau_id, { datum: tag(u.datum), vorher: angabeAus(u.qualitaet_vorher, u.zusatz_vorher, u.erzeugnis_vorher) })
  }
  for (const liste of ereignisse.values()) liste.sort((a, b) => a.datum.localeCompare(b.datum))

  /** Merkmale einer Charge am Ende des Tages `datum` */
  const merkmaleCharge = (c: R, datum: string): Merkmale => {
    const ev = (ereignisse.get(c.id) ?? []).find(e => e.datum > datum)
    return {
      angabe: ev ? ev.vorher : normalisiereQualitaet(c),
      weinart: textOderNull(c.weinart),
      rebsorte: ev?.rebsorte !== undefined ? textOderNull(ev.rebsorte) : textOderNull(c.rebsorte),
      jahrgang: ev?.jahrgang !== undefined ? ev.jahrgang ?? null : zahlOderNull(c.jahrgang),
      land: textOderNull(c.land_iso),
    }
  }
  /** Merkmale einer Füllung (eigene Angaben, fehlende aus der Charge am Abfülltag) */
  const fuellungsMerkmale = new Map<string, Merkmale>()
  const merkmaleFuellung = (f: R): Merkmale => {
    const vorhanden = fuellungsMerkmale.get(f.id)
    if (vorhanden) return vorhanden
    const c = f.weinausbau_id ? chargeById.get(f.weinausbau_id) : undefined
    const ch = c ? merkmaleCharge(c, tag(f.datum)) : null
    const eigene = normalisiereQualitaet(f)
    const weinartF = textOderNull((f.weinausbau as R | null)?.weinart) ?? (f.weinart && f.weinart !== 'unbekannt' ? textOderNull(f.weinart) : null)
    const m: Merkmale = {
      angabe: eigene.stufe || eigene.erzeugnis ? eigene : (ch?.angabe ?? eigene),
      weinart: weinartF && weinartF !== 'unbekannt' ? weinartF : ch?.weinart ?? null,
      rebsorte: textOderNull(f.rebsorte) ?? ch?.rebsorte ?? null,
      jahrgang: zahlOderNull(f.jahrgang) ?? ch?.jahrgang ?? null,
      land: textOderNull(f.land_iso) ?? ch?.land ?? null,
    }
    fuellungsMerkmale.set(f.id, m)
    return m
  }
  /** Zelle aus Merkmalen; null = nicht bestandsmeldepflichtig */
  const zelle = (m: Merkmale, gebinde: Gebinde, name: string): BsmZelle | null => {
    const s = bsmSpalte(m)
    if (!s.relevant) { nichtRelevant.add(name); return null }
    if (s.ohneStufe) ohneStufe.add(name)
    const farbe = bsmFarbe(m)
    if (!farbe) ohneFarbe.add(name)
    const h = bsmHerkunft(m.land)
    if (h.unbekannt) landUnbekannt.add(name)
    return { spalte: s.spalte, farbe, herkunft: h.herkunft, gebinde }
  }
  /** Kunde im Ausland? (Land der Firma, sonst des Kontakts; unbekannt → Österreich) */
  const kunde = (verkaufspostenId: string | null | undefined): { ausland: boolean; land: string | null } => {
    const vp = verkaufspostenId ? zusatz.verkaufsposten.get(verkaufspostenId) : undefined
    const land = normalisiereLand((vp?.firma as R | null)?.land ?? (vp?.kontakt as R | null)?.land ?? null)
    if (!land) { kundeLandUnbekannt++; return { ausland: false, land: null } }
    return { ausland: land !== 'AT', land }
  }
  const bestandCharge = (chargeId: string, datum: string): number => {
    const p = chargenPosten.get(chargeId)
    return p ? bestandAmStichtag(p.heuteLiter, p.buchungen, datum, p.beginn, STELLEN.liter).bestand : 0
  }

  const buchungen: BsmBuchung[] = []
  const aufwertungen: string[] = []
  const gemischt: string[] = []

  /** Gruppe neutraler Umbuchungen: wechselt die Spalte, werden die Zeilen zu AB_ABW/ZU_ABW (R9) */
  const abwertungsAusgleich = (zeilen: BsmBuchung[], name: string): BsmBuchung[] => {
    const neutral = zeilen.filter(r => NEUTRALE_CODES.has(r.code))
    const netto = new Map<string, number>()
    for (const r of neutral) netto.set(r.spalte ?? 'ohne', l2((netto.get(r.spalte ?? 'ohne') ?? 0) + r.liter))
    const offen = [...netto].filter(([, v]) => Math.abs(v) >= NULL_UNTER)
    if (offen.length === 0) return zeilen
    if (new Set(neutral.map(r => `${r.farbe}|${r.herkunft}`)).size > 1) { gemischt.push(name); return zeilen }
    const aus = [...zeilen]
    for (const [sp, n] of offen) {
      let rest = Math.abs(n)
      const vz = Math.sign(n)
      for (const r of neutral) {
        if (rest < NULL_UNTER) break
        if ((r.spalte ?? 'ohne') !== sp || Math.sign(r.liter) !== vz) continue
        const code = vz < 0 ? 'AB_ABW' : 'ZU_ABW'
        const hinweis = [r.hinweis, 'BSM-Spalte gewechselt'].filter(Boolean).join(' · ')
        if (Math.abs(r.liter) <= rest + NULL_UNTER) {
          rest = l2(rest - Math.abs(r.liter))
          r.code = code
          r.hinweis = hinweis
        } else {
          const teil = l2(vz * rest)
          r.liter = l2(r.liter - teil)
          aus.splice(aus.indexOf(r) + 1, 0, { ...r, code, liter: teil, hinweis })
          rest = 0
        }
      }
    }
    // Aufwertung: das Ergebnis liegt in einer höheren Spalte als jede Quelle
    const rang = (wert: number) => offen.filter(([, v]) => Math.sign(v) === wert).map(([s]) => spalteRang(s === 'ohne' ? null : s as BsmSpalte)).filter((x): x is number => x !== null)
    const zu = rang(1), ab = rang(-1)
    if (zu.length > 0 && ab.length > 0 && Math.max(...zu) > Math.max(...ab)) aufwertungen.push(name)
    return aus
  }

  /** Spaltenwechsel des schon vorhandenen Weins einer Ziel-Charge (Verschnitt, Umzug in eine bestehende Charge) */
  const vorhandenerWein = (c: R, datum: string, vorher: QualitaetsAngabe, zugang: number, basis: Omit<BsmBuchung, keyof BsmZelle | 'code' | 'liter' | 'kg'>, name: string): BsmBuchung[] => {
    const mAlt: Merkmale = { ...merkmaleCharge(c, vortag(datum)), angabe: vorher }
    const mNeu = merkmaleCharge(c, datum)
    const zAlt = zelle(mAlt, 'offen', name), zNeu = zelle(mNeu, 'offen', name)
    if (!zAlt || !zNeu || zAlt.spalte === zNeu.spalte) return []
    const menge = l2(bestandCharge(c.id, datum) - zugang)
    if (menge < NULL_UNTER) return []
    if ((spalteRang(zNeu.spalte) ?? -1) > (spalteRang(zAlt.spalte) ?? 99)) aufwertungen.push(name)
    const hinweis = `vorhandener Wein der Ziel-Charge: ${spalteLabel(zAlt.spalte)} → ${spalteLabel(zNeu.spalte)}`
    return [
      { ...basis, ...zAlt, code: 'AB_ABW', liter: -menge, kg: null, hinweis },
      { ...basis, ...zNeu, code: 'ZU_ABW', liter: menge, kg: null, hinweis },
    ]
  }

  // ── 1. Keller-Bewegungen (offen) ──
  type Gruppe = { zeilen: BsmBuchung[]; storniert: boolean; name: string; datum: string }
  const umzugGruppen = new Map<string, Gruppe & { quelle: BsmBuchung[]; ein: { b: Bewegung; u: R | undefined }[] }>()
  const fuellGruppen = new Map<string, Gruppe>()
  const gruppe = <T extends Gruppe>(m: Map<string, T>, key: string, neu: () => T): T => {
    let x = m.get(key)
    if (!x) { x = neu(); m.set(key, x) }
    return x
  }

  for (const b of g.betrieb.bewegungen) {
    if (!b.chargeId || b.menge === 0 || !imZeitraum(b.datum)) continue
    const c = chargeById.get(b.chargeId)
    if (!c) continue
    const name = b.charge ?? textOderNull(c.name) ?? 'ohne Bezeichnung'
    const zl = zelle(merkmaleCharge(c, b.datum), 'offen', name)
    if (!zl) continue
    const basis = {
      datum: b.datum, vorgang: b.beschreibung, charge: b.charge, fuellung: null as string | null, gegenstelle: b.gegenstelle,
      beleg: b.beleg, storno: stornoText(b), hinweis: b.extra ?? null,
    }
    const zeile = (code: string, liter = b.menge, extra: Partial<BsmBuchung> = {}): BsmBuchung => ({ ...basis, ...zl, code, liter, kg: null, ...extra })
    const istStornoPaar = !!(b.storno || b.gegenbuchungZu)

    if (b.art === 'umzug_ein' || b.art === 'umzug_aus' || b.art === 'filtration_ein' || b.art === 'filtration_aus') {
      const u = b.quelleId ? umzugById.get(b.quelleId) : undefined
      const key = `${u?.umzug_batch_id ?? b.quelleId ?? b.datum}|${b.gegenbuchungZu ? 'S' : 'B'}`
      const gr = gruppe(umzugGruppen, key, () => ({ zeilen: [], storniert: false, name: b.beschreibung, datum: b.datum, quelle: [], ein: [] }))
      gr.storniert ||= istStornoPaar
      const r = zeile(buchungsartBewegung(b.art)!)
      gr.zeilen.push(r)
      if (b.art.endsWith('_ein')) gr.ein.push({ b, u })
      else gr.quelle.push(r)
      continue
    }
    if (b.art === 'abfuellung') {
      const p = b.fuellung_id ? fuellungsPosten.get(b.fuellung_id) : undefined
      const key = `${b.fuellung_id ?? b.quelleId}|${b.gegenbuchungZu ? 'S' : 'B'}`
      const gr = gruppe(fuellGruppen, key, () => ({ zeilen: [], storniert: false, name: b.beschreibung, datum: b.datum }))
      gr.storniert ||= istStornoPaar
      const tank = Math.abs(b.menge)
      const flasche = p ? l2((Math.trunc(zahlOderNull(p.f.anzahl_flaschen) ?? 0) * p.ml) / 1000) : tank
      const verlust = l2(tank - flasche)
      const vz = Math.sign(b.menge)
      const fuellung = textOderNull(p?.f.name) ?? b.gegenstelle
      if (flasche > 0 && verlust >= NULL_UNTER) {
        gr.zeilen.push(zeile('FUELLUNG', vz * flasche, { fuellung }))
        gr.zeilen.push(zeile('SCHWUND', vz * verlust, { fuellung, hinweis: 'Füllverlust (Tankabgang − Flascheninhalt)' }))
      } else {
        gr.zeilen.push(zeile('FUELLUNG', b.menge, { fuellung }))
        if (verlust <= -NULL_UNTER) warnungen.push(`Füllung „${fuellung ?? '?'}“ (${datumAT(b.datum)}): Flascheninhalt ${fmtL(flasche)} größer als der Tankabgang ${fmtL(tank)} – Differenz bleibt als Umbuchung stehen.`)
      }
      continue
    }
    let code = buchungsartBewegung(b.art)
    if (b.art === 'zukauf') code = buchungsartBewegung('zukauf', { zukaufArt: b.quelleId ? zukaufById.get(b.quelleId)?.art : null })
    if (b.art === 'verkauf') {
      const vpos = b.quelleId ? verkaufById.get(b.quelleId) : undefined
      const k = kunde(vpos?.verkaufsposten_id)
      code = buchungsartBewegung('verkauf', { kundeAusland: k.ausland })
      if (k.land) basis.gegenstelle = [b.gegenstelle, landAnzeige(k.land)].filter(Boolean).join(' · ')
    }
    if (!code) continue
    buchungen.push(zeile(code))
    // Verschnitt: Spaltenwechsel des vorhandenen Weins der Ziel-Charge
    if (b.art === 'verschneidung_ein' && !istStornoPaar && b.quelleId) {
      const v = verschnittById.get(b.quelleId)
      if (v && textOderNull(v.ziel_qualitaet_vorher)) {
        buchungen.push(...vorhandenerWein(c, b.datum, angabeAus(v.ziel_qualitaet_vorher, v.ziel_zusatz_vorher, v.ziel_erzeugnis_vorher), Math.abs(b.menge), basis, `${b.beschreibung} (${datumAT(b.datum)})`))
      }
    }
  }

  // Umzug/Filtration: Schwund (Abgang − Zugang) aus den Abgangszeilen, Spaltenwechsel → Abwertung
  for (const gr of umzugGruppen.values()) {
    // Abgangszeilen = Zeilen der Quell-Charge(n) (beim Original negativ, bei der Gegenbuchung positiv)
    const quelle = gr.quelle
    const ziel = gr.zeilen.filter(r => !quelle.includes(r))
    const A = l2(quelle.reduce((s, r) => s + Math.abs(r.liter), 0))
    const E = l2(ziel.reduce((s, r) => s + Math.abs(r.liter), 0))
    const schwund = l2(A - E)
    const zeilen = [...quelle, ...ziel]   // Abgang vor Zugang (Kontrolljournal)
    if (schwund >= NULL_UNTER && A > 0 && ziel.length > 0) {
      let verteilt = 0
      quelle.forEach((r, i) => {
        const anteil = i === quelle.length - 1 ? l2(schwund - verteilt) : l2(schwund * Math.abs(r.liter) / A)
        verteilt = l2(verteilt + anteil)
        if (anteil < NULL_UNTER) return
        const vz = Math.sign(r.liter)
        r.liter = l2(r.liter - vz * anteil)
        zeilen.splice(zeilen.indexOf(r) + 1, 0, { ...r, code: 'SCHWUND', liter: vz * anteil, hinweis: [r.hinweis, `Schwund beim ${r.code === 'FILTRAT' ? 'Filtrieren' : 'Umziehen'}`].filter(Boolean).join(' · ') })
      })
    } else if (schwund <= -NULL_UNTER && quelle.length > 0) {
      warnungen.push(`${gr.name} (${datumAT(gr.datum)}): Zugang ${fmtL(E)} größer als Abgang ${fmtL(A)} – Differenz bleibt als Umbuchung stehen.`)
    }
    let ergebnis = gr.storniert ? zeilen : abwertungsAusgleich(zeilen, `${gr.name} (${datumAT(gr.datum)})`)
    // Umzug in eine bestehende Charge: deren vorhandener Wein wechselt ggf. die Spalte (Momentaufnahme an der Zielzeile)
    if (!gr.storniert) {
      for (const { b, u } of gr.ein) {
        if (!u || !textOderNull(u.qualitaet_vorher) || !b.chargeId) continue
        const c = chargeById.get(b.chargeId)
        if (!c) continue
        const basis = { datum: b.datum, vorgang: b.beschreibung, charge: b.charge, fuellung: null, gegenstelle: b.gegenstelle, beleg: b.beleg, storno: null, hinweis: null }
        ergebnis = [...ergebnis, ...vorhandenerWein(c, b.datum, angabeAus(u.qualitaet_vorher, u.zusatz_vorher, u.erzeugnis_vorher), Math.abs(b.menge), basis, `${gr.name} (${datumAT(gr.datum)})`)]
      }
    }
    buchungen.push(...ergebnis)
  }

  // ── 2. Flaschen ──
  for (const p of g.fuellungen) {
    const f = p.f
    const name = textOderNull(f.name) ?? 'ohne Bezeichnung'
    const eroeffnung = istFlaschenEroeffnung(f)
    for (const fb of p.buchungen) {
      if (!imZeitraum(fb.datum) || fb.menge === 0) continue
      const zl = zelle(merkmaleFuellung(f), 'flasche', name)
      if (!zl) continue
      const liter = l2((fb.menge * p.ml) / 1000)
      const istVerkauf = fb.art.startsWith('verkauf')
      const k = istVerkauf ? kunde(fb.verkaufspostenId) : { ausland: false, land: null }
      const code = buchungsartFlasche(fb.art, fb.menge, { kundeAusland: k.ausland, mitCharge: !!f.weinausbau_id, eroeffnung })
      const vp = fb.verkaufspostenId ? zusatz.verkaufsposten.get(fb.verkaufspostenId) : undefined
      const kunde_ = textOderNull((vp?.firma as R | null)?.name) ?? textOderNull([(vp?.kontakt as R | null)?.vorname, (vp?.kontakt as R | null)?.nachname].filter(Boolean).join(' '))
      const zeile: BsmBuchung = {
        ...zl, datum: fb.datum, code, liter, kg: null,
        vorgang: FLASCHEN_VORGANG[fb.art] ?? `Flaschenbuchung (${fb.art})`,
        charge: f.weinausbau_id ? textOderNull(chargeById.get(f.weinausbau_id)?.name) : null,
        fuellung: name,
        gegenstelle: istVerkauf ? [kunde_, k.land ? landAnzeige(k.land) : null].filter(Boolean).join(' · ') || null : null,
        beleg: istVerkauf ? textOderNull(vp?.rechnungsnummer) : textOderNull(f.pruefnummer) ?? textOderNull(f.chargennummer),
        storno: fb.art === 'verkauf_storno' || fb.art === 'verkauf_alt_storno' || fb.art === 'storno_fuellung' ? 'Gegenbuchung (Storno)' : null,
        hinweis: `${fmtNum(Math.abs(fb.menge), 0)} Fl. à ${p.ml} ml${p.mlErfasst ? '' : ' (angenommen)'}${code === 'ZK_FLA' ? ' · Füllung ohne Charge – als Flaschenzukauf gezählt, prüfen' : ''}`,
      }
      if (code === 'FUELLUNG') {
        const key = `${f.id}|${fb.art === 'storno_fuellung' ? 'S' : 'B'}`
        const gr = gruppe(fuellGruppen, key, () => ({ zeilen: [], storniert: false, name: `Abfüllung: ${name}`, datum: fb.datum }))
        gr.storniert ||= fb.art === 'storno_fuellung' || !!f.storniert_am
        gr.zeilen.push(zeile)
      } else {
        buchungen.push(zeile)
      }
    }
  }
  for (const gr of fuellGruppen.values()) buchungen.push(...(gr.storniert ? gr.zeilen : abwertungsAusgleich(gr.zeilen, `${gr.name} (${datumAT(gr.datum)})`)))

  // ── 3. Zukauf Trauben (kg, nicht in der Literrechnung) ──
  let traubenKg = 0
  for (const t of zusatz.traubenZukauf) {
    const d = tag(t.datum)
    if (!imZeitraum(d)) continue
    const kg = zahlOderNull(t.menge) ?? 0
    if (kg <= 0) continue
    const name = `Zukauf Trauben ${[textOderNull(t.rebsorte), zahlOderNull(t.jahrgang)].filter(Boolean).join(' ')}`.trim()
    const zl = zelle({ angabe: normalisiereQualitaet(t), weinart: textOderNull(t.weinart), rebsorte: textOderNull(t.rebsorte), jahrgang: zahlOderNull(t.jahrgang), land: textOderNull(t.land_iso) }, 'offen', name)
    if (!zl) continue
    traubenKg = runden(traubenKg + kg, STELLEN.kgGenau)
    const lf = momentaufnahmeAnwenden({ ...t }, ['lieferant_firma', 'lieferant_kontakt'])
    buchungen.push({
      ...zl, datum: d, code: 'ZK_TRAUB', liter: 0, kg,
      vorgang: name, charge: null, fuellung: null,
      gegenstelle: textOderNull((lf.lieferant_firma as R | null)?.name) ?? textOderNull([(lf.lieferant_kontakt as R | null)?.vorname, (lf.lieferant_kontakt as R | null)?.nachname].filter(Boolean).join(' ')),
      beleg: textOderNull(t.eingangsrechnungsnummer), storno: null,
      hinweis: `Menge in ${textOderNull(t.einheit) ?? 'kg'} – nicht in Liter umgerechnet; die Pressung erscheint als eigene Ernte`,
    })
  }

  // Kontrolljournal: nach Datum, innerhalb eines Tages in Entstehungsreihenfolge
  buchungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // ── 4. Anfangs- und Stichtagsbestand ──
  type BestandsZelle = BsmZelle & { liter: number }
  const negativ: string[] = []
  const bestandZellen = (stichtag: string): BestandsZelle[] => {
    const je = bestandJePosten(g, stichtag)
    const aus: BestandsZelle[] = []
    for (const { p: { c }, r } of je.chargen) {
      const name = textOderNull(c.name) ?? 'ohne Bezeichnung'
      if (istNegativ(r.bestand)) { negativ.push(`${name} am ${datumAT(stichtag)} (${fmtL(r.bestand)})`); continue }
      if (r.bestand < NULL_UNTER) continue
      const zl = zelle(merkmaleCharge(c, stichtag), 'offen', name)
      if (zl) aus.push({ ...zl, liter: r.bestand })
    }
    for (const { p, r } of je.fuellungen) {
      const name = textOderNull(p.f.name) ?? 'ohne Bezeichnung'
      if (r.bestand < 0) { negativ.push(`${name} am ${datumAT(stichtag)} (${r.bestand} Fl.)`); continue }
      if (r.bestand === 0) continue
      const zl = zelle(merkmaleFuellung(p.f), 'flasche', name)
      if (zl) aus.push({ ...zl, liter: l2((r.bestand * p.ml) / 1000) })
    }
    return aus
  }
  const anfang = bestandZellen(anfangAm)
  const stichtag = bestandZellen(z.bis)

  // ── 5. Aggregation je Position × Zelle ──
  const zellSchluessel = (x: BsmZelle) => `${x.herkunft}|${x.gebinde}|${x.spalte ?? 'ohne'}|${x.farbe ?? '-'}`
  const positionen = new Map<string, Map<string, number>>()
  const addiere = (pos: string, x: BsmZelle, liter: number) => {
    const m = positionen.get(pos) ?? new Map<string, number>()
    const k = zellSchluessel(x)
    m.set(k, l2((m.get(k) ?? 0) + liter))
    positionen.set(pos, m)
  }
  for (const x of anfang) addiere('ANFANG', x, x.liter)
  for (const r of buchungen) {
    const pos = r.code === 'EROEFF' ? 'ANFANG' : NEUTRALE_CODES.has(r.code) ? 'NEUTRAL' : r.code
    addiere(pos, r, r.liter)
  }
  for (const x of stichtag) addiere('STICHTAG', x, x.liter)
  // Endbestand lt. Rechnung = Anfang + alle Buchungen (Vorzeichen); Differenz = Stichtag − Rechnung
  const alleZellen = new Set<string>()
  for (const m of positionen.values()) for (const k of m.keys()) alleZellen.add(k)
  const ende = new Map<string, number>()
  for (const [pos, m] of positionen) {
    if (pos === 'STICHTAG') continue
    for (const [k, v] of m) ende.set(k, l2((ende.get(k) ?? 0) + v))
  }
  positionen.set('ENDE', ende)
  const diff = new Map<string, number>()
  for (const k of alleZellen) {
    const d = l2((positionen.get('STICHTAG')?.get(k) ?? 0) - (ende.get(k) ?? 0))
    if (Math.abs(d) >= NULL_UNTER) diff.set(k, d)
  }
  positionen.set('DIFFERENZ', diff)

  const teileVon = (k: string) => {
    const [herkunft, gebinde, spalte, farbe] = k.split('|')
    return { herkunft: herkunft as Herkunft, gebinde: gebinde as Gebinde, spalte: spalte as SpalteSchluessel, farbe: farbe === '-' ? null : farbe as MeldeFarbe }
  }
  const nutztOhne = [...alleZellen].some(k => teileVon(k).spalte === 'ohne')
  const spalten: SpalteSchluessel[] = [...BSM_SPALTEN.map(s => s.key), ...(nutztOhne ? ['ohne' as const] : [])]
  const herkuenfte: Herkunft[] = (['AT', 'EU', 'DRITT'] as const).filter(h => h === 'AT' || [...alleZellen].some(k => teileVon(k).herkunft === h))

  const summen: BsmSummenZeile[] = []
  const leereWerte = (): Record<SpalteSchluessel, number> => ({ wein: 0, rebsortenwein: 0, landwein: 0, qualitaetswein: 0, praedikatswein: 0, perl_schaumwein: 0, sonstige: 0, ohne: 0 })
  const zeileFuer = (h: Herkunft, pos: string, bezeichnung: string, abschnitt: BsmSummenZeile['abschnitt'], teil: string, filter: (t: ReturnType<typeof teileVon>) => boolean, vorzeichen: 1 | -1): BsmSummenZeile => {
    const werte = leereWerte()
    for (const [k, v] of positionen.get(pos) ?? []) {
      const t = teileVon(k)
      if (t.herkunft !== h || !filter(t)) continue
      werte[t.spalte] = l2(werte[t.spalte] + vorzeichen * v)
    }
    const summeLiter = l2(Object.values(werte).reduce((s, v) => s + v, 0))
    return { von: z.von, bis: z.bis, herkunft: h, position: pos, bezeichnung, abschnitt, teil, werte, summeLiter, summeHl: runden(summeLiter / 100, HL_STELLEN_BSM) }
  }
  const hatWert = (zl: BsmSummenZeile) => Object.values(zl.werte).some(v => Math.abs(v) >= NULL_UNTER)
  const BESTAND_TEILE: [string, (t: ReturnType<typeof teileVon>) => boolean][] = [
    ['gesamt', () => true],
    ['davon offen (Fass/Tank)', t => t.gebinde === 'offen'],
    ['davon Flasche', t => t.gebinde === 'flasche'],
    ['davon weiß', t => t.farbe === 'W'],
    ['davon rot (inkl. Rosé)', t => t.farbe === 'R'],
    ['davon ohne Farbe', t => t.farbe === null],
  ]
  const FARB_TEILE = BESTAND_TEILE.filter(([t]) => t === 'gesamt' || t.startsWith('davon weiß') || t.startsWith('davon rot') || t === 'davon ohne Farbe')
  const ZUGANG = KAT_BUCHUNGSART.filter(b => b.bsm && b.richtung === 'zu').map(b => b.code)
  const ABGANG = KAT_BUCHUNGSART.filter(b => b.bsm && b.richtung === 'ab').map(b => b.code)
  for (const h of herkuenfte) {
    const block = (pos: string, bez: string, abschnitt: BsmSummenZeile['abschnitt'], teile: typeof BESTAND_TEILE, vz: 1 | -1, immer: boolean) => {
      const gesamt = zeileFuer(h, pos, bez, abschnitt, 'gesamt', () => true, vz)
      if (!immer && !hatWert(gesamt)) return
      summen.push(gesamt)
      for (const [teil, filter] of teile.slice(1)) {
        const zl = zeileFuer(h, pos, bez, abschnitt, teil, filter, vz)
        // „davon weiß/rot“ immer bei Beständen (R17), sonst nur mit Menge; „ohne Farbe“ nur mit Menge
        if (hatWert(zl) || (immer && teil !== 'davon ohne Farbe')) summen.push(zl)
      }
    }
    block('ANFANG', `Anfangsbestand (Ende ${datumAT(anfangAm)}, inkl. Eröffnungsbestand im Zeitraum)`, 'Bestand', BESTAND_TEILE, 1, true)
    for (const code of ZUGANG) {
      const gesamt = zeileFuer(h, code, buchungsartLabel(code), 'Zugang', 'gesamt', () => true, 1)
      summen.push(code === 'ZK_TRAUB' && traubenKg > 0 ? { ...gesamt, bezeichnung: `${gesamt.bezeichnung} (${fmtNum(traubenKg, 0)} kg, nicht umgerechnet)` } : gesamt)
      if (hatWert(gesamt)) for (const [teil, filter] of FARB_TEILE.slice(1)) { const zl = zeileFuer(h, code, buchungsartLabel(code), 'Zugang', teil, filter, 1); if (hatWert(zl) || teil !== 'davon ohne Farbe') summen.push(zl) }
    }
    block('INV_PLUS', 'Inventur-Mehrmenge (keine BSM-Buchungsart)', 'Zugang', FARB_TEILE, 1, false)
    for (const code of ABGANG) {
      const gesamt = zeileFuer(h, code, buchungsartLabel(code), 'Abgang', 'gesamt', () => true, -1)
      summen.push(gesamt)
      if (hatWert(gesamt)) for (const [teil, filter] of FARB_TEILE.slice(1)) { const zl = zeileFuer(h, code, buchungsartLabel(code), 'Abgang', teil, filter, -1); if (hatWert(zl) || teil !== 'davon ohne Farbe') summen.push(zl) }
    }
    block('NEUTRAL', 'Umbuchungen ohne BSM-Buchungsart (Umzug, Filtration, Füllung) – Saldo', 'Prüfung', BESTAND_TEILE, 1, false)
    block('ENDE', `Endbestand lt. Rechnung (${datumAT(z.bis)})`, 'Bestand', BESTAND_TEILE, 1, true)
    block('STICHTAG', `Bestand zum Stichtag ${datumAT(z.bis)} (Bestandsermittlung)`, 'Bestand', BESTAND_TEILE, 1, true)
    block('DIFFERENZ', 'Differenz Stichtag − Rechnung', 'Prüfung', BESTAND_TEILE, 1, true)
  }

  // ── 6. Plausibilität ──
  if (!istWeinwirtschaftsjahr(z)) {
    warnungen.unshift(`Zeitraum ${datumAT(z.von)} – ${datumAT(z.bis)} ist kein Weinwirtschaftsjahr (1.8.–31.7.) – Auswertung, keine Bestandsmeldung nach § 29 Weingesetz 2009.`)
  }
  const summeCode = (code: string) => l2(buchungen.filter(r => r.code === code).reduce((s, r) => s + r.liter, 0))
  const zuAbw = summeCode('ZU_ABW'), abAbw = l2(-summeCode('AB_ABW'))
  if (Math.abs(zuAbw - abAbw) >= NULL_UNTER) warnungen.push(`Zugang Abwertung (${fmtL(zuAbw)}) und Abgang Abwertung (${fmtL(abAbw)}) sind nicht gleich – Kontrolljournal (Filter ZU_ABW, AB_ABW) prüfen.`)
  if (aufwertungen.length > 0) warnungen.push(`${anzahl(new Set(aufwertungen).size, 'Vorgang führt', 'Vorgänge führen')} Wein in eine höhere BSM-Spalte (Aufwertung ist nicht zulässig) – gebucht als Abwertungspaar, bitte prüfen: ${auszug(aufwertungen)}.`)
  if (gemischt.length > 0) warnungen.push(`${anzahl(new Set(gemischt).size, 'Umbuchung wechselt', 'Umbuchungen wechseln')} Farbe oder Herkunft – kein Abwertungspaar gebucht, der Rest steht unter „Umbuchungen ohne BSM-Buchungsart“: ${auszug(gemischt)}.`)
  const neutralRest = [...(positionen.get('NEUTRAL') ?? [])].filter(([, v]) => Math.abs(v) >= NULL_UNTER)
  // Füllung offen → Flasche bei gleicher Spalte ist gewollt (offen −, Flasche +); geprüft wird der Saldo je Spalte ohne Gebinde
  const neutralJeSpalte = new Map<string, number>()
  for (const [k, v] of neutralRest) { const t = teileVon(k); const s = `${t.herkunft}|${t.spalte}|${t.farbe}`; neutralJeSpalte.set(s, l2((neutralJeSpalte.get(s) ?? 0) + v)) }
  const neutralOffen = [...neutralJeSpalte].filter(([, v]) => Math.abs(v) >= NULL_UNTER)
  if (neutralOffen.length > 0) warnungen.push(`Umbuchungen (Umzug, Filtration, Füllung) gleichen sich in ${anzahl(neutralOffen.length, 'Spalte', 'Spalten')} nicht aus (z. B. Storno über die Zeitraumgrenze, Farb- oder Herkunftswechsel): ${neutralOffen.map(([k, v]) => `${zellText(k)} ${fmtL(v)}`).join('; ')}.`)
  const invPlus = summeCode('INV_PLUS')
  if (invPlus >= NULL_UNTER) warnungen.push(`Inventur-Mehrmengen bzw. Korrekturen (+) von ${fmtL(invPlus)} haben keine BSM-Buchungsart – im Kontrolljournal (Filter INV_PLUS) prüfen.`)
  const zkFla = buchungen.filter(r => r.code === 'ZK_FLA').length
  if (zkFla > 0) warnungen.push(`${anzahl(zkFla, 'Flaschenzugang', 'Flaschenzugänge')} ohne Charge (weder Abfüllung aus dem Keller noch Eröffnungsbestand) als „Zukauf Flaschen“ gezählt – bitte prüfen.`)
  if (traubenKg > 0) warnungen.push(`Zukauf Trauben ${fmtNum(traubenKg, 0)} kg: Umrechnung kg → l ist offen (KAN-43) – nur nachrichtlich ausgewiesen; der Most aus der Pressung zählt unter „eigene Ernte“.`)
  const eroeff = summeCode('EROEFF')
  if (Math.abs(eroeff) >= NULL_UNTER) warnungen.push(`Eröffnungsbestand mit Stichtag im Zeitraum (${fmtL(eroeff)}) ist im Anfangsbestand enthalten.`)
  const eroeffMinus = buchungen.filter(r => r.code === 'EROEFF' && r.liter < 0)
  if (eroeffMinus.length > 0) warnungen.push(`${anzahl(eroeffMinus.length, 'Anfangsbestands-Buchung ist', 'Anfangsbestands-Buchungen sind')} negativ (z. B. Flaschen „Anfangsbestand (Altbestand, ±)“ nach der Abfüllung, zusammen ${fmtL(l2(eroeffMinus.reduce((s, r) => s + r.liter, 0)))}) und ${eroeffMinus.length === 1 ? 'mindert' : 'mindern'} den Anfangsbestand – prüfen, ob es Verkäufe oder Schwund waren: ${auszug(eroeffMinus.map(r => r.fuellung ?? r.charge ?? r.vorgang))}.`)
  for (const [k, d] of diff) warnungen.push(`Abgleich: ${zellText(k)} – Bestand zum ${datumAT(z.bis)} weicht um ${fmtL(d)} von der Rechnung ab (Bestand ohne Buchung, negativer Posten oder Merkmalswechsel ohne Buchung).`)
  for (const [k, v] of ende) if (v <= -NULL_UNTER) warnungen.push(`Negativer Endbestand lt. Rechnung: ${zellText(k)} ${fmtL(v)}.`)
  if (negativ.length > 0) warnungen.push(`${anzahl(negativ.length, 'Posten ergibt', 'Posten ergeben')} einen negativen Bestand und ${negativ.length === 1 ? 'ist' : 'sind'} im Anfangs- bzw. Stichtagsbestand nicht enthalten: ${auszug(negativ)}.`)
  if (ohneStufe.size > 0) warnungen.push(`${anzahl(ohneStufe.size, 'Wein', 'Weine')} ohne Qualitätsstufe – als Wein bzw. Rebsortenwein gezählt: ${auszug([...ohneStufe])}.`)
  if (ohneFarbe.size > 0) warnungen.push(`${anzahl(ohneFarbe.size, 'Wein', 'Weine')} ohne bestimmbare Farbe (weder Weinart noch eindeutige Rebsorte) – Zeile „davon ohne Farbe“: ${auszug([...ohneFarbe])}.`)
  if (landUnbekannt.size > 0) warnungen.push(`${anzahl(landUnbekannt.size, 'Wein', 'Weine')} ohne Ursprungsland – als Österreich gezählt: ${auszug([...landUnbekannt])}.`)
  if (kundeLandUnbekannt > 0) warnungen.push(`${anzahl(kundeLandUnbekannt, 'Verkauf', 'Verkäufe')} ohne Land beim Kunden – als Verkauf in Österreich gezählt.`)
  if (nichtRelevant.size > 0) warnungen.push(`${anzahl(nichtRelevant.size, 'Posten', 'Posten')} nicht bestandsmeldepflichtig (Traubensaft) – nicht enthalten: ${auszug([...nichtRelevant])}.`)
  if (g.ohneDatum > 0) warnungen.push(`${anzahl(g.ohneDatum, 'Kellerbuchung hat', 'Kellerbuchungen haben')} kein Datum – sie zählen zum Anfangsbestand.`)
  if (g.deaktiviertOhneDatum > 0) warnungen.push(`${anzahl(g.deaktiviertOhneDatum, 'deaktivierte Füllung', 'deaktivierte Füllungen')} mit Restbestand ohne Storno-Datum – nicht enthalten.`)
  warnungen.push(`Gliederung zum Buchungszeitpunkt: Qualitätsstufe aus den Momentaufnahmen von Verschnitt und Umzug, sonst die heutige; Farbe, Rebsorte, Jahrgang und Ursprungsland sind die heutigen Stammdaten (ohne Bewegungsjournal). Bestände sind aus dem heutigen Bestand zurückgerechnet (Stand ${datumAT(heute)}).`)

  return {
    zeitraum: z, anfangAm, heute, istWeinwirtschaftsjahr: istWeinwirtschaftsjahr(z),
    buchungen, summen, herkuenfte, spalten, traubenKg, warnungen,
  }
}

const FLASCHEN_VORGANG: Record<string, string> = {
  abfuellung: 'Abfüllung (Zugang Flaschenlager)',
  storno_fuellung: 'Storno der Füllung (Restbestand ab)',
  verkauf: 'Flaschenverkauf',
  verkauf_storno: 'Flaschenverkauf storniert (Rückbuchung)',
  verkauf_alt: 'Flaschenverkauf',
  verkauf_alt_storno: 'Flaschenverkauf storniert (Rückbuchung)',
  bruch: 'Bruch',
  eigenverbrauch: 'Eigenverbrauch / Verkostung',
  schwund: 'Schwund / Fehlmenge',
  inventur: 'Inventur (Differenz)',
  korrektur: 'Korrektur',
  anfangsbestand: 'Anfangsbestand (Altbestand)',
}

/** „Österreich · Qualitätswein · weiß · offen“ aus einem Zellschlüssel */
function zellText(k: string): string {
  const [h, gb, sp, fa] = k.split('|')
  return [
    HERKUNFT_LABEL[h as Herkunft] ?? h,
    sp === 'ohne' ? SPALTE_OHNE_LABEL : spalteLabel(sp as BsmSpalte),
    fa === 'W' || fa === 'R' ? FARBE_LABEL_BSM[fa] : fa === '-' ? 'ohne Farbe' : null,
    gb ? GEBINDE_LABEL[gb as Gebinde] ?? null : null,
  ].filter(Boolean).join(' · ')
}

// ── Kontrolljournal ───────────────────────────────────────────────────────────────────────────────────

export type BsmJournalZeile = {
  datum: string
  code: string
  buchungsart: string
  spalte: string
  farbe: string | null
  herkunft: string
  gebinde: string
  zugang: number | null
  abgang: number | null
  hl: number
  kg: number | null
  vorgang: string
  charge: string | null
  fuellung: string | null
  gegenstelle: string | null
  beleg: string | null
  storno: string | null
  hinweis: string | null
}

/** Journalzeilen, optional gefiltert auf Buchungsarten (Kürzel) */
export function bsmJournal(d: Pick<BsmDaten, 'buchungen'>, arten: readonly string[] = []): BsmJournalZeile[] {
  const filter = new Set(arten)
  return d.buchungen
    .filter(b => filter.size === 0 || filter.has(b.code))
    .map(b => ({
      datum: b.datum,
      code: b.code,
      buchungsart: buchungsartLabel(b.code),
      spalte: spalteLabel(b.spalte),
      farbe: b.farbe ? FARBE_LABEL_BSM[b.farbe] : null,
      herkunft: HERKUNFT_LABEL[b.herkunft],
      gebinde: GEBINDE_LABEL[b.gebinde],
      zugang: b.liter > 0 ? b.liter : null,
      abgang: b.liter < 0 ? l2(-b.liter) : null,
      hl: runden(b.liter / 100, HL_STELLEN_BSM),
      kg: b.kg,
      vorgang: b.vorgang,
      charge: b.charge,
      fuellung: b.fuellung,
      gegenstelle: b.gegenstelle,
      beleg: b.beleg,
      storno: b.storno,
      hinweis: b.hinweis,
    }))
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────────

export const SPALTEN_BSM: CsvSpalte<BsmSummenZeile>[] = [
  { kopf: 'Zeitraum von', typ: 'datum', wert: z => z.von },
  { kopf: 'Zeitraum bis', typ: 'datum', wert: z => z.bis },
  { kopf: 'Herkunft', typ: 'text', wert: z => HERKUNFT_LABEL[z.herkunft] },
  { kopf: 'Abschnitt', typ: 'text', wert: z => z.abschnitt },
  { kopf: 'Kürzel', typ: 'code', wert: z => z.position },
  { kopf: 'Position', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Teil', typ: 'text', wert: z => z.teil },
  ...BSM_SPALTEN.map((s): CsvSpalte<BsmSummenZeile> => ({ kopf: `${s.label} (l)`, typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.werte[s.key] })),
  { kopf: `${SPALTE_OHNE_LABEL} (l)`, typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.werte.ohne },
  { kopf: 'Summe (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.summeLiter },
  { kopf: 'Summe (hl)', typ: 'dezimal', stellen: HL_STELLEN_BSM, wert: z => z.summeHl },
]

export const SPALTEN_BSM_JOURNAL: CsvSpalte<BsmJournalZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Kürzel', typ: 'code', wert: z => z.code },
  { kopf: 'Buchungsart', typ: 'text', wert: z => z.buchungsart },
  { kopf: 'BSM-Spalte', typ: 'text', wert: z => z.spalte },
  { kopf: 'Farbe', typ: 'text', wert: z => z.farbe },
  { kopf: 'Herkunft', typ: 'text', wert: z => z.herkunft },
  { kopf: 'offen/Flasche', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Zugang (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.zugang },
  { kopf: 'Abgang (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.abgang },
  { kopf: 'Menge (hl)', typ: 'dezimal', stellen: HL_STELLEN_BSM, wert: z => z.hl },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.kg },
  { kopf: 'Vorgang', typ: 'text', wert: z => z.vorgang },
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Füllung', typ: 'text', wert: z => z.fuellung },
  { kopf: 'Gegenstelle', typ: 'text', wert: z => z.gegenstelle },
  { kopf: 'Beleg', typ: 'code', wert: z => z.beleg },
  { kopf: 'Storno', typ: 'text', wert: z => z.storno },
  { kopf: 'Hinweis', typ: 'text', wert: z => z.hinweis },
]
