// ── Gültigkeit der staatlichen Prüfnummer einer Charge (KAN-72, 25.09.2026) ──
//
// Reiner Kern ohne Importe (isomorph, node:test-fähig: scripts/tests/pruefnummer.test.mjs).
// Die Daten lädt lib/kellerbuch/pruefnummerLaden.ts. EINE Auswahlregel für Blend-Protokoll
// (Charge), Transportbescheinigung (Tankverkauf) und Füllungsformular (Vorschlag + Server-
// prüfung) – bisher nahm das Blend-Protokoll den jüngsten, die TBS den ältesten Antrag mit
// Nummer, beide ohne Status, Datum oder Menge zu prüfen.
//
// Eine Prüfnummer gilt für die Charge am Stichtag, wenn
//   1. der Antrag genehmigt und aktiv ist und eine Nummer trägt,
//   2. nach der Einreichung (eingereicht_am) bis zum Stichtag kein Zugang, Verschnitt, Zukauf
//      oder keine Pressung mit der Charge als ZIEL gebucht wurde (§ 25 Abs. 6 WeinG) – Abgänge
//      (Füllung, Tankverkauf, Schwund, Umzug/Verschnitt als Quelle) schaden nicht,
//   3. der Bestand höchstens der beantragten Menge minus der seither abgefüllten Menge
//      entspricht (Sicherung gegen Mehrmengen ohne Zugangsbuchung).
// Gelten mehrere genehmigte Anträge, zählt der zuletzt eingereichte bis zum Stichtag.
//
// Annahmen (offen, siehe KAN-38 – nicht hier entscheiden):
//   * Maßgeblich ist eingereicht_am, nicht bescheid_am: ein Verschnitt nach der Einreichung,
//     aber vor dem Bescheid zählt schon. Ob das rechtlich bereits ein Verstoß ist, klärt KAN-38.
//   * Buchungen AM Einreichungstag gelten als davor (Probe nach dem letzten Verschnitt des
//     Tages gezogen).
//   * Fehlt eingereicht_am: bei einem Entwurf gibt es noch keine Probe – keine Zugangsregel,
//     nur die Mengenregel. Sonst (Altdaten, nachträglich erfasster Antrag) gilt der frühere von
//     Anlage- und Bescheidtag – der Bescheid liegt immer nach der Einreichung.
//   * Zugänge ohne Datum werden nicht gewertet (z. B. Pressung ohne Datum = Herkunft).
//   * Mengenregel nur, wenn der Bestand am Stichtag bekannt ist: der Lader liefert den
//     aktuellen Bestand (bestandAm = heute). Für einen Stichtag in der Vergangenheit (z. B.
//     Verkaufsdatum der TBS) entfällt sie – mengeGeprueft: false. Keine Messtoleranz (nur die
//     Rundung von numeric(10,2)): eine gerundete Antragsmenge oder ein Antrag über eine
//     Teilmenge des Gebindes lässt die Nummer der Charge nicht gelten, bis der Bestand passt
//     (Messdifferenz als Schwund buchen bzw. Antragsmenge korrigieren) – fachlich offen.
//   * Ab wann es die Nummer gibt: für Blend-Protokoll und Füllung ab der Einreichung (die
//     Flaschen tragen die später erteilte Nummer); für die TBS (Transport an einem bestimmten
//     Tag) erst ab dem Bescheid – Option bescheidBisStichtag.
//   * Umzüge geben die Nummer nicht weiter: eine durch Umzug entstandene Charge hat keinen
//     eigenen Antrag, Blend-Protokoll und TBS zeigen für sie keine Nummer (bis KAN-99). Die
//     Füllung nimmt die Nummer dort als freie Eingabe an, wenn die Charge nur über Umzüge aus
//     der Antrags-Charge stammt und die Nummer beim Umzug galt (freiePruefnummerPruefen).
//
// Grundlage für KAN-83 (Warnung „Prüfnummer gilt nicht mehr“ bei Verschnitt/Umzug/Zugang)
// und KAN-84 (Füllung: Merkmale serverseitig aus der Charge); KAN-99 ersetzt die Ableitung
// später durch eine Tabelle pruefnummer_chargen – die Signaturen hier bleiben dafür stabil
// (Erweiterungen nur über optionale Felder und Parameter).

