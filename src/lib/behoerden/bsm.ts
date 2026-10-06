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
// KAN-40 Etappe E2 (03.10.2026): Ist das Bewegungsjournal (tenant_einstellungen.journal_ab) spätestens am Zeitraumende
// eröffnet, rechnet ladeBsm() aus kellerbuch_buchungen (berechneBsmAusJournal): Zellen aus den Merkmalen der Journalzeile
// zum Buchungszeitpunkt (inkl. Status der Charge für Most/Sturm), Bestände als Summe der Zeilen, gemeinsamer Abschluss
// (bsmAbschliessen). Die Rekonstruktion unten bleibt für Zeiträume vor dem Journal (Pilot 2026) und Betriebe ohne Journal.
//
// Druckseite (/reports/bestandsmeldung-bsm) und CSV (Register „bsm“, „bsm-kontrolljournal“) nutzen ladeBsm();
// Mengen in Liter (2 Stellen), je Zeile zusätzlich hl (3 Stellen). Die Summen addieren die gerundeten Zeilenwerte.
// Weindatenbank-Format (Wein-ONLINE) ist nicht spezifiziert – Standardprofil EXCEL_AT (vorerst so, Jörgen 02.10.2026).
//
// Nachtrag (Antworten Jörgen 02.10.2026):
//  1. Zukauf Trauben: Pressungen mischen eigene und zugekaufte Trauben (pressung_weingaerten.zukauf_posten_id). Der
//     Most einer Pressung wird anteilig nach Trauben-kg auf ERNTE (eigene) und ZK_TRAUB (zugekaufte, in Liter = tatsächlich
//     gepresste Menge) aufgeteilt. Der Zukauf-Beleg selbst (kg) zählt NICHT in der Literrechnung (sonst doppelt) – er
//     steht im Kontrolljournal als Info-Zeile in kg mit Vorschlag TRAUBEN_LITER_JE_KG_VORSCHLAG; bis zum Zeitraumende
//     nicht gepresste Trauben ergeben nur einen Hinweis.
//  2. Kabinett bleibt vorläufig in der Spalte Qualitätswein (bestätigt Jörgen 02.10.2026, bis BKI-Antwort KAN-38 Frage 12).
//  3. Rosé zählt zu rot – auch in den BSM-Spalten (bestätigt Jörgen 02.10.2026; bsmFarbe über katalog_mapping farbe).
//  4. Most und Sturm: eigene Gliederungsgruppe „Most/Sturm“ neben den Weinspalten (istMostSturm). Der Übergang
//     Most → Wein ist ein neutraler Spaltenwechsel (UMST_MOST, keine Abwertung), damit die Summen stimmen.
//  5. Inland/Ausland bei Verkäufen nach Lieferort: Lieferland des Verkaufs (verkaufsposten.lieferland, sobald die Spalte
//     existiert) → Bestimmungsland eines Exportauftrags (gleicher Kunde, gleicher Tag) → Land des Kunden (Warnung).
//  6. Format Wein-ONLINE: vorerst Excel-CSV.
//  7. Negative Flaschen-„Anfangsbestand (Altbestand, ±)“-Buchungen sind ein Abgang (SCHWUND), keine Eröffnung.

import { STELLEN, runden, wienHeute, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { KAT_BUCHUNGSART, KAT_ERZEUGNIS, katalogQualitaet, meldeFarbe, type BsmSpalte, type MeldeFarbe } from '@/lib/katalog/bki'
import { istEuLand, landAnzeige, normalisiereLand } from '@/lib/katalog/laender'
import { normalisiereQualitaet, type QualitaetsAngabe } from '@/lib/wein/qualitaetsrang'
import { bkiFarbe } from '@/lib/wein/bki_kuerzel'
import { istFlaschenEroeffnung } from '@/lib/kellerbuch/eroeffnungsStichtag'
import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { JOURNAL_QUELLE_LABEL } from '@/lib/kellerbuch/journal'
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
/**
 * Vorschlag Liter Most je kg zugekaufter Trauben (Jörgen 02.10.2026) – nur zur Information am Zukauf-Beleg; gezählt
 * wird die tatsächlich gepresste Menge (Pressung, anteilig nach Trauben-kg).
 */
export const TRAUBEN_LITER_JE_KG_VORSCHLAG = 0.7
/** Restmenge zugekaufter Trauben unter 1 kg gilt als gepresst */
const KG_TOLERANZ = 1

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

/** Umstufung Most/Sturm → Wein: neutraler Spaltenwechsel ohne Abwertung (Nachtrag 4, 02.10.2026) */
export const UMSTUFUNG_MOST = 'UMST_MOST'
/**
 * Interne Buchungsarten der BSM-Rechnung, die (noch) nicht im Katalog kat_buchungsart stehen – Aufnahme dort nur
 * per Migration (lib/katalog/bki.ts ist ihr Spiegel).
 */
export const BSM_INTERNE_ARTEN: readonly { code: string; bezeichnung: string }[] = [
  { code: UMSTUFUNG_MOST, bezeichnung: 'Umstufung Most/Sturm → Wein (neutral, keine Abwertung)' },
]

/** Kürzel aller Buchungsarten (Filter des Kontrolljournals) */
const ALLE_CODES = new Set([...KAT_BUCHUNGSART.map(b => b.code), ...BSM_INTERNE_ARTEN.map(b => b.code)])

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
/** BSM-Spalte (kat_qualitaetsstufe.bsm_spalte) bzw. die eigene Gliederungsgruppe Most/Sturm (Nachtrag 4) */
export type MeldeSpalte = BsmSpalte | 'most_sturm'
/** BSM-Spalte bzw. 'ohne' (keine Zuordnung möglich, z. B. Industriewein) */
export type SpalteSchluessel = MeldeSpalte | 'ohne'

export const BSM_SPALTEN: readonly { key: MeldeSpalte; label: string; rang: number | null }[] = [
  // Nachtrag 4 (Jörgen 02.10.2026): Most und Sturm als eigene Gruppe neben den Weinspalten, ohne Rang (kein Abwerten)
  { key: 'most_sturm', label: 'Most/Sturm', rang: null },
  { key: 'wein', label: 'Wein', rang: 0 },
  { key: 'rebsortenwein', label: 'Rebsortenwein', rang: 1 },
  { key: 'landwein', label: 'Landwein', rang: 2 },
  { key: 'qualitaetswein', label: 'Qualitätswein', rang: 3 },
  { key: 'praedikatswein', label: 'Prädikatswein', rang: 4 },
  { key: 'perl_schaumwein', label: 'Perlwein und Schaumwein', rang: null },
  { key: 'sonstige', label: 'Sonstige Erzeugnisse', rang: null },
]
export const SPALTE_OHNE_LABEL = 'ohne Zuordnung'
export const spalteLabel = (s: MeldeSpalte | null) => (s ? BSM_SPALTEN.find(x => x.key === s)?.label ?? s : SPALTE_OHNE_LABEL)
const spalteRang = (s: MeldeSpalte | null) => (s ? BSM_SPALTEN.find(x => x.key === s)?.rang ?? null : null)

export const HERKUNFT_LABEL: Record<Herkunft, string> = { AT: 'Österreich', EU: 'andere EU-Mitgliedstaaten', DRITT: 'Drittland' }
export const GEBINDE_LABEL: Record<Gebinde, string> = { offen: 'offen (Fass/Tank)', flasche: 'Flasche' }
/** Rosé zählt zu rot – auch in den BSM-Spalten (R17, bestätigt Jörgen 02.10.2026) */
export const FARBE_LABEL_BSM: Record<MeldeFarbe, string> = { W: 'weiß', R: 'rot (inkl. Rosé)' }

/** Charge im Status Ernte/Gärung = Most bzw. Sturm (wie TB_MOST_STATUS der Transportbescheinigung) */
export const MOST_STATUS: readonly string[] = ['ernte', 'gaerung']
const MOST_STURM_ERZEUGNIS = new Set(['MOST', 'STURM'])
/** BKI-Qualitätskürzel Sturm (STU) und teilweise gegorener Traubenmost (TGT) */
const MOST_STURM_STUFEN = new Set(['STU', 'TGT'])
const MOST_STURM_STUFEN_INTERN = new Set(['most', 'sturm', 'tgt', 'teilweise_gegorener_traubenmost'])

/**
 * Most/Sturm (Nachtrag 4): Erzeugnis MOST/STURM (kat_erzeugnis), Qualitätsangabe Sturm/TGT (kat_qualitaetsstufe) – beides
 * zum Buchungszeitpunkt aus den Momentaufnahmen – oder die Charge ist HEUTE im Status Ernte/Gärung. Grenze: Der Status
 * hat keinen Verlauf. Weil er nur vorwärts läuft (ernte → gaerung → ausbau …), war eine heute gärende Charge auch an
 * jedem früheren Tag Most; eine Charge, die heute im Ausbau liegt, zählt dagegen auch für die Tage ihrer Gärung als Wein.
 */
export function istMostSturm(angabe: QualitaetsAngabe, status?: string | null): boolean {
  if (angabe.erzeugnis && MOST_STURM_ERZEUGNIS.has(angabe.erzeugnis.toUpperCase())) return true
  const stufe = textOderNull(angabe.stufe)
  if (stufe && (MOST_STURM_STUFEN.has(katalogQualitaet(stufe)?.code ?? stufe.toUpperCase()) || MOST_STURM_STUFEN_INTERN.has(stufe.toLowerCase()))) return true
  return !!status && MOST_STATUS.includes(status)
}

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
  /** weinausbau.status (heute) – nur Chargen; Füllungen und Zukauf: null */
  status?: string | null
}