/** DAC-/Prüfnummernantrag (Tabelle dac_antrag), Tage als 'JJJJ-MM-TT' */
export type PnAntrag = {
  id: string
  weinausbauId: string | null
  status: string
  aktiv: boolean
  pruefnummer: string | null
  /** beantragte Menge in l */
  mengeLiter: number | null
  eingereichtAm: string | null
  bescheidAm: string | null
  /** Anlagetag (created_at in Wiener Zeit) – Ersatz, wenn eingereicht_am fehlt */
  angelegtAm: string | null
  bezeichnung?: string | null
}

export type PnZugangArt = 'verschnitt' | 'zugang' | 'zukauf' | 'pressung'

/** Buchung mit der Charge als ZIEL: Verschnitt (verschneidungen), Zugang per Umzug aus einer
 *  anderen Charge (keller_umzuege), Zukauf (zukauf_posten), Pressung (pressung_behaelter) */
export type PnZugang = { art: PnZugangArt; datum: string | null; id?: string }

/** Füllung aus der Charge (für die Mengenregel) */
export type PnAbfuellung = { id?: string; datum: string | null; liter: number; dacAntragId: string | null }

export type PnChargeDaten = {
  chargeId: string
  /** Bestand in l am Tag bestandAm (Lader: aktueller Bestand, bestandAm = heute); null = unbekannt */
  bestandLiter: number | null
  bestandAm: string | null
  antraege: PnAntrag[]
  zugaenge: PnZugang[]
  abfuellungen: PnAbfuellung[]
}

export type PnGrund =
  | PnZugangArt                          // Buchung mit der Charge als Ziel nach der Einreichung
  | 'menge'                              // Bestand > beantragt − abgefüllt
  | 'nicht_genehmigt'                    // kein genehmigter, aktiver Antrag mit Nummer
  | 'nach_stichtag'                      // genehmigter Antrag erst nach dem Stichtag eingereicht
  | 'vor_bescheid'                       // Nummer erst nach dem Stichtag erteilt (bescheidBisStichtag)
  | 'kein_antrag'                        // Charge hat keinen DAC-Antrag

/** Woher der Beginn eines Antrags stammt: Einreichung oder Ersatz (Anlage-/Bescheidtag) */
export type PnBeginnQuelle = 'eingereicht' | 'angelegt' | 'bescheid'

export type PnMenge = { bestandLiter: number; beantragtLiter: number; abgefuelltLiter: number; zulaessigLiter: number }

export type PnErgebnis = {
  gueltig: boolean
  /** gültig: die Nummer; ungültig: die nicht (mehr) geltende Nummer für den Hinweis, sonst null */
  pruefnummer: string | null
  antragId: string | null
  grund: PnGrund | null
  /** Tag der ersten schädlichen Buchung (Zugangsarten), der Einreichung (nach_stichtag) bzw. des Bescheids (vor_bescheid) */
  ereignisDatum: string | null
  menge: PnMenge | null
  /** false: Mengenregel nicht geprüft (Bestand am Stichtag unbekannt oder keine beantragte Menge) */
  mengeGeprueft: boolean
  /** nach_stichtag: ob ereignisDatum die Einreichung ist oder ein Ersatz (Anlage-/Bescheidtag) */
  beginnQuelle?: PnBeginnQuelle | null
}

export type PnOptionen = {
  /** Nummer erst ab dem Bescheid statt ab der Einreichung (TBS: Transport an einem Tag) */
  bescheidBisStichtag?: boolean
}

export type PnVerletzung = { grund: PnZugangArt | 'menge'; ereignisDatum: string | null; menge: PnMenge | null }

/**
 * Herkunft einer Charge ohne eigenen Antrag über Umzüge (Abstich, Filtration in ein anderes
 * Gebinde): sie stammt ausschließlich aus der Charge `daten.chargeId`, die einen DAC-Antrag
 * hat – ohne Verschnitt, Zukauf, Pressung oder Eröffnungsbestand in der Kette.
 */