/**
 * BSM-Spalte: Erzeugnis bzw. Stufe Most/Sturm → Gliederungsgruppe Most/Sturm; Erzeugnis Sekt/Perlwein/Schaumwein/PetNat
 * → Perl- und Schaumwein, Likör-/aromatisierter Wein, weinhaltiges Getränk, entalkoholisiert → Sonstige; Charge heute
 * im Status Ernte/Gärung → Most/Sturm; sonst nach der Stufe (kat_qualitaetsstufe.bsm_spalte), „Wein“ mit Rebsorte oder
 * Jahrgang → Rebsortenwein. Ohne Stufe: wie „Wein“ (ohneStufe = true). Kabinett bleibt vorläufig in der Spalte
 * Qualitätswein (bestätigt Jörgen 02.10.2026, bis BKI-Antwort KAN-38 Frage 12).
 * relevant = false: nicht bestandsmeldepflichtig (Traubensaft, R10).
 */
export function bsmSpalte(m: Pick<Merkmale, 'angabe' | 'rebsorte' | 'jahrgang' | 'status'>): { spalte: MeldeSpalte | null; relevant: boolean; ohneStufe: boolean } {
  const erz = m.angabe.erzeugnis
  if (erz && NICHT_BSM.has(erz)) return { spalte: null, relevant: false, ohneStufe: false }
  if (istMostSturm(m.angabe)) return { spalte: 'most_sturm', relevant: true, ohneStufe: false }
  if (erz && PERL_SCHAUM.has(erz)) return { spalte: 'perl_schaumwein', relevant: true, ohneStufe: false }
  if (erz && SONSTIGE_ERZEUGNISSE.has(erz)) return { spalte: 'sonstige', relevant: true, ohneStufe: false }
  if (istMostSturm(m.angabe, m.status)) return { spalte: 'most_sturm', relevant: true, ohneStufe: false }
  const mitSorte = !!textOderNull(m.rebsorte) || m.jahrgang != null
  const k = katalogQualitaet(m.angabe.stufe)
  if (!k) return { spalte: mitSorte ? 'rebsortenwein' : 'wein', relevant: true, ohneStufe: true }
  if (k.code === 'WEI') return { spalte: mitSorte ? 'rebsortenwein' : 'wein', relevant: true, ohneStufe: false }
  return { spalte: k.bsmSpalte, relevant: true, ohneStufe: false }
}

/**
 * Meldefarbe: weinart (Rosé = rot, R17 – bestätigt Jörgen 02.10.2026, gilt für alle BSM-Spalten, Bestände und Buchungen),
 * sonst aus der Rebsorte (BKI-Kürzelliste); unbekannt → null
 */
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
  { vorgang: 'Pressung eigener Trauben', code: 'ERNTE', hinweis: 'gemischte Pressung: Anteil der eigenen Trauben nach Trauben-kg' },
  { vorgang: 'Pressung zugekaufter Trauben', code: 'ZK_TRAUB', hinweis: 'in Liter = tatsächlich gepresster Most, anteilig nach Trauben-kg (pressung_weingaerten.zukauf_posten_id)' },
  { vorgang: 'Zukauf Trauben (Beleg)', code: 'ZK_TRAUB (Info)', hinweis: `nur in kg, nicht in der Literrechnung (sonst doppelt); Vorschlag ${fmtNum(TRAUBEN_LITER_JE_KG_VORSCHLAG, 1)} l/kg, tatsächliche Menge nach Pressung` },
  { vorgang: 'Pressung zugekaufter Maische', code: 'ZK_MAISC', hinweis: 'wie Trauben: in Liter = tatsächlich gepresster Most, anteilig nach kg (KAN-41)' },
  { vorgang: 'Zukauf Maische (Beleg)', code: 'ZK_MAISC (Info)', hinweis: 'nur in kg, nicht in der Literrechnung; tatsächliche Menge nach Pressung' },
  { vorgang: 'Traubenverkauf (Beleg)', code: 'TRAUBVK (Info)', hinweis: 'nur in kg, kein Weinbestand – nachrichtlich im Kontrolljournal (KAN-41)' },
  { vorgang: 'Zukauf Wein in eine Charge', code: 'ZK_FASS' },
  { vorgang: 'Zukauf Most', code: 'ZK_MOST' },
  { vorgang: 'Zukauf Flaschen (Handelsware, Weinlager-Artikel aus einem Flaschenzukauf)', code: 'ZK_FLA', hinweis: 'Liter = Anzahl × Flaschengröße (KAN-41)' },
  { vorgang: 'Füllung ohne Charge (weder Zukauf noch Eröffnungsbestand)', code: 'ZK_FLA', hinweis: 'als Flaschenzukauf gezählt – prüfen' },
  { vorgang: 'Tankverkauf mit Lieferort in Österreich / im Ausland', code: 'VK_FA_AT / VK_FA_AU', hinweis: 'Lieferland des Verkaufs → Bestimmungsland des Exportauftrags (gleicher Kunde, gleicher Tag) → Land des Kunden (Warnung)' },
  { vorgang: 'Flaschenverkauf (Stück × Flaschengröße) mit Lieferort in Österreich / im Ausland', code: 'VK_FL_AT / VK_FL_AU', hinweis: 'Lieferort wie beim Tankverkauf' },
  { vorgang: 'Verschnitt: Quell-Charge / Ziel-Charge', code: 'VS_AB / VS_ZU' },
  { vorgang: 'Spaltenwechsel bei Umzug, Filtration, Füllung, Verschnitt (vorhandener Ziel-Wein)', code: 'AB_ABW + ZU_ABW' },
  { vorgang: 'Most/Sturm wird Wein (Umzug, Filtration, Füllung, Verschnitt in eine Wein-Charge)', code: UMSTUFUNG_MOST, hinweis: 'neutraler Spaltenwechsel ohne Abwertung (Saldo 0)' },
  { vorgang: 'Schwundbuchung, Schwund bei Umzug/Filtration, Füllverlust, Bruch, Eigenverbrauch, Inventur-Mindermenge', code: 'SCHWUND' },
  { vorgang: 'Flaschen „Anfangsbestand (Altbestand, ±)“ mit negativer Menge', code: 'SCHWUND', hinweis: 'Abgang (Altbestand-Korrektur), keine Eröffnung' },
  { vorgang: 'Verarbeitung (Traubensaft, Essig, Brennerei, Sonstiges)', code: 'AB_VERAR', hinweis: 'Abgang aus der Charge über „Verarbeiten“ (KAN-41)' },
  { vorgang: 'Kellerbehandlung mit Volumenzugang (Süßreserve, RTK …)', code: 'ZU_BEH', hinweis: 'Zugang an der Charge über „Volumenzugang“ der Behandlung (KAN-41)' },
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
    case 'verarbeitung': return 'AB_VERAR'   // KAN-41 Paket 3a
    case 'behandlung': return 'ZU_BEH'   // KAN-41 Paket 3b: nur Behandlungen mit Volumenzugang haben eine Menge
    case 'verschneidung_aus': return 'VS_AB'
    case 'verschneidung_ein': return 'VS_ZU'
    case 'umzug_ein': case 'umzug_aus': return 'UMZUG'
    case 'filtration_ein': case 'filtration_aus': return 'FILTRAT'
    case 'abfuellung': return 'FUELLUNG'
    default: return null
  }
}

/** Hinweis an ZK_FLA-Zeilen echter Flaschenzukäufe (Journal: s112_journal_zeilen_fuellung, KAN-41 Paket 2b) – ohne Prüfwarnung */
export const HANDELSWARE_HINWEIS = 'Flaschenzukauf (Handelsware)'

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
      // Nachtrag 7 (Jörgen 02.10.2026): „Anfangsbestand (Altbestand, ±)“ mit negativer Menge ist ein Abgang, keine
      // Eröffnung – eine Altbestand-Korrektur nach Abfüllung bzw. Verkauf ohne Beleg. Die BSM kennt keinen Abgang
      // „Korrektur“; Verkäufe bräuchten Kunde und Beleg (AT/Ausland) – daher Eigenverbrauch/Schwund (SCHWUND).
      return menge < 0 ? 'SCHWUND' : 'EROEFF'
    default:   // inventur, korrektur
      return menge < 0 ? 'SCHWUND' : 'INV_PLUS'
  }
}

const KAT = new Map<string, { bezeichnung: string }>([...KAT_BUCHUNGSART, ...BSM_INTERNE_ARTEN].map(b => [b.code, b]))
export const buchungsartLabel = (code: string) => KAT.get(code)?.bezeichnung ?? code

// ── Zeilen ────────────────────────────────────────────────────────────────────────────────────────────

export type BsmZelle = { spalte: MeldeSpalte | null; farbe: MeldeFarbe | null; herkunft: Herkunft; gebinde: Gebinde }

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
  /** Zugang / Abgang / Umstufung (Most/Sturm → Wein) / Bestand / Prüfung */
  abschnitt: 'Bestand' | 'Zugang' | 'Abgang' | 'Umstufung' | 'Prüfung'
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
  /** Zugekaufte Trauben im Zeitraum laut Beleg (kg, nur nachrichtlich) */
  traubenKg: number
  /** Most aus Pressungen zugekaufter Trauben im Zeitraum (l, Buchungsart ZK_TRAUB) */
  traubenLiter: number
  /** Zugekaufte Maische im Zeitraum laut Beleg (kg, nur nachrichtlich, KAN-41) */
  maischeKg: number
  /** Most aus Pressungen zugekaufter Maische im Zeitraum (l, Buchungsart ZK_MAISC) */
  maischeLiter: number
  warnungen: string[]
  /** Rechengrundlage: Bewegungsjournal (KAN-40 E2) oder Rekonstruktion aus den Bewegungstabellen */
  quelle: BsmQuelle
}

/** Rechengrundlage der BSM */
export type BsmQuelle = 'journal' | 'rekonstruktion'