export type PnUmzugsherkunft = {
  /** Daten der Charge mit dem DAC-Antrag */
  daten: PnChargeDaten
  name?: string | null
  /** letzter Umzug aus dieser Charge in die Kette – Stichtag für die Gültigkeit der Nummer */
  umzugAm: string
}

/** Status, unter denen ein Antrag noch offen ist (Füllung darf ihn ohne Nummer verknüpfen) */
export const PN_OFFENE_STATUS = ['entwurf', 'eingereicht', 'in_pruefung'] as const

const TAG_RE = /^\d{4}-\d{2}-\d{2}/
/** Toleranz wie numeric(10,2) */
const RUNDUNG = 0.005

/** Kalendertag 'JJJJ-MM-TT' aus DATE/Text; sonst null */
export function pnTag(v: unknown): string | null {
  return typeof v === 'string' && TAG_RE.test(v) ? v.slice(0, 10) : null
}

function nummer(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/** Prüfnummer zum Vergleichen: ohne Leerzeichen, Großbuchstaben („n10716/26“ = „N 10716/26“) */
export function pnNormiert(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, '').toUpperCase()
}

const r2 = (x: number) => Math.round(x * 100) / 100

/**
 * Beginn eines Antrags für die Zugangsregel samt Herkunft des Datums: die Einreichung; fehlt sie,
 * bei einem Entwurf null (noch keine Probe – keine Zugangsregel), sonst der frühere von Anlage-
 * und Bescheidtag (ein nachträglich erfasster Antrag ist nach seinem Bescheid angelegt).
 */
export function antragBeginnMitQuelle(a: PnAntrag): { tag: string; quelle: PnBeginnQuelle } | null {
  const eingereicht = pnTag(a.eingereichtAm)
  if (eingereicht) return { tag: eingereicht, quelle: 'eingereicht' }
  if (a.status === 'entwurf') return null
  const angelegt = pnTag(a.angelegtAm), bescheid = pnTag(a.bescheidAm)
  if (angelegt && (!bescheid || angelegt <= bescheid)) return { tag: angelegt, quelle: 'angelegt' }
  return bescheid ? { tag: bescheid, quelle: 'bescheid' } : null
}

/** Beginn eines Antrags für die Zugangsregel (siehe antragBeginnMitQuelle); null = keine Zugangsregel */
export function antragBeginn(a: PnAntrag): string | null {
  return antragBeginnMitQuelle(a)?.tag ?? null
}

/** Genehmigt, aktiv und mit Nummer? */
export function antragGenehmigt(a: PnAntrag): boolean {
  return a.status === 'genehmigt' && a.aktiv === true && nummer(a.pruefnummer) !== null
}

/**
 * Nummer eines bestimmten Antrags (Füllung → fuellungen.dac_antrag_id): nur genehmigt und aktiv,
 * und – wenn `chargeId` übergeben ist (Charge der Füllung, auch null) – nur, wenn der Antrag zu
 * dieser Charge gehört. Für Füllungen gilt die Nummer der Abfüllung – spätere Zugänge der Charge
 * betreffen die Flaschen nicht mehr (Blend-Protokoll der Füllung, TBS-Flaschenposition).
 */
export function pruefnummerAusAntrag(a: PnAntrag | null | undefined, chargeId?: string | null): string | null {
  if (!a || !antragGenehmigt(a)) return null
  if (chargeId !== undefined && a.weinausbauId !== (chargeId ?? null)) return null
  return nummer(a.pruefnummer)
}