const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`
const auszug = (namen: readonly string[]) => [...new Set(namen)].slice(0, 5).join(', ') + (new Set(namen).size > 5 ? ' …' : '')
const l2 = (x: number) => runden(x, STELLEN.liter)
const fmtL = (x: number) => `${fmtNum(x, 2)} l`

/** Zusätzliche Daten der BSM (Lieferort, Traubenzukauf) */
export type BsmZusatz = {
  /** verkaufsposten je id, Momentaufnahme (partner_daten) bereits angewendet */
  verkaufsposten: Map<string, R>
  /** zukauf_posten art 'trauben' bzw. 'maische' (aktiv, KAN-41) */
  traubenZukauf: R[]
  /** KAN-41 Paket 3c: traubenverkauf (nicht storniert) – Info-Zeilen TRAUBVK in kg */
  traubenverkauf?: R[]
  /** pressung_weingaerten (Trauben-kg je Pressung, zukauf_posten_id bei zugekauften Trauben/Maische), mit pressung(id, datum) und zukauf(art) */
  pressungWeingaerten?: R[]
  /** exportauftraege (nicht storniert) – Bestimmungsland als Lieferort */
  exportauftraege?: R[]
  /** gibt es die Spalte verkaufsposten.lieferland schon? (Migration offen, siehe VP_LIEFERLAND) */
  lieferlandErfasst?: boolean
}

/**
 * Lieferland am Verkauf: Die Spalte gibt es noch nicht – geplante Migration (nur beschrieben, KAN-43 Nachtrag 5):
 *   ALTER TABLE public.verkaufsposten ADD COLUMN lieferland text REFERENCES public.kat_land(iso2);
 * Bis dahin liest ladeBsm() sie optional (fehlt sie, gilt der Fallback Exportauftrag → Land des Kunden).
 */
const VP_LIEFERLAND = 'lieferland'
const VP_SELECT = 'id, datum, rechnungsnummer, kontakt_id, firma_id, partner_daten, kontakt:kontakt_id(vorname, nachname, land), firma:firma_id(name, land)'

/** Fehlt eine Spalte (Postgres 42703, PostgREST PGRST204 bzw. Meldung mit dem Spaltennamen)? */
export function fehlendeSpalte(fehler: { code?: string; message?: string } | null | undefined, spalte: string): boolean {
  if (!fehler) return false
  const text = String(fehler.message ?? '')
  return (fehler.code === '42703' || fehler.code === 'PGRST204' || /column|spalte/i.test(text)) && text.includes(spalte)
}

/** zukauf_posten art 'trauben' bzw. 'maische' (aktiv, KAN-41) – Info-Zeilen in kg */
function ladeTraubenZukauf(supabase: Client, tenantId: string) {
  return alle<R>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('zukauf_posten') as any)
      .select('id, datum, art, einheit, menge, rebsorte, jahrgang, weinart, qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, eingangsrechnungsnummer, partner_daten, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .in('art', ['trauben', 'maische'])
      .order('datum')
      .order('id'),
  )
}

/** KAN-41 Paket 3c: Traubenverkäufe (nicht storniert) – Info-Zeilen in kg */
function ladeTraubenverkauf(supabase: Client, tenantId: string) {
  return alle<R>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('traubenverkauf') as any)
      .select('id, datum, menge_kg, qualitaetsstufe, liefernummer, partner_daten, weingarten:weingarten_id(rebsorte), grundstueck:grundstueck_id(rebsorte), zukauf:zukauf_posten_id(rebsorte, weinart), jahrgang:jahrgang_id(jahrgang), kontakt:kontakt_id(vorname, nachname), firma:firma_id(name), verkaufsposten:verkaufsposten_id(storniert)')
      .eq('tenant_id', tenantId)
      .is('storniert_am', null)
      .order('datum')
      .order('id'),
  )
}

/** pressung_weingaerten (Trauben-kg je Pressung, zukauf_posten_id) mit der Pressung */
function ladePressungWeingaerten(supabase: Client, tenantId: string) {
  // tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Filter über die Pressung (!inner)
  return alle<R>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressung_weingaerten') as any)
      .select('id, pressung_id, trauben_kg, zukauf_posten_id, storniert_am, pressung:pressung_id!inner(id, datum, tenant_id, storniert_am), zukauf:zukauf_posten_id(art)')
      // storno-sichtbar: Anteil zugekaufter Trauben auch für stornierte Pressungen (Gegenbuchung am Storno-Tag)
      .eq('pressung.tenant_id', tenantId)
      .order('id'),
  )
}

/** Journalbeginn (tenant_einstellungen.journal_ab); null = Journal aus bzw. nicht lesbar (dann Rekonstruktion) */
async function ladeJournalAb(supabase: Client, tenantId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('tenant_einstellungen') as any)
    .select('journal_ab')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error || !data) return null
  return tag(data.journal_ab) || null
}

/** Spalten der Journalzeilen für die BSM */
const JOURNAL_SPALTEN_BSM = 'id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, fuellung_id, menge_liter, menge_stk, menge_kg, partner_name, partner_land, quelle_tabelle, quelle_id, gruppe_id, storno_von_id, rekonstruiert, charge_name, fuellung_name, flaschengroesse_ml, erzeugnis, qualitaetsstufe, zusatzbezeichnung, weinart, land_iso, rebsorte, jahrgang, charge_status, hinweis'

/** BSM aus dem Bewegungsjournal (KAN-40 E2): Journalzeilen bis „bis“, Traubenbelege (kg) und heutige Abweichungen */
async function ladeBsmAusJournal(supabase: Client, tenantId: string, z: BsmZeitraum, heute: string, journalAb: string): Promise<BsmDaten> {
  const [jRes, tzRes, pwRes, kRes, tvRes] = await Promise.all([
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('kellerbuch_buchungen') as any)
        .select(JOURNAL_SPALTEN_BSM)
        .eq('tenant_id', tenantId)
        .lte('datum', z.bis)
        .order('beleg_nr')
        .order('pos'),
    ),
    ladeTraubenZukauf(supabase, tenantId),
    ladePressungWeingaerten(supabase, tenantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.rpc as any)('journal_konsistenz', { p_tenant_id: tenantId }),
    ladeTraubenverkauf(supabase, tenantId),
  ])
  if (tvRes.error) throw new Error(`Laden fehlgeschlagen (traubenverkauf): ${tvRes.error.message}`)
  if (jRes.error) throw new Error(`Laden fehlgeschlagen (kellerbuch_buchungen): ${jRes.error.message}`)
  if (tzRes.error) throw new Error(`Laden fehlgeschlagen (zukauf_posten): ${tzRes.error.message}`)
  if (pwRes.error) throw new Error(`Laden fehlgeschlagen (pressung_weingaerten): ${pwRes.error.message}`)
  const abweichungen = kRes?.error ? null : ((kRes?.data ?? []) as unknown[]).length
  return berechneBsmAusJournal(jRes.data, {
    verkaufsposten: new Map(), traubenZukauf: tzRes.data, pressungWeingaerten: pwRes.data, traubenverkauf: tvRes.data,
  }, z, heute, { journalAb, abweichungen })
}

export async function ladeBsm(supabase: Client, tenantId: string, z: BsmZeitraum, opts: { heute?: string } = {}): Promise<BsmDaten> {
  const heute = opts.heute ?? wienHeute()
  // KAN-40 E2: Ist das Bewegungsjournal spätestens am Zeitraumende eröffnet, rechnet die BSM aus kellerbuch_buchungen
  // (Merkmale zum Buchungszeitpunkt); sonst wie bisher aus den Bewegungstabellen rekonstruiert.
  const journalAb = await ladeJournalAb(supabase, tenantId)
  if (journalAb && journalAb <= z.bis) return ladeBsmAusJournal(supabase, tenantId, z, heute, journalAb)
  const ladeVerkaufsposten = (mitLieferland: boolean) => alle<R>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('verkaufsposten') as any)
      .select(mitLieferland ? `${VP_SELECT}, ${VP_LIEFERLAND}` : VP_SELECT)
      .eq('tenant_id', tenantId)
      .order('id'),
  )
  const verkaufspostenMitLieferland = async () => {
    const r = await ladeVerkaufsposten(true)
    return fehlendeSpalte(r.error, VP_LIEFERLAND) ? { ...(await ladeVerkaufsposten(false)), lieferlandErfasst: false } : { ...r, lieferlandErfasst: true }
  }
  const [g, vpRes, tzRes, pwRes, exRes, tvRes] = await Promise.all([
    ladeBestandsGrundlage(supabase, tenantId),
    verkaufspostenMitLieferland(),
    ladeTraubenZukauf(supabase, tenantId),
    ladePressungWeingaerten(supabase, tenantId),
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('exportauftraege') as any)
        .select('id, referenz, datum, lieferdatum, destination_land, kontakt_id, firma_id, aktiv')
        .eq('tenant_id', tenantId)
        .is('storniert_am', null)
        .order('id'),
    ),
    ladeTraubenverkauf(supabase, tenantId),
  ])
  if (tvRes.error) throw new Error(`Laden fehlgeschlagen (traubenverkauf): ${tvRes.error.message}`)
  if (vpRes.error) throw new Error(`Laden fehlgeschlagen (verkaufsposten): ${vpRes.error.message}`)
  if (tzRes.error) throw new Error(`Laden fehlgeschlagen (zukauf_posten): ${tzRes.error.message}`)
  if (pwRes.error) throw new Error(`Laden fehlgeschlagen (pressung_weingaerten): ${pwRes.error.message}`)
  if (exRes.error) throw new Error(`Laden fehlgeschlagen (exportauftraege): ${exRes.error.message}`)
  const verkaufsposten = new Map<string, R>()
  for (const vp of vpRes.data) verkaufsposten.set(vp.id, momentaufnahmeAnwenden(vp, ['kontakt', 'firma']))
  return berechneBsm(g, {
    verkaufsposten, traubenZukauf: tzRes.data, pressungWeingaerten: pwRes.data, exportauftraege: exRes.data, traubenverkauf: tvRes.data,
    lieferlandErfasst: vpRes.lieferlandErfasst,
  }, z, heute)
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
  /** Verkäufe (verkaufsposten.id) ohne jedes Land bzw. mit dem Land des Kunden als Ersatz für den Lieferort */
  const kundeLandUnbekannt = new Set<string>()
  const lieferortKundenland = new Set<string>()

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
      status: textOderNull(c.status),
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
  /** Bestimmungsland eines Exportauftrags desselben Kunden am selben Tag (genau ein Land, sonst null) */
  const exportZiel = (vp: R | undefined): { land: string; referenz: string | null } | null => {
    if (!vp || !(zusatz.exportauftraege?.length)) return null
    const d = tag(vp.datum)
    const treffer = zusatz.exportauftraege.filter(e => e.aktiv !== false
      && (vp.firma_id ? e.firma_id === vp.firma_id : !!vp.kontakt_id && e.kontakt_id === vp.kontakt_id)
      && (tag(e.lieferdatum) === d || tag(e.datum) === d))
    const laender = new Set(treffer.map(e => normalisiereLand(e.destination_land)).filter((l): l is string => !!l))
    if (laender.size !== 1) return null
    const land = [...laender][0]
    return { land, referenz: textOderNull(treffer.find(e => normalisiereLand(e.destination_land) === land)?.referenz) }
  }
  /**
   * Lieferort eines Verkaufs (Nachtrag 5): Lieferland des Verkaufs → Bestimmungsland des Exportauftrags → Land des
   * Kunden (Firma, sonst Kontakt; Warnung „Lieferort unbekannt“) → ohne Land Österreich (Warnung).
   */
  const kunde = (verkaufspostenId: string | null | undefined): { ausland: boolean; land: string | null; quelle: string | null } => {
    const vp = verkaufspostenId ? zusatz.verkaufsposten.get(verkaufspostenId) : undefined
    const liefer = normalisiereLand(vp?.[VP_LIEFERLAND] ?? null)
    if (liefer) return { ausland: liefer !== 'AT', land: liefer, quelle: 'Lieferland' }
    const ex = exportZiel(vp)
    if (ex) return { ausland: ex.land !== 'AT', land: ex.land, quelle: `Bestimmungsland lt. Exportauftrag${ex.referenz ? ` ${ex.referenz}` : ''}` }
    const land = normalisiereLand((vp?.firma as R | null)?.land ?? (vp?.kontakt as R | null)?.land ?? null)
    if (!land) { kundeLandUnbekannt.add(verkaufspostenId ?? '?'); return { ausland: false, land: null, quelle: null } }
    lieferortKundenland.add(verkaufspostenId ?? '?')
    return { ausland: land !== 'AT', land, quelle: 'Land des Kunden' }
  }
  const landText = (k: { land: string | null; quelle: string | null }) => (k.land ? `${landAnzeige(k.land)}${k.quelle && k.quelle !== 'Lieferland' ? ` (${k.quelle})` : ''}` : null)

  // Pressung → Anteil zugekaufter Trauben (Nachtrag 1): pressung_behaelter.id → pressung.id → pressung_weingaerten
  const pressungVonBehaelter = new Map<string, string>()
  for (const pb of g.betrieb.quellen.pressungen ?? []) {
    const pid = (pb.pressung as R | null)?.id ?? pb.pressung_id
    if (pid) pressungVonBehaelter.set(pb.id, pid)
  }
  const weingaertenJePressung = new Map<string, R[]>()
  for (const pw of zusatz.pressungWeingaerten ?? []) {
    const pid = pw.pressung_id ?? (pw.pressung as R | null)?.id
    if (!pid) continue
    weingaertenJePressung.set(pid, [...(weingaertenJePressung.get(pid) ?? []), pw])
  }
  /** Art des Zukaufs einer Traubenzeile (KAN-41): Maische → ZK_MAISC, sonst ZK_TRAUB */
  const traubenArtById = new Map<string, string>(zusatz.traubenZukauf.map(t => [t.id as string, t.art as string]))
  const istMaische = (pw: R) => ((pw.zukauf as R | null)?.art ?? traubenArtById.get(pw.zukauf_posten_id) ?? zukaufById.get(pw.zukauf_posten_id)?.art) === 'maische'
  /** Anteil zugekaufter Trauben bzw. Maische (kg) an einer Pressung; null = kein Zukauf bzw. keine kg erfasst */
  const zukaufAnteil = (pressungBehaelterId: string | undefined): { anteil: number; kgZukauf: number; kgGesamt: number; kgMaische: number } | null => {
    const pid = pressungBehaelterId ? pressungVonBehaelter.get(pressungBehaelterId) : undefined
    const alleZeilen = pid ? weingaertenJePressung.get(pid) ?? [] : []
    // aktive Zeilen; ist die ganze Pressung storniert (alle Zeilen storniert), gilt der Stand vor dem Storno
    const aktiv = alleZeilen.filter(pw => !pw.storniert_am)
    const zeilen = aktiv.length > 0 ? aktiv : alleZeilen
    const kgGesamt = zeilen.reduce((s, pw) => s + Math.max(0, zahlOderNull(pw.trauben_kg) ?? 0), 0)
    const kgZukauf = zeilen.filter(pw => pw.zukauf_posten_id).reduce((s, pw) => s + Math.max(0, zahlOderNull(pw.trauben_kg) ?? 0), 0)
    const kgMaische = zeilen.filter(pw => pw.zukauf_posten_id && istMaische(pw)).reduce((s, pw) => s + Math.max(0, zahlOderNull(pw.trauben_kg) ?? 0), 0)
    if (kgGesamt <= 0 || kgZukauf <= 0) return null
    return { anteil: kgZukauf / kgGesamt, kgZukauf, kgGesamt, kgMaische }
  }
  const bestandCharge = (chargeId: string, datum: string): number => {
    const p = chargenPosten.get(chargeId)
    return p ? bestandAmStichtag(p.heuteLiter, p.buchungen, datum, p.beginn, STELLEN.liter).bestand : 0
  }

  const buchungen: BsmBuchung[] = []
  const aufwertungen: string[] = []
  const gemischt: string[] = []
  /** Flaschen-„Anfangsbestand (Altbestand, ±)“ mit negativer Menge → Abgang SCHWUND (Nachtrag 7) */
  const altbestandMinus: { name: string; liter: number }[] = []

  const abwertungsAusgleich = (zeilen: BsmBuchung[], name: string) => abwertungsAusgleichMit(zeilen, name, aufwertungen, gemischt)

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
    // Most/Sturm ↔ Wein ist keine Abwertung, sondern eine neutrale Umstufung (Nachtrag 4)
    const umstufung = zAlt.spalte === 'most_sturm' || zNeu.spalte === 'most_sturm'
    return [
      { ...basis, ...zAlt, code: umstufung ? UMSTUFUNG_MOST : 'AB_ABW', liter: -menge, kg: null, hinweis },
      { ...basis, ...zNeu, code: umstufung ? UMSTUFUNG_MOST : 'ZU_ABW', liter: menge, kg: null, hinweis },
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
    // Pressung mit zugekauften Trauben: Most anteilig nach Trauben-kg auf ERNTE und ZK_TRAUB (Nachtrag 1),
    // der Anteil zugekaufter Maische auf ZK_MAISC (KAN-41)
    if (b.art === 'pressung') {
      const a = zukaufAnteil(b.quelleId)
      if (a) {
        const zk = a.anteil >= 1 ? b.menge : l2(b.menge * a.anteil)
        const maische = a.kgMaische <= 0 ? 0 : a.kgMaische >= a.kgZukauf ? zk : l2(zk * a.kgMaische / a.kgZukauf)
        const trauben = l2(zk - maische)
        const eigen = l2(b.menge - zk)
        const ware = a.kgMaische <= 0 ? 'Trauben' : a.kgMaische >= a.kgZukauf ? 'Maische' : 'Trauben und Maische'
        const text = `Pressung mit ${ware === 'Maische' ? 'zugekaufter' : 'zugekauften'} ${ware}: ${fmtNum(a.kgZukauf, 0)} von ${fmtNum(a.kgGesamt, 0)} kg (${fmtNum(a.anteil * 100, 1)} %) – Most anteilig nach Trauben-kg`
        const hinweis = [basis.hinweis, text].filter(Boolean).join(' · ')
        if (Math.abs(eigen) >= NULL_UNTER) buchungen.push(zeile('ERNTE', eigen, { hinweis }))
        if (Math.abs(trauben) >= NULL_UNTER) buchungen.push(zeile('ZK_TRAUB', trauben, { hinweis }))
        if (Math.abs(maische) >= NULL_UNTER) buchungen.push(zeile('ZK_MAISC', maische, { hinweis }))
        continue
      }
    }
    let code = buchungsartBewegung(b.art)
    if (b.art === 'zukauf') code = buchungsartBewegung('zukauf', { zukaufArt: b.quelleId ? zukaufById.get(b.quelleId)?.art : null })
    if (b.art === 'verkauf') {
      const vpos = b.quelleId ? verkaufById.get(b.quelleId) : undefined
      const k = kunde(vpos?.verkaufsposten_id)
      code = buchungsartBewegung('verkauf', { kundeAusland: k.ausland })
      if (k.land) basis.gegenstelle = [b.gegenstelle, landText(k)].filter(Boolean).join(' · ')
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
      const k = istVerkauf ? kunde(fb.verkaufspostenId) : { ausland: false, land: null, quelle: null }
      const code = buchungsartFlasche(fb.art, fb.menge, { kundeAusland: k.ausland, mitCharge: !!f.weinausbau_id, eroeffnung })
      const altbestandAb = fb.art === 'anfangsbestand' && fb.menge < 0
      if (altbestandAb) altbestandMinus.push({ name, liter })
      const vp = fb.verkaufspostenId ? zusatz.verkaufsposten.get(fb.verkaufspostenId) : undefined
      const kunde_ = textOderNull((vp?.firma as R | null)?.name) ?? textOderNull([(vp?.kontakt as R | null)?.vorname, (vp?.kontakt as R | null)?.nachname].filter(Boolean).join(' '))
      const zeile: BsmBuchung = {
        ...zl, datum: fb.datum, code, liter, kg: null,
        vorgang: FLASCHEN_VORGANG[fb.art] ?? `Flaschenbuchung (${fb.art})`,
        charge: f.weinausbau_id ? textOderNull(chargeById.get(f.weinausbau_id)?.name) : null,
        fuellung: name,
        gegenstelle: istVerkauf ? [kunde_, landText(k)].filter(Boolean).join(' · ') || null : null,
        beleg: istVerkauf ? textOderNull(vp?.rechnungsnummer) : textOderNull(f.pruefnummer) ?? textOderNull(f.chargennummer),
        storno: fb.art === 'verkauf_storno' || fb.art === 'verkauf_alt_storno' || fb.art === 'storno_fuellung' ? 'Gegenbuchung (Storno)' : null,
        hinweis: `${fmtNum(Math.abs(fb.menge), 0)} Fl. à ${p.ml} ml${p.mlErfasst ? '' : ' (angenommen)'}${code === 'ZK_FLA' ? (f.zukauf_posten_id ? ` · ${HANDELSWARE_HINWEIS}` : ' · Füllung ohne Charge – als Flaschenzukauf gezählt, prüfen') : ''}${altbestandAb ? ' · Altbestand-Korrektur (−): Abgang, als Eigenverbrauch/Schwund gezählt' : ''}`,
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

  // ── 3. Zukauf Trauben: Beleg in kg nur als Info-Zeile (traubenInfo) ──
  const ti = traubenInfo(zusatz, z, zelle)
  buchungen.push(...ti.zeilen)
  const { traubenKg, maischeKg, nichtGepresst } = ti
  const traubenLiter = l2(buchungen.filter(r => r.code === 'ZK_TRAUB').reduce((s, r) => s + r.liter, 0))
  const maischeLiter = l2(buchungen.filter(r => r.code === 'ZK_MAISC').reduce((s, r) => s + r.liter, 0))

  // Kontrolljournal: nach Datum, innerhalb eines Tages in Entstehungsreihenfolge
  buchungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // ── 4. Anfangs- und Stichtagsbestand ──
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

  return bsmAbschliessen({
    z, anfangAm, heute, buchungen, anfang, stichtag, traubenKg, traubenLiter, maischeKg, maischeLiter, warnungen, aufwertungen,
    gemischt, nichtGepresst, altbestandMinus, negativ, ohneStufe, ohneFarbe, landUnbekannt, lieferortKundenland, kundeLandUnbekannt,
    nichtRelevant, lieferlandErfasst: zusatz.lieferlandErfasst, ohneDatum: g.ohneDatum, deaktiviertOhneDatum: g.deaktiviertOhneDatum,
    gliederungsHinweis: gliederungRekonstruktion(heute), quelle: 'rekonstruktion',
  })
}

// ── BSM aus dem Bewegungsjournal (KAN-40 Etappe E2, 03.10.2026) ──────────────────────────────────────────────────
//
// Jede Zeile von kellerbuch_buchungen trägt Buchungsart und Merkmale zum Buchungszeitpunkt (Erzeugnis, Stufe, Zusatz,
// Farbe, Land, Sorte, Jahrgang, Status der Charge) – die Zelle der BSM ergibt sich direkt aus der Zeile, ohne Rückrechnung:
//   Anfangsbestand = Σ Zeilen vor „von“ je Zelle (+ Eröffnung EROEFF im Zeitraum), Buchungen = Zeilen im Zeitraum,
//   Bestand zum Stichtag = Σ Zeilen bis „bis“ (laut Journal; die Abweichung zum heutigen Ist meldet journal_konsistenz).
// Neutrale Umbuchungen (Umzug, Filtration, Füllung) eines Belegs mit Spaltenwechsel werden wie bisher zu AB_ABW/ZU_ABW
// bzw. UMST_MOST (abwertungsAusgleichMit); Umstufungspaare der Datenbank (Merkmals- bzw. Statuswechsel) ohne
// Zellwechsel entfallen, Most/Sturm ↔ Wein wird UMST_MOST. Belege mit Gegenbuchung bleiben neutral (wie die
// Storno-Paare der Rekonstruktion). INV_MIN zählt als SCHWUND (kat_buchungsart.bsm_code), INV_PLUS mit Warnung.
// Lieferort der Verkäufe = Land des Käufers zum Buchungszeitpunkt (partner_land; „Land reicht vorerst“, Jörgen 02.10.2026).

/** Optionen der Journal-Rechnung */
export type BsmJournalOptionen = {
  /** tenant_einstellungen.journal_ab */
  journalAb: string
  /** Zahl der heutigen Abweichungen Ist ↔ Journal (journal_konsistenz); null = nicht geprüft */
  abweichungen: number | null
}

/** Reine Rechnung aus Journalzeilen (Spalten wie JOURNAL_SPALTEN_BSM) – Tests rufen sie direkt */
export function berechneBsmAusJournal(zeilen: R[], zusatz: BsmZusatz, z: BsmZeitraum, heute: string, opts: BsmJournalOptionen): BsmDaten {
  const warnungen: string[] = []
  const anfangAm = vortag(z.von)
  const ohneStufe = new Set<string>()
  const ohneFarbe = new Set<string>()
  const landUnbekannt = new Set<string>()
  const nichtRelevant = new Set<string>()
  const kundeLandUnbekannt = new Set<string>()
  const lieferortKundenland = new Set<string>()
  const aufwertungen: string[] = []
  const gemischt: string[] = []
  const altbestandMinus: { name: string; liter: number }[] = []

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
  const merkmale = (r: R): Merkmale => ({
    angabe: normalisiereQualitaet({ qualitaetsstufe: textOderNull(r.qualitaetsstufe), zusatzbezeichnung: textOderNull(r.zusatzbezeichnung), erzeugnis: textOderNull(r.erzeugnis) }),
    weinart: textOderNull(r.weinart),
    rebsorte: textOderNull(r.rebsorte),
    jahrgang: zahlOderNull(r.jahrgang),
    land: textOderNull(r.land_iso),
    status: r.bestand === 'offen' ? textOderNull(r.charge_status) : null,
  })
  const name = (r: R) => textOderNull(r.bestand === 'flasche' ? r.fuellung_name : r.charge_name) ?? textOderNull(r.charge_name) ?? 'ohne Bezeichnung'
  const gebinde = (r: R): Gebinde => (r.bestand === 'flasche' ? 'flasche' : 'offen')
  const literVon = (r: R) => l2(zahlOderNull(r.menge_liter) ?? 0)

  // Zellen je Zeile (einmal berechnet; null = nicht bestandsmeldepflichtig)
  const zellen = new Map<string, BsmZelle | null>()
  for (const r of zeilen) zellen.set(r.id, zelle(merkmale(r), gebinde(r), name(r)))
  const gegengebucht = new Set<string>(zeilen.map(r => r.storno_von_id).filter(Boolean))

  // ── Bestände je Posten und Zelle ──
  const negativ: string[] = []
  const bestand = (bis: string): BestandsZelle[] => {
    const je = new Map<string, { zl: BsmZelle; liter: number; name: string; posten: string; stk: number; flasche: boolean }>()
    for (const r of zeilen) {
      if (tag(r.datum) > bis) continue
      const zl = zellen.get(r.id)
      if (!zl) continue
      const posten = r.bestand === 'flasche' ? `F|${r.fuellung_id}` : `C|${r.weinausbau_id}`
      const k = `${posten}|${zellSchluesselVon(zl)}`
      const x = je.get(k) ?? { zl, liter: 0, name: name(r), posten, stk: 0, flasche: r.bestand === 'flasche' }
      x.liter = l2(x.liter + literVon(r))
      x.stk += Math.trunc(zahlOderNull(r.menge_stk) ?? 0)
      je.set(k, x)
    }
    const aus: BestandsZelle[] = []
    for (const x of je.values()) {
      if (x.flasche ? x.stk < 0 : istNegativ(x.liter)) { negativ.push(`${x.name} am ${datumAT(bis)} (${x.flasche ? `${x.stk} Fl.` : fmtL(x.liter)})`); continue }
      if (Math.abs(x.liter) < NULL_UNTER) continue
      aus.push({ ...x.zl, liter: x.liter })
    }
    return aus
  }
  const anfang = bestand(anfangAm)
  const stichtag = bestand(z.bis)

  // ── Buchungen im Zeitraum ──
  const imZeitraum = zeilen.filter(r => { const d = tag(r.datum); return d >= z.von && d <= z.bis })
  const zuBuchung = (r: R): BsmBuchung | null => {
    const zl = zellen.get(r.id)
    if (!zl) return null
    let code = String(r.buchungsart_code)
    let hinweis = textOderNull(r.hinweis)
    if (code === 'INV_MIN') { code = 'SCHWUND'; hinweis = [hinweis, 'Inventur-Mindermenge (INV_MIN)'].filter(Boolean).join(' · ') }
    if (code === 'EROEFF' && r.bestand === 'flasche' && literVon(r) < 0) { code = 'SCHWUND'; altbestandMinus.push({ name: name(r), liter: literVon(r) }) }
    const istVerkauf = code.startsWith('VK_')
    const land = normalisiereLand(r.partner_land)
    if (istVerkauf) (land ? lieferortKundenland : kundeLandUnbekannt).add(String(r.quelle_id ?? r.id))
    const fl = r.bestand === 'flasche' ? Math.abs(Math.trunc(zahlOderNull(r.menge_stk) ?? 0)) : 0
    return {
      ...zl, datum: tag(r.datum), code, liter: literVon(r), kg: null,
      vorgang: JOURNAL_QUELLE_LABEL[r.quelle_tabelle] ?? r.quelle_tabelle,
      charge: textOderNull(r.charge_name),
      fuellung: textOderNull(r.fuellung_name),
      gegenstelle: [textOderNull(r.partner_name), land ? landAnzeige(land) : null].filter(Boolean).join(' · ') || null,
      beleg: `J ${r.beleg_nr}/${r.pos}`,
      storno: r.storno_von_id ? 'Gegenbuchung (Storno bzw. Änderung)' : gegengebucht.has(r.id) ? 'gegengebucht' : null,
      hinweis: [hinweis, fl ? `${fmtNum(fl, 0)} Fl.${r.flaschengroesse_ml ? ` à ${r.flaschengroesse_ml} ml` : ''}` : null, r.rekonstruiert ? 'rekonstruiert' : null].filter(Boolean).join(' · ') || null,
    }
  }

  const buchungen: BsmBuchung[] = []
  const belege = new Map<number, R[]>()
  for (const r of imZeitraum) belege.set(r.beleg_nr, [...(belege.get(r.beleg_nr) ?? []), r])
  for (const [, rs] of [...belege].sort((a, b) => a[0] - b[0])) {
    const mitStorno = rs.some(r => r.storno_von_id || gegengebucht.has(r.id))
    const umstufung = rs.filter(r => /_merkmale$/.test(String(r.quelle_tabelle)))
    const rest = rs.filter(r => !umstufung.includes(r))
    // Umstufungspaar der Datenbank: ohne Zellwechsel entfällt es, Most/Sturm ↔ Wein → UMST_MOST, sonst AB_ABW/ZU_ABW
    if (umstufung.length > 0) {
      const b = umstufung.map(zuBuchung).filter((x): x is BsmBuchung => !!x)
      const ab = b.filter(x => x.liter < 0), zu = b.filter(x => x.liter > 0)
      const gleich = ab.length > 0 && zu.length > 0 && ab.every(a => zu.some(x => zellSchluesselVon(x) === zellSchluesselVon(a)))
      if (!gleich) {
        const most = b.some(x => x.spalte === 'most_sturm')
        if (most) for (const x of b) x.code = UMSTUFUNG_MOST
        else if (!mitStorno && ab.length > 0 && zu.length > 0 && (spalteRang(zu[0].spalte) ?? -1) > (spalteRang(ab[0].spalte) ?? 99)) aufwertungen.push(`${b[0].charge ?? b[0].fuellung ?? 'Umstufung'} (${datumAT(b[0].datum)})`)
        buchungen.push(...b)
      }
    }
    const b = rest.map(zuBuchung).filter((x): x is BsmBuchung => !!x)
    const titel = `${b[0]?.vorgang ?? 'Beleg'} J ${rs[0].beleg_nr} (${datumAT(tag(rs[0].datum))})`
    buchungen.push(...(mitStorno || !b.some(x => NEUTRALE_CODES.has(x.code)) ? b : abwertungsAusgleichMit(b, titel, aufwertungen, gemischt)))
  }

  // Zukauf Trauben/Maische: Beleg in kg nur als Info-Zeile (gezählt ist ZK_TRAUB/ZK_MAISC aus der Pressung im Journal)
  const ti = traubenInfo(zusatz, z, zelle)
  buchungen.push(...ti.zeilen)
  const traubenLiter = l2(buchungen.filter(r => r.code === 'ZK_TRAUB').reduce((s, r) => s + r.liter, 0))
  const maischeLiter = l2(buchungen.filter(r => r.code === 'ZK_MAISC').reduce((s, r) => s + r.liter, 0))
  buchungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // ── Hinweise zur Rechengrundlage ──
  warnungen.push(`Rechengrundlage: Bewegungsjournal (ab ${datumAT(opts.journalAb)}) – Merkmale zum Buchungszeitpunkt.`)
  if (opts.journalAb > z.von) warnungen.push(`Das Bewegungsjournal beginnt am ${datumAT(opts.journalAb)}, nach dem Beginn des Zeitraums – Bewegungen davor sind nur über den Eröffnungsbestand enthalten.`)
  if (opts.abweichungen) warnungen.push(`Das Bewegungsjournal weicht heute bei ${anzahl(opts.abweichungen, 'Posten', 'Posten')} vom Bestand ab (Kellerbuch › Bewegungsjournal); der tägliche Abgleich bucht Mengenänderungen ohne Bewegung als Inventurdifferenz nach.`)
  const rekonstruiert = imZeitraum.filter(r => r.rekonstruiert).length
  if (rekonstruiert > 0) warnungen.push(`${anzahl(rekonstruiert, 'Journalzeile ist', 'Journalzeilen sind')} rückwirkend rekonstruiert (Testbetrieb) – Merkmale dort aus den Stammdaten zum Zeitpunkt der Rückbefüllung.`)

  return bsmAbschliessen({
    z, anfangAm, heute, buchungen, anfang, stichtag, traubenKg: ti.traubenKg, traubenLiter, maischeKg: ti.maischeKg, maischeLiter, warnungen, aufwertungen, gemischt,
    nichtGepresst: ti.nichtGepresst, altbestandMinus, negativ, ohneStufe, ohneFarbe, landUnbekannt, lieferortKundenland,
    kundeLandUnbekannt, nichtRelevant, lieferlandErfasst: false, ohneDatum: 0, deaktiviertOhneDatum: 0,
    gliederungsHinweis: 'Gliederung zum Buchungszeitpunkt aus dem Bewegungsjournal: Qualitätsstufe, Zusatz, Erzeugnis, Farbe (Rosé = rot), Rebsorte, Jahrgang, Ursprungsland und Status der Charge (Ernte/Gärung = Most/Sturm) wie bei der Buchung festgehalten; Inland/Ausland nach dem Land des Käufers bei der Buchung.',
    stichtagBezeichnung: `Bestand zum Stichtag ${datumAT(z.bis)} (laut Bewegungsjournal)`,
    quelle: 'journal',
  })
}

/** Zellschlüssel Herkunft|Gebinde|Spalte|Farbe (wie die Aggregation) */
const zellSchluesselVon = (x: BsmZelle) => `${x.herkunft}|${x.gebinde}|${x.spalte ?? 'ohne'}|${x.farbe ?? '-'}`

/** Hinweis zur Gliederung der rekonstruierten BSM (ohne Bewegungsjournal) */
const gliederungRekonstruktion = (heute: string) => `Gliederung zum Buchungszeitpunkt: Qualitätsstufe aus den Momentaufnahmen von Verschnitt und Umzug, sonst die heutige; Farbe (Rosé = rot), Rebsorte, Jahrgang und Ursprungsland sind die heutigen Stammdaten (ohne Bewegungsjournal); Most/Sturm nach Erzeugnis bzw. Stufe, sonst nach dem heutigen Status der Charge (Ernte/Gärung – ohne Statusverlauf zählt eine heute ausgebaute Charge auch während ihrer Gärung als Wein). Bestände sind aus dem heutigen Bestand zurückgerechnet (Stand ${datumAT(heute)}).`

/** Bestand einer Zelle (Anfangs- bzw. Stichtagsbestand) */
type BestandsZelle = BsmZelle & { liter: number }

/**
 * Gruppe neutraler Umbuchungen: wechselt die Spalte, werden die Zeilen zu AB_ABW/ZU_ABW (R9). Wechselt Most/Sturm in
 * eine Weinspalte (oder zurück), ist das keine Abwertung: dieser Teil wird zu UMST_MOST (Nachtrag 4, Saldo 0).
 */
function abwertungsAusgleichMit(zeilen: BsmBuchung[], name: string, aufwertungen: string[], gemischt: string[]): BsmBuchung[] {
  const neutral = zeilen.filter(r => NEUTRALE_CODES.has(r.code))
  const netto = new Map<string, number>()
  for (const r of neutral) netto.set(r.spalte ?? 'ohne', l2((netto.get(r.spalte ?? 'ohne') ?? 0) + r.liter))
  const offen = [...netto].filter(([, v]) => Math.abs(v) >= NULL_UNTER)
  if (offen.length === 0) return zeilen
  if (new Set(neutral.map(r => `${r.farbe}|${r.herkunft}`)).size > 1) { gemischt.push(name); return zeilen }
  const aus = [...zeilen]
  /** `menge` Liter der noch neutralen Zeilen einer Spalte (Vorzeichen vz) auf `code` umbuchen */
  const umbuchen = (sp: string, vz: number, menge: number, code: string, text: string) => {
    let rest = menge
    for (const r of neutral) {
      if (rest < NULL_UNTER) break
      if (!NEUTRALE_CODES.has(r.code) || (r.spalte ?? 'ohne') !== sp || Math.sign(r.liter) !== vz) continue
      const hinweis = [r.hinweis, text].filter(Boolean).join(' · ')
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
  const mostNetto = netto.get('most_sturm') ?? 0
  let umstufungRest = Math.abs(mostNetto) >= NULL_UNTER ? Math.abs(mostNetto) : 0
  for (const [sp, n] of offen) {
    const vz = Math.sign(n)
    const menge = Math.abs(n)
    let umstufung = 0
    if (sp === 'most_sturm') umstufung = menge
    else if (umstufungRest > 0 && vz === -Math.sign(mostNetto)) {
      umstufung = Math.min(menge, umstufungRest)
      umstufungRest = l2(umstufungRest - umstufung)
    }
    if (umstufung >= NULL_UNTER) umbuchen(sp, vz, umstufung, UMSTUFUNG_MOST, mostNetto < 0 ? 'Most/Sturm wird Wein' : 'Wein zurück zu Most/Sturm')
    if (menge - umstufung >= NULL_UNTER) umbuchen(sp, vz, l2(menge - umstufung), vz < 0 ? 'AB_ABW' : 'ZU_ABW', 'BSM-Spalte gewechselt')
  }
  // Aufwertung: das Ergebnis liegt in einer höheren Spalte als jede Quelle (Most/Sturm hat keinen Rang)
  const rang = (wert: number) => offen.filter(([, v]) => Math.sign(v) === wert).map(([s]) => spalteRang(s === 'ohne' ? null : s as MeldeSpalte)).filter((x): x is number => x !== null)
  const zu = rang(1), ab = rang(-1)
  if (zu.length > 0 && ab.length > 0 && Math.max(...zu) > Math.max(...ab)) aufwertungen.push(name)
  return aus
}

/** Zukauf Trauben bzw. Maische (KAN-41): Beleg in kg nur als Info-Zeile (Nachtrag 1) – gemeinsam für Rekonstruktion und Journal */
function traubenInfo(zusatz: BsmZusatz, z: BsmZeitraum, zelle: (m: Merkmale, gebinde: Gebinde, name: string) => BsmZelle | null): { zeilen: BsmBuchung[]; traubenKg: number; maischeKg: number; nichtGepresst: string[] } {
  const zeilen: BsmBuchung[] = []
  let traubenKg = 0
  let maischeKg = 0
  const nichtGepresst: string[] = []
  // ── 3. Zukauf Trauben: Beleg in kg nur als Info-Zeile (nicht in der Literrechnung, Nachtrag 1) ──
  // Gezählt wird der gepresste Most (ZK_TRAUB aus der Pressung, oben); hier nur Beleg, Vorschlag und offene Restmenge.
  /** bis zum Zeitraumende gepresste kg je zukauf_posten (aktive Zeilen nicht stornierter Pressungen) */
  const gepresstBis = new Map<string, number>()
  for (const pw of zusatz.pressungWeingaerten ?? []) {
    const press = pw.pressung as R | null
    if (!pw.zukauf_posten_id || pw.storniert_am || press?.storniert_am || !tag(press?.datum) || tag(press?.datum) > z.bis) continue
    gepresstBis.set(pw.zukauf_posten_id, (gepresstBis.get(pw.zukauf_posten_id) ?? 0) + Math.max(0, zahlOderNull(pw.trauben_kg) ?? 0))
  }
  for (const t of zusatz.traubenZukauf) {
    const d = tag(t.datum)
    if (!d || d < z.von || d > z.bis) continue
    const kg = zahlOderNull(t.menge) ?? 0
    if (kg <= 0) continue
    const maischeBeleg = t.art === 'maische'
    const name = `Zukauf ${maischeBeleg ? 'Maische' : 'Trauben'} ${[textOderNull(t.rebsorte), zahlOderNull(t.jahrgang)].filter(Boolean).join(' ')}`.trim()
    const zl = zelle({ angabe: normalisiereQualitaet(t), weinart: textOderNull(t.weinart), rebsorte: textOderNull(t.rebsorte), jahrgang: zahlOderNull(t.jahrgang), land: textOderNull(t.land_iso) }, 'offen', name)
    if (!zl) continue
    if (maischeBeleg) maischeKg = runden(maischeKg + kg, STELLEN.kgGenau)
    else traubenKg = runden(traubenKg + kg, STELLEN.kgGenau)
    const offenKg = runden(kg - (gepresstBis.get(t.id) ?? 0), STELLEN.kgGenau)
    if (offenKg >= KG_TOLERANZ) nichtGepresst.push(`${name} (${fmtNum(offenKg, 0)} kg)`)
    const lf = momentaufnahmeAnwenden({ ...t }, ['lieferant_firma', 'lieferant_kontakt'])
    zeilen.push({
      ...zl, datum: d, code: maischeBeleg ? 'ZK_MAISC' : 'ZK_TRAUB', liter: 0, kg,
      vorgang: name, charge: null, fuellung: null,
      gegenstelle: textOderNull((lf.lieferant_firma as R | null)?.name) ?? textOderNull([(lf.lieferant_kontakt as R | null)?.vorname, (lf.lieferant_kontakt as R | null)?.nachname].filter(Boolean).join(' ')),
      beleg: textOderNull(t.eingangsrechnungsnummer), storno: null,
      hinweis: [
        `Info: Beleg in ${textOderNull(t.einheit) ?? 'kg'}, nicht in der Literrechnung – gezählt wird der Most aus der Pressung`,
        `Vorschlag ≈ ${fmtL(l2(kg * TRAUBEN_LITER_JE_KG_VORSCHLAG))} (${fmtNum(TRAUBEN_LITER_JE_KG_VORSCHLAG, 1)} l/kg), tatsächliche Menge nach Pressung`,
        offenKg >= KG_TOLERANZ ? `bis ${datumAT(z.bis)} noch ${fmtNum(offenKg, 0)} kg nicht gepresst` : null,
      ].filter(Boolean).join(' · '),
    })
  }
  // KAN-41 Paket 3c: Traubenverkauf – nur nachrichtlich in kg (kein Weinbestand, TRAUBVK ist keine BSM-Buchungsart)
  for (const t of zusatz.traubenverkauf ?? []) {
    const d = tag(t.datum)
    if (!d || d < z.von || d > z.bis || (t.verkaufsposten as R | null)?.storniert) continue
    const kg = zahlOderNull(t.menge_kg) ?? 0
    if (kg <= 0) continue
    const rebsorte = textOderNull((t.grundstueck as R | null)?.rebsorte) ?? textOderNull((t.weingarten as R | null)?.rebsorte) ?? textOderNull((t.zukauf as R | null)?.rebsorte)
    const jahrgang = zahlOderNull((t.jahrgang as R | null)?.jahrgang)
    const name = `Traubenverkauf ${[rebsorte, jahrgang].filter(Boolean).join(' ')}`.trim()
    const zl = zelle({ angabe: normalisiereQualitaet(t), weinart: textOderNull((t.zukauf as R | null)?.weinart), rebsorte, jahrgang, land: 'AT' }, 'offen', name)
    if (!zl) continue
    const p = momentaufnahmeAnwenden({ ...t }, ['kontakt', 'firma'])
    zeilen.push({
      ...zl, datum: d, code: 'TRAUBVK', liter: 0, kg,
      vorgang: name, charge: null, fuellung: null,
      gegenstelle: textOderNull((p.firma as R | null)?.name) ?? textOderNull([(p.kontakt as R | null)?.vorname, (p.kontakt as R | null)?.nachname].filter(Boolean).join(' ')),
      beleg: textOderNull(t.liefernummer), storno: null,
      hinweis: 'Info: Traubenverkauf in kg – kein Weinbestand, nicht in der Literrechnung',
    })
  }
  return { zeilen, traubenKg, maischeKg, nichtGepresst }
}

/** Eingabe des gemeinsamen Abschlusses (Aggregation, Summentabelle, Prüfhinweise) */
type BsmAbschluss = {
  z: BsmZeitraum
  anfangAm: string
  heute: string
  buchungen: BsmBuchung[]
  anfang: BestandsZelle[]
  stichtag: BestandsZelle[]
  traubenKg: number
  traubenLiter: number
  maischeKg: number
  maischeLiter: number
  warnungen: string[]
  aufwertungen: string[]
  gemischt: string[]
  nichtGepresst: string[]
  altbestandMinus: { name: string; liter: number }[]
  negativ: string[]
  ohneStufe: Set<string>
  ohneFarbe: Set<string>
  landUnbekannt: Set<string>
  lieferortKundenland: Set<string>
  kundeLandUnbekannt: Set<string>
  nichtRelevant: Set<string>
  lieferlandErfasst?: boolean
  ohneDatum: number
  deaktiviertOhneDatum: number
  /** abschließender Hinweis zur Gliederung (Rekonstruktion bzw. Journal) */
  gliederungsHinweis: string
  /** Bezeichnung der Zeile STICHTAG (Standard: Bestandsermittlung) */
  stichtagBezeichnung?: string
  /** Quelle der Rechnung */
  quelle: BsmQuelle
}

/** Aggregation je Position × Zelle, Summentabelle und Prüfhinweise – gemeinsam für Rekonstruktion und Journal */
function bsmAbschliessen(e: BsmAbschluss): BsmDaten {
  const {
    z, anfangAm, heute, buchungen, anfang, stichtag, traubenKg, traubenLiter, maischeKg, maischeLiter, warnungen, aufwertungen,
    gemischt, nichtGepresst, altbestandMinus, negativ, ohneStufe, ohneFarbe, landUnbekannt, lieferortKundenland, kundeLandUnbekannt,
    nichtRelevant, lieferlandErfasst, ohneDatum, deaktiviertOhneDatum, gliederungsHinweis, stichtagBezeichnung, quelle,
  } = e
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
  const leereWerte = (): Record<SpalteSchluessel, number> => ({ most_sturm: 0, wein: 0, rebsortenwein: 0, landwein: 0, qualitaetswein: 0, praedikatswein: 0, perl_schaumwein: 0, sonstige: 0, ohne: 0 })
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
      const belegKg = code === 'ZK_TRAUB' ? traubenKg : code === 'ZK_MAISC' ? maischeKg : null
      summen.push(belegKg !== null && (belegKg > 0 || hatWert(gesamt)) ? { ...gesamt, bezeichnung: `${gesamt.bezeichnung} – Most aus der Pressung in l${belegKg > 0 ? ` (Beleg ${fmtNum(belegKg, 0)} kg, nur nachrichtlich)` : ''}` } : gesamt)
      if (hatWert(gesamt)) for (const [teil, filter] of FARB_TEILE.slice(1)) { const zl = zeileFuer(h, code, buchungsartLabel(code), 'Zugang', teil, filter, 1); if (hatWert(zl) || teil !== 'davon ohne Farbe') summen.push(zl) }
    }
    block('INV_PLUS', 'Inventur-Mehrmenge (keine BSM-Buchungsart)', 'Zugang', FARB_TEILE, 1, false)
    for (const code of ABGANG) {
      const gesamt = zeileFuer(h, code, buchungsartLabel(code), 'Abgang', 'gesamt', () => true, -1)
      summen.push(gesamt)
      if (hatWert(gesamt)) for (const [teil, filter] of FARB_TEILE.slice(1)) { const zl = zeileFuer(h, code, buchungsartLabel(code), 'Abgang', teil, filter, -1); if (hatWert(zl) || teil !== 'davon ohne Farbe') summen.push(zl) }
    }
    block(UMSTUFUNG_MOST, 'Umstufung Most/Sturm → Wein (Spaltenwechsel ohne Abwertung)', 'Umstufung', FARB_TEILE, 1, false)
    block('NEUTRAL', 'Umbuchungen ohne BSM-Buchungsart (Umzug, Filtration, Füllung) – Saldo', 'Prüfung', BESTAND_TEILE, 1, false)
    block('ENDE', `Endbestand lt. Rechnung (${datumAT(z.bis)})`, 'Bestand', BESTAND_TEILE, 1, true)
    block('STICHTAG', stichtagBezeichnung ?? `Bestand zum Stichtag ${datumAT(z.bis)} (Bestandsermittlung)`, 'Bestand', BESTAND_TEILE, 1, true)
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
  // KAN-41 Paket 2b: echte Flaschenzukäufe (Handelsware) ohne Prüfwarnung
  const zkFla = buchungen.filter(r => r.code === 'ZK_FLA' && !(r.hinweis ?? '').includes(HANDELSWARE_HINWEIS)).length
  if (zkFla > 0) warnungen.push(`${anzahl(zkFla, 'Flaschenzugang', 'Flaschenzugänge')} ohne Charge (weder Abfüllung aus dem Keller noch Eröffnungsbestand) als „Zukauf Flaschen“ gezählt – bitte prüfen.`)
  if (traubenKg > 0 || Math.abs(traubenLiter) >= NULL_UNTER) warnungen.push(`Zukauf Trauben: gezählt ist der Most aus Pressungen zugekaufter Trauben (anteilig nach Trauben-kg) mit ${fmtL(traubenLiter)}${traubenKg > 0 ? `; die Belege im Zeitraum (${fmtNum(traubenKg, 0)} kg, Vorschlag ≈ ${fmtL(l2(traubenKg * TRAUBEN_LITER_JE_KG_VORSCHLAG))} bei ${fmtNum(TRAUBEN_LITER_JE_KG_VORSCHLAG, 1)} l/kg) stehen nur nachrichtlich im Kontrolljournal` : ''}.`)
  if (maischeKg > 0 || Math.abs(maischeLiter) >= NULL_UNTER) warnungen.push(`Zukauf Maische: gezählt ist der Most aus Pressungen zugekaufter Maische (anteilig nach kg) mit ${fmtL(maischeLiter)}${maischeKg > 0 ? `; die Belege im Zeitraum (${fmtNum(maischeKg, 0)} kg) stehen nur nachrichtlich im Kontrolljournal` : ''}.`)
  const traubenverkaufKg = buchungen.filter(r => r.code === 'TRAUBVK').reduce((s, r) => s + (r.kg ?? 0), 0)
  if (traubenverkaufKg > 0) warnungen.push(`Traubenverkauf im Zeitraum: ${fmtNum(traubenverkaufKg, 0)} kg – nur nachrichtlich im Kontrolljournal (TRAUBVK), kein Weinbestand.`)
  if (nichtGepresst.length > 0) warnungen.push(`${anzahl(nichtGepresst.length, 'Traubenzukauf ist', 'Traubenzukäufe sind')} bis ${datumAT(z.bis)} nicht (vollständig) gepresst – nur Hinweis, kein Bestand: ${auszug(nichtGepresst)}.`)
  const umstufung = summeCode(UMSTUFUNG_MOST)
  if (Math.abs(umstufung) >= NULL_UNTER) warnungen.push(`Umstufung Most/Sturm → Wein ergibt keinen Saldo 0 (${fmtL(umstufung)}) – Kontrolljournal (Filter ${UMSTUFUNG_MOST}) prüfen.`)
  const eroeff = summeCode('EROEFF')
  if (Math.abs(eroeff) >= NULL_UNTER) warnungen.push(`Eröffnungsbestand mit Stichtag im Zeitraum (${fmtL(eroeff)}) ist im Anfangsbestand enthalten.`)
  const eroeffMinus = buchungen.filter(r => r.code === 'EROEFF' && r.liter < 0)
  if (eroeffMinus.length > 0) warnungen.push(`${anzahl(eroeffMinus.length, 'Eröffnungsbuchung ist', 'Eröffnungsbuchungen sind')} negativ (zusammen ${fmtL(l2(eroeffMinus.reduce((s, r) => s + r.liter, 0)))}) und ${eroeffMinus.length === 1 ? 'mindert' : 'mindern'} den Anfangsbestand – bitte prüfen: ${auszug(eroeffMinus.map(r => r.fuellung ?? r.charge ?? r.vorgang))}.`)
  if (altbestandMinus.length > 0) warnungen.push(`${anzahl(altbestandMinus.length, 'Flaschenbuchung', 'Flaschenbuchungen')} „Anfangsbestand (Altbestand, ±)“ mit negativer Menge (zusammen ${fmtL(l2(-altbestandMinus.reduce((s, r) => s + r.liter, 0)))}) ${altbestandMinus.length === 1 ? 'ist' : 'sind'} als Abgang Eigenverbrauch/Schwund gezählt (Altbestand-Korrektur, keine Eröffnung) – waren es Verkäufe, bitte als Verkauf erfassen: ${auszug(altbestandMinus.map(r => r.name))}.`)
  for (const [k, d] of diff) warnungen.push(`Abgleich: ${zellText(k)} – Bestand zum ${datumAT(z.bis)} weicht um ${fmtL(d)} von der Rechnung ab (Bestand ohne Buchung, negativer Posten oder Merkmalswechsel ohne Buchung).`)
  for (const [k, v] of ende) if (v <= -NULL_UNTER) warnungen.push(`Negativer Endbestand lt. Rechnung: ${zellText(k)} ${fmtL(v)}.`)
  if (negativ.length > 0) warnungen.push(`${anzahl(negativ.length, 'Posten ergibt', 'Posten ergeben')} einen negativen Bestand und ${negativ.length === 1 ? 'ist' : 'sind'} im Anfangs- bzw. Stichtagsbestand nicht enthalten: ${auszug(negativ)}.`)
  if (ohneStufe.size > 0) warnungen.push(`${anzahl(ohneStufe.size, 'Wein', 'Weine')} ohne Qualitätsstufe – als Wein bzw. Rebsortenwein gezählt: ${auszug([...ohneStufe])}.`)
  if (ohneFarbe.size > 0) warnungen.push(`${anzahl(ohneFarbe.size, 'Wein', 'Weine')} ohne bestimmbare Farbe (weder Weinart noch eindeutige Rebsorte) – Zeile „davon ohne Farbe“: ${auszug([...ohneFarbe])}.`)
  if (landUnbekannt.size > 0) warnungen.push(`${anzahl(landUnbekannt.size, 'Wein', 'Weine')} ohne Ursprungsland – als Österreich gezählt: ${auszug([...landUnbekannt])}.`)
  if (lieferortKundenland.size > 0) warnungen.push(`${anzahl(lieferortKundenland.size, 'Verkauf', 'Verkäufe')}: Lieferort unbekannt, Land des Kunden verwendet${lieferlandErfasst === false ? ' (Lieferland am Verkauf wird noch nicht erfasst)' : ''} – Inland/Ausland nach dem Land der Firma bzw. des Kontakts.`)
  if (kundeLandUnbekannt.size > 0) warnungen.push(`${anzahl(kundeLandUnbekannt.size, 'Verkauf', 'Verkäufe')} ohne Lieferort und ohne Land beim Kunden – als Verkauf in Österreich gezählt.`)
  if (nichtRelevant.size > 0) warnungen.push(`${anzahl(nichtRelevant.size, 'Posten', 'Posten')} nicht bestandsmeldepflichtig (Traubensaft) – nicht enthalten: ${auszug([...nichtRelevant])}.`)
  if (ohneDatum > 0) warnungen.push(`${anzahl(ohneDatum, 'Kellerbuchung hat', 'Kellerbuchungen haben')} kein Datum – sie zählen zum Anfangsbestand.`)
  if (deaktiviertOhneDatum > 0) warnungen.push(`${anzahl(deaktiviertOhneDatum, 'deaktivierte Füllung', 'deaktivierte Füllungen')} mit Restbestand ohne Storno-Datum – nicht enthalten.`)
  warnungen.push(gliederungsHinweis)

  return {
    zeitraum: z, anfangAm, heute, istWeinwirtschaftsjahr: istWeinwirtschaftsjahr(z),
    buchungen, summen, herkuenfte, spalten, traubenKg, traubenLiter, maischeKg, maischeLiter, warnungen, quelle,
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
    sp === 'ohne' ? SPALTE_OHNE_LABEL : spalteLabel(sp as MeldeSpalte),
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