function neuesteZuerst(a: PnAntrag, b: PnAntrag): number {
  const x = antragBeginn(a) ?? '', y = antragBeginn(b) ?? ''
  if (x !== y) return x < y ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

const ART_REIHENFOLGE: Record<PnZugangArt, number> = { verschnitt: 0, zukauf: 1, pressung: 2, zugang: 3 }

/** Zugänge mit von < Datum ≤ bis (von = null: ohne Untergrenze), früheste zuerst */
function zugaengeZwischen(zugaenge: readonly PnZugang[], von: string | null, bis: string): PnZugang[] {
  return zugaenge
    .filter(z => {
      const d = pnTag(z.datum)
      return d !== null && (von === null || d > von) && d <= bis
    })
    .sort((a, b) => (a.datum! < b.datum! ? -1 : a.datum! > b.datum! ? 1 : ART_REIHENFOLGE[a.art] - ART_REIHENFOLGE[b.art]))
}

/**
 * Regeln 2 und 3 für einen bestimmten Antrag – unabhängig von seinem Status (auch für
 * offene Anträge, die eine Füllung ohne Nummer verknüpft). null = keine Verletzung.
 */
export function antragVerletzung(antrag: PnAntrag, daten: PnChargeDaten, stichtag: string): PnVerletzung | null {
  const beginn = antragBeginn(antrag)
  // Regel 2: Zugänge nach der Einreichung (am Einreichungstag: davor) bis einschließlich Stichtag;
  // ohne Beginn (Entwurf, noch keine Probe) keine Zugangsregel
  const schaedlich = beginn === null ? [] : zugaengeZwischen(daten.zugaenge, beginn, stichtag)
  if (schaedlich.length > 0) return { grund: schaedlich[0].art, ereignisDatum: pnTag(schaedlich[0].datum), menge: null }

  // Regel 3: Bestand ≤ beantragt − seither abgefüllt (nur mit Bestand am Stichtag)
  const m = mengeRegel(antrag, daten, stichtag)
  if (m && m.bestandLiter > m.zulaessigLiter + RUNDUNG) return { grund: 'menge', ereignisDatum: null, menge: m }
  return null
}

/** Zahlen der Mengenregel; null = nicht prüfbar */
function mengeRegel(antrag: PnAntrag, daten: PnChargeDaten, stichtag: string): PnMenge | null {
  const bestandAm = pnTag(daten.bestandAm)
  if (antrag.mengeLiter === null || !Number.isFinite(antrag.mengeLiter)) return null
  if (daten.bestandLiter === null || !Number.isFinite(daten.bestandLiter) || bestandAm === null || stichtag < bestandAm) return null
  const beginn = antragBeginn(antrag)
  // Abgefüllt: Füllungen mit diesem Antrag oder nach der Einreichung. Alle, nicht nur bis zum
  // Stichtag – der Bestand (bestandAm) ist um jede erfasste Füllung schon gemindert.
  const abgefuellt = daten.abfuellungen
    .filter(f => f.dacAntragId === antrag.id || (beginn !== null && (pnTag(f.datum) ?? '') > beginn))
    .reduce((s, f) => s + (Number.isFinite(f.liter) ? f.liter : 0), 0)
  return {
    bestandLiter: r2(daten.bestandLiter),
    beantragtLiter: r2(antrag.mengeLiter),
    abgefuelltLiter: r2(abgefuellt),
    zulaessigLiter: r2(antrag.mengeLiter - abgefuellt),
  }
}

/**
 * Gilt eine Prüfnummer für die Charge am Stichtag ('JJJJ-MM-TT')? Liefert die Nummer bzw.
 * den Grund, warum sie nicht (mehr) gilt – die Oberfläche formuliert daraus den Hinweis
 * (pruefnummerHinweis). `opts.bescheidBisStichtag`: die Nummer gibt es erst ab dem Bescheid.
 */
export function pruefnummerGueltig(charge: PnChargeDaten, stichtag: string, opts: PnOptionen = {}): PnErgebnis {
  const leer = { ereignisDatum: null, menge: null, mengeGeprueft: false }
  const eigene = charge.antraege.filter(a => a.weinausbauId === charge.chargeId)
  if (eigene.length === 0) return { gueltig: false, pruefnummer: null, antragId: null, grund: 'kein_antrag', ...leer }

  const genehmigt = eigene.filter(antragGenehmigt).sort(neuesteZuerst)
  const bisStichtag = genehmigt.filter(a => { const b = antragBeginn(a); return b === null || b <= stichtag })
  if (bisStichtag.length === 0) {
    if (genehmigt.length > 0) {
      const a = genehmigt[genehmigt.length - 1]   // ältester: ab ihm gäbe es eine Nummer
      const b = antragBeginnMitQuelle(a)
      return { gueltig: false, pruefnummer: nummer(a.pruefnummer), antragId: a.id, grund: 'nach_stichtag', ...leer, ereignisDatum: b?.tag ?? null, beginnQuelle: b?.quelle ?? null }
    }
    // Kein genehmigter, aktiver Antrag: eine frühere Nummer (inaktiv, abgelehnt …) nur für den Hinweis
    const alle = [...eigene].sort(neuesteZuerst)
    const mitNummer = alle.find(a => nummer(a.pruefnummer) !== null) ?? null
    return { gueltig: false, pruefnummer: nummer(mitNummer?.pruefnummer), antragId: (mitNummer ?? alle[0]).id, grund: 'nicht_genehmigt', ...leer }
  }

  const a = bisStichtag[0]
  const pn = nummer(a.pruefnummer)
  const m = mengeRegel(a, charge, stichtag)
  const v = antragVerletzung(a, charge, stichtag)
  if (v) return { gueltig: false, pruefnummer: pn, antragId: a.id, grund: v.grund, ereignisDatum: v.ereignisDatum, menge: v.menge, mengeGeprueft: m !== null }
  const bescheid = pnTag(a.bescheidAm)
  if (opts.bescheidBisStichtag && bescheid !== null && bescheid > stichtag) {
    return { gueltig: false, pruefnummer: pn, antragId: a.id, grund: 'vor_bescheid', ereignisDatum: bescheid, menge: m, mengeGeprueft: m !== null }
  }
  return { gueltig: true, pruefnummer: pn, antragId: a.id, grund: null, ereignisDatum: null, menge: m, mengeGeprueft: m !== null }
}

/** „2026-09-25“ → „25.09.2026“ */
export function pnDatumDe(d: string | null | undefined): string {
  const t = pnTag(d)
  if (!t) return '–'
  const [j, m, tg] = t.split('-')
  return `${tg}.${m}.${j}`
}

const liter = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} l`

const ZUGANG_TEXT: Record<PnZugangArt, string> = {
  verschnitt: 'Verschnitt',
  zukauf: 'Zukauf',
  pressung: 'Pressung in die Charge',
  zugang: 'Zugang per Umzug',
}

/** Buchung mit der Charge als Ziel für Hinweise: „Verschnitt am 25.09.2026 (§ 25 Abs. 6 WeinG)“ */
export function pnZugangText(art: PnZugangArt, datum: string | null | undefined): string {
  return `${ZUGANG_TEXT[art]} am ${pnDatumDe(datum)} (§ 25 Abs. 6 WeinG)`
}

function istZugangArt(g: PnGrund | null): g is PnZugangArt {
  return g === 'verschnitt' || g === 'zugang' || g === 'zukauf' || g === 'pressung'
}

/**
 * Hinweis, wenn eine frühere Nummer nicht (mehr) gilt – null, wenn sie gilt oder es keine gibt.
 * `bezug` nennt den Bestand („den aktuellen Bestand“, „den Bestand am 01.09.2026“).
 */
export function pruefnummerHinweis(e: PnErgebnis, bezug = 'den aktuellen Bestand'): string | null {
  if (e.gueltig || !e.pruefnummer) return null
  const nr = e.pruefnummer
  if (istZugangArt(e.grund)) return `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: ${pnZugangText(e.grund, e.ereignisDatum)}.`
  switch (e.grund) {
    case 'menge': return e.menge
      ? `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: ${liter(e.menge.bestandLiter)} Bestand, beantragt waren ${liter(e.menge.beantragtLiter)}, davon ${liter(e.menge.abgefuelltLiter)} abgefüllt – höchstens ${liter(Math.max(0, e.menge.zulaessigLiter))} tragen die Nummer.`
      : `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: Bestand größer als die beantragte Menge.`
    case 'nicht_genehmigt': return `Prüfnummer ${nr} gilt nicht: Der DAC-Antrag ist nicht (mehr) genehmigt oder inaktiv.`
    case 'nach_stichtag':
      if (e.beginnQuelle === 'angelegt') return `Prüfnummer ${nr} gilt nicht für ${bezug}: Der DAC-Antrag wurde erst am ${pnDatumDe(e.ereignisDatum)} erfasst (Einreichungsdatum fehlt).`
      if (e.beginnQuelle === 'bescheid') return `Prüfnummer ${nr} gilt nicht für ${bezug}: Sie wurde erst mit dem Bescheid vom ${pnDatumDe(e.ereignisDatum)} erteilt (Einreichungsdatum fehlt).`
      return `Prüfnummer ${nr} gilt nicht für ${bezug}: Der DAC-Antrag wurde erst am ${pnDatumDe(e.ereignisDatum)} eingereicht.`
    case 'vor_bescheid': return `Prüfnummer ${nr} gilt nicht für ${bezug}: Sie wurde erst mit dem Bescheid vom ${pnDatumDe(e.ereignisDatum)} erteilt.`
    default: return null
  }
}

// ── Füllung (Formular und Server Action createFuellung) ──────────────────────
//
// Die Flaschen werden vom HEUTIGEN Bestand der Charge abgebucht. Maßgeblich für die
// Verknüpfung mit einem Antrag ist deshalb der Stand am Buchungstag = max(Abfülldatum, Tag des
// Bestands) – dieselbe Auswertung wie das Angebot im Formular (heute). Ein rückdatiertes
// Abfülldatum (veralteter Tab, Manipulation) umgeht so weder Zugangs- noch Mengenregel. Folge:
// eine tatsächlich VOR einem späteren Zugang abgefüllte, aber erst danach erfasste Füllung
// bekommt die Nummer nicht – vom Rückdatieren nicht unterscheidbar; Weg: Zugang stornieren,
// Füllung erfassen, Zugang neu buchen.
// Abfüllung VOR der Einreichung (Probe aus den Flaschen, Antrag danach): zusätzlich darf
// zwischen Abfüllung und Einreichung nichts zugebucht worden sein – sonst enthalten Flaschen
// und Probe verschiedenen Wein.

export type PnFuellungPruefung = { ok: true; pruefnummer: string | null } | { ok: false; fehler: string }

/**
 * Darf eine Füllung aus der Charge am Abfülldatum mit diesem DAC-Antrag verknüpft werden?
 * Dieselbe Regel für das Angebot im Formular und die Prüfung im Server.
 *   * Der Antrag muss zur Charge gehören (daten.antraege enthält nur Anträge der Charge im
 *     aktiven Betrieb) und aktiv, nicht abgelehnt sein.
 *   * Genehmigt: nur der Antrag, dessen Nummer laut pruefnummerGueltig am Buchungstag gilt –
 *     die Nummer kommt aus dem Antrag, nie aus dem Formular.
 *   * Offen (Entwurf, eingereicht, in Prüfung) oder genehmigt ohne Nummer: Verknüpfung ohne
 *     Nummer (Abfüllung vor dem Bescheid), wenn seit der Einreichung nichts zugebucht wurde.
 */
export function fuellungAntragPruefen(daten: PnChargeDaten | null | undefined, antragId: string, abfuelldatum: string): PnFuellungPruefung {
  const antrag = daten?.antraege.find(a => a.id === antragId && a.weinausbauId === daten.chargeId) ?? null
  if (!daten || !antrag) {
    return { ok: false, fehler: 'Der gewählte DAC-Antrag gehört nicht zur gewählten Kellerbuch-Charge – bitte die Seite neu laden und den Antrag erneut wählen.' }
  }
  const name = antrag.bezeichnung ? ` „${antrag.bezeichnung}“` : ''
  if (!antrag.aktiv || antrag.status === 'abgelehnt') {
    return { ok: false, fehler: `Der DAC-Antrag${name} ist ${antrag.status === 'abgelehnt' ? 'abgelehnt' : 'inaktiv'} und kann nicht mit der Füllung verknüpft werden.` }
  }
  const bestandAm = pnTag(daten.bestandAm)
  const buchungstag = bestandAm !== null && bestandAm > abfuelldatum ? bestandAm : abfuelldatum
  const nachtrag = buchungstag > abfuelldatum
  const bezug = nachtrag
    ? `den Bestand am ${pnDatumDe(buchungstag)}, von dem die Abfüllung vom ${pnDatumDe(abfuelldatum)} abgebucht wird`
    : `die Abfüllung am ${pnDatumDe(abfuelldatum)}`
  const nachtragText = (ereignis: string | null) => nachtrag && ereignis !== null && ereignis > abfuelldatum
    ? ' Die Füllung wird vom heutigen Bestand abgebucht, der diese Buchung schon enthält – fand die Abfüllung davor statt, bitte die Buchung stornieren, die Füllung erfassen und die Buchung danach neu anlegen.'
    : ''
  // Abfüllung vor der Einreichung: nichts zwischen Abfüllung und Einreichung zugebucht
  const beginn = antragBeginn(antrag)
  const vorher = beginn !== null && abfuelldatum < beginn ? zugaengeZwischen(daten.zugaenge, abfuelldatum, beginn)[0] ?? null : null
  const vorherFehler = (z: PnZugang) => ({
    ok: false as const,
    fehler: `Die Abfüllung am ${pnDatumDe(abfuelldatum)} liegt vor der Einreichung des DAC-Antrags${name} am ${pnDatumDe(beginn)}; dazwischen: ${pnZugangText(z.art, z.datum)}. Flaschen und Probe enthalten damit verschiedenen Wein – die Füllung kann nicht mit diesem Antrag verknüpft werden.`,
  })

  if (antragGenehmigt(antrag)) {
    const e = pruefnummerGueltig(daten, buchungstag)
    if (e.antragId !== antrag.id) {
      return { ok: false, fehler: `Die Prüfnummer ${nummer(antrag.pruefnummer)} des DAC-Antrags${name} gilt für diese Abfüllung nicht – maßgeblich ist der zuletzt eingereichte, genehmigte Antrag der Charge.` }
    }
    if (!e.gueltig) {
      const h = pruefnummerHinweis(e, bezug)
      return { ok: false, fehler: `${h ?? 'Die Prüfnummer des DAC-Antrags gilt für diese Abfüllung nicht.'}${nachtragText(e.ereignisDatum)} Für den aktuellen Bestand ist ein neuer DAC-Antrag nötig.` }
    }
    if (vorher) return vorherFehler(vorher)
    return { ok: true, pruefnummer: e.pruefnummer }
  }
  if (!(PN_OFFENE_STATUS as readonly string[]).includes(antrag.status) && antrag.status !== 'genehmigt') {
    return { ok: false, fehler: `Der DAC-Antrag${name} hat den unbekannten Status „${antrag.status}“.` }
  }
  if (vorher) return vorherFehler(vorher)
  const v = antragVerletzung(antrag, daten, buchungstag)
  if (v) {
    const grund = v.grund === 'menge'
      ? 'der Bestand ist größer als die beantragte Menge abzüglich der Abfüllungen'
      : pnZugangText(v.grund, v.ereignisDatum)
    return { ok: false, fehler: `Der DAC-Antrag${name} passt nicht mehr zum Bestand der Charge: ${grund}.${nachtragText(v.ereignisDatum)} Für den aktuellen Bestand ist ein neuer DAC-Antrag nötig.` }
  }
  return { ok: true, pruefnummer: null }
}

/**
 * Anträge der Charge, die das Füllungsformular am Stichtag (heute) anbietet – gleiche Regel wie
 * der Server, der bei einem Abfülldatum bis heute ebenfalls den heutigen Stand prüft. Nur für
 * eine Abfüllung VOR der Einreichung prüft der Server zusätzlich die Zugänge dazwischen.
 */
export function waehlbareAntraege(daten: PnChargeDaten, stichtag: string): string[] {
  return daten.antraege.filter(a => a.weinausbauId === daten.chargeId && fuellungAntragPruefen(daten, a.id, stichtag).ok).map(a => a.id)
}

/** Hat die Charge einen aktiven, nicht abgelehnten DAC-Antrag? Dann gibt es keine freie Eingabe. */
export function chargeHatAntrag(daten: PnChargeDaten | null | undefined): boolean {
  return !!daten && daten.antraege.some(a => a.weinausbauId === daten.chargeId && a.aktiv && a.status !== 'abgelehnt')
}

/**
 * Freie Eingabe einer Prüfnummer ohne DAC-Antrag – bewusst erhalten für Füllungen ohne Charge
 * (Altbestand), Chargen ohne DAC-Antrag (z. B. Zukauf mit der Prüfnummer des Lieferanten) und
 * durch Umzug entstandene Chargen (Nummer der Antrags-Charge, siehe `herkunft`).
 * Abgelehnt wird sie, wenn
 *   * die Charge einen (aktiven, nicht abgelehnten) DAC-Antrag hat – dann kommt die Nummer
 *     aus dem Antrag (Auswahl im Formular), oder
 *   * die Nummer zu irgendeinem DAC-Antrag des Betriebs gehört (antraegeMitNummer: alle, auch
 *     inaktive und abgelehnte) – typisch ein beim Chargenwechsel stehen gebliebener Wert oder
 *     die Nummer eines inaktiven Antrags der eigenen Charge. Einzige Ausnahme: die Charge stammt
 *     nur über Umzüge aus der Antrags-Charge (`herkunft`, ladeUmzugsherkunft) und die Nummer
 *     galt dort am Tag des (letzten) Umzugs laut pruefnummerGueltig.
 * Eine Lieferanten-Nummer prüft der Helfer nicht gegen Verschnitte (kein Antrag als Bezug) –
 * das bleibt KAN-84/KAN-99. Rückgabe: Fehlertext oder null.
 */
export function freiePruefnummerPruefen(
  pruefnummer: string,
  p: {
    chargeId: string | null
    chargeName?: string | null
    charge: PnChargeDaten | null
    antraegeMitNummer: readonly PnAntrag[]
    herkunft?: PnUmzugsherkunft | null
  },
): string | null {
  if (p.chargeId && chargeHatAntrag(p.charge)) {
    return `Für die Charge${p.chargeName ? ` „${p.chargeName}“` : ''} gibt es einen DAC-Antrag – die Prüfnummer kommt aus dem Antrag (Auswahl „DAC-Antrag / Prüfnummer“), nicht aus der freien Eingabe. Bitte die Seite neu laden.`
  }
  const n = pnNormiert(pruefnummer)
  const treffer = p.antraegeMitNummer.filter(a => pnNormiert(a.pruefnummer) === n)
  if (treffer.length === 0) return null
  const bez = (a: PnAntrag) => (a.bezeichnung ? ` „${a.bezeichnung}“` : '')

  // Umzugs-Charge: Nummer der Charge, aus der sie per Umzug hervorging – nur, wenn sie galt
  const h = p.chargeId ? p.herkunft ?? null : null
  if (h && treffer.some(a => a.weinausbauId === h.daten.chargeId)) {
    const e = pruefnummerGueltig(h.daten, h.umzugAm)
    const herkunftCharge = `der Charge${h.name ? ` „${h.name}“` : ''}`
    if (e.gueltig && pnNormiert(e.pruefnummer) === n) return null
    if (e.gueltig) return `Für den Wein, der am ${pnDatumDe(h.umzugAm)} aus ${herkunftCharge} umgezogen wurde, gilt die Prüfnummer ${e.pruefnummer}, nicht ${nummer(pruefnummer)}.`
    const hinweis = pruefnummerHinweis(e, `den Wein, der am ${pnDatumDe(h.umzugAm)} umgezogen wurde`)
    return `Die Prüfnummer ${nummer(pruefnummer)} stammt aus ${herkunftCharge}, aus der diese Charge per Umzug hervorging, gilt aber nicht für diesen Wein${hinweis ? ` – ${hinweis}` : '.'}`
  }

  const eigene = p.chargeId ? treffer.find(a => a.weinausbauId === p.chargeId) : undefined
  if (eigene) {
    const zustand = eigene.status === 'abgelehnt' ? 'abgelehnt' : !eigene.aktiv ? 'inaktiv' : 'nicht genehmigt'
    return `Die Prüfnummer ${nummer(eigene.pruefnummer)} gehört zum DAC-Antrag${bez(eigene)} dieser Charge, der ${zustand} ist – sie kann nicht frei eingetragen werden.`
  }
  const fremd = treffer[0]
  return p.chargeId
    ? `Die Prüfnummer ${nummer(fremd.pruefnummer)} gehört zum DAC-Antrag${bez(fremd)} einer anderen Charge und kann nicht für diese Füllung verwendet werden.`
    : `Die Prüfnummer ${nummer(fremd.pruefnummer)} gehört zum DAC-Antrag${bez(fremd)} einer Kellerbuch-Charge – bitte diese Charge wählen, dann wird die Nummer aus dem Antrag übernommen.`
}
