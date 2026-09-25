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
// Entschieden (Jörgen, 25.09.2026, KAN-83):
//   * Maßgeblich ist eingereicht_am, nicht bescheid_am: ein Verschnitt nach der Einreichung,
//     aber vor dem Bescheid ist bereits ein Verstoß – der verschnittene Wein wurde nicht zur
//     Prüfnummer eingereicht.
// Annahmen (offen, siehe KAN-38 – nicht hier entscheiden):
//   * Buchungen AM Einreichungstag gelten als davor (Probe nach dem letzten Verschnitt des
//     Tages gezogen).
//   * Fehlt eingereicht_am: bei einem Entwurf gibt es noch keine Probe – keine Zugangsregel,
//     nur die Mengenregel. Sonst (Altdaten, nachträglich erfasster Antrag) gilt der frühere von
//     Anlage- und Bescheidtag – der Bescheid liegt immer nach der Einreichung.
//   * Zugänge ohne Datum werden nicht gewertet (z. B. Pressung ohne Datum = Herkunft).
//   * Mengenregel nur, wenn der Bestand am Stichtag bekannt ist: der Lader liefert den
//     aktuellen Bestand (bestandAm = heute). Für einen Stichtag in der Vergangenheit (z. B.
//     Verkaufsdatum der TBS) entfällt sie – mengeGeprueft: false. Am Verkaufstag selbst rechnet
//     die TBS mit dem Bestand VOR dem Verkauf (bestandVorVerkauf). Keine Messtoleranz (nur die
//     Rundung von numeric(10,2)): eine gerundete Antragsmenge oder ein Antrag über eine
//     Teilmenge des Gebindes lässt die Nummer der Charge nicht gelten, bis der Bestand passt
//     (Messdifferenz als Schwund buchen bzw. Antragsmenge korrigieren) – fachlich offen.
//   * Ab wann es die Nummer gibt: für Blend-Protokoll und Füllung ab der Einreichung (die
//     Flaschen tragen die später erteilte Nummer); für die TBS (Transport an einem bestimmten
//     Tag) erst ab dem Bescheid – Option bescheidBisStichtag; ein älterer, am Stichtag schon
//     beschiedener Antrag gilt dann weiter, bis der jüngere beschieden ist.
//   * Umzüge geben die Nummer nicht weiter: eine durch Umzug entstandene Charge hat keinen
//     eigenen Antrag, Blend-Protokoll und TBS zeigen für sie keine Nummer (bis KAN-99). Die
//     Füllung nimmt die Nummer dort als freie Eingabe an, wenn die Charge nur über Umzüge aus
//     der Antrags-Charge stammt, die Nummer am ersten und am letzten Umzugstag galt und der
//     Antrag die Menge deckt: Bestand der Antrags-Charge + seither umgezogen + offen (Tank)
//     verkauft + abgefüllt ≤ beantragt (freiePruefnummerPruefen). Die Antrags-Charge selbst zählt
//     Umzüge nicht mit – wer den Überschuss eines Antrags über eine Teilmenge umzieht, behält die
//     Nummer für den Rest; ihr Wein hat Vorrang, auch wenn er später offen verkauft wird.
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

/** Tankverkauf aus der Charge (verkauf_positionen typ 'tank', Posten nicht storniert), Verkaufsdatum */
export type PnTankverkauf = { datum: string | null; liter: number }

export type PnChargeDaten = {
  chargeId: string
  /** Bestand in l am Tag bestandAm (Lader: aktueller Bestand, bestandAm = heute); null = unbekannt */
  bestandLiter: number | null
  bestandAm: string | null
  antraege: PnAntrag[]
  zugaenge: PnZugang[]
  abfuellungen: PnAbfuellung[]
  /** Tankverkäufe aus der Charge (bestandVorVerkauf, Mengenregel der Umzugsherkunft); fehlt: keine bekannt */
  tankverkaeufe?: PnTankverkauf[]
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
  /** letzter Umzug aus dieser Charge in die Kette – bis dahin kein Zugang (Gültigkeit der Nummer) */
  umzugAm: string
  /** erster Umzug aus dieser Charge in die Kette – der Antrag muss davor begonnen haben (fehlt: umzugAm) */
  ersterUmzugAm?: string | null
  /** alle Umzüge aus dieser Charge in andere Chargen (Mengenregel der Herkunft mit daten.tankverkaeufe; fehlt: keine) */
  umzuegeAus?: PnUmzugAbgang[]
}

/** Umzug aus einer Charge in eine andere Charge (Liter, die die Charge verlassen haben) */
export type PnUmzugAbgang = { datum: string | null; liter: number }

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

/**
 * Abgefüllt im Sinn der Mengenregel: Füllungen mit diesem Antrag oder nach der Einreichung. Alle,
 * nicht nur bis zum Stichtag – der Bestand (bestandAm) ist um jede erfasste Füllung schon gemindert.
 * `bis`: nicht verknüpfte Füllungen nur bis zu diesem Tag (herkunftMenge).
 */
function abgefuelltLiter(antrag: PnAntrag, daten: PnChargeDaten, bis: string | null = null): number {
  const beginn = antragBeginn(antrag)
  return daten.abfuellungen
    .filter(f => {
      if (f.dacAntragId === antrag.id) return true
      const t = pnTag(f.datum) ?? ''
      return beginn !== null && t > beginn && (bis === null || t <= bis)
    })
    .reduce((s, f) => s + (Number.isFinite(f.liter) ? f.liter : 0), 0)
}

/** Zahlen der Mengenregel; null = nicht prüfbar */
function mengeRegel(antrag: PnAntrag, daten: PnChargeDaten, stichtag: string): PnMenge | null {
  const bestandAm = pnTag(daten.bestandAm)
  if (antrag.mengeLiter === null || !Number.isFinite(antrag.mengeLiter)) return null
  if (daten.bestandLiter === null || !Number.isFinite(daten.bestandLiter) || bestandAm === null || stichtag < bestandAm) return null
  const abgefuellt = abgefuelltLiter(antrag, daten)
  return {
    bestandLiter: r2(daten.bestandLiter),
    beantragtLiter: r2(antrag.mengeLiter),
    abgefuelltLiter: r2(abgefuellt),
    zulaessigLiter: r2(antrag.mengeLiter - abgefuellt),
  }
}

/**
 * Daten für die Mengenregel einer Tankposition der TBS: Bestand am Verkaufstag VOR dem Verkauf.
 * Der Bestand des Laders ist um den Verkauf schon gemindert – sonst machte sich der Verkauf von
 * mehr Wein als beantragt selbst „gültig“ (ganzer Tank verkauft → Bestand 0). Zurückgerechnet
 * werden alle Tankverkäufe der Charge ab dem Verkaufstag (auch andere desselben Tages – ihre
 * Reihenfolge ist unbekannt). Nur, wenn die Mengenregel greift (Verkaufstag ≥ Tag des Bestands).
 */
export function bestandVorVerkauf(daten: PnChargeDaten, verkaufstag: string): PnChargeDaten {
  const bestandAm = pnTag(daten.bestandAm)
  if (daten.bestandLiter === null || !Number.isFinite(daten.bestandLiter) || bestandAm === null || verkaufstag < bestandAm) return daten
  const verkauft = (daten.tankverkaeufe ?? [])
    .filter(v => { const t = pnTag(v.datum); return t === null || t >= verkaufstag })
    .reduce((s, v) => s + (Number.isFinite(v.liter) ? v.liter : 0), 0)
  return verkauft > 0 ? { ...daten, bestandLiter: daten.bestandLiter + verkauft } : daten
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

  const auswerten = (a: PnAntrag): PnErgebnis => {
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
  // Nummer erst ab dem Bescheid: bis der jüngere Antrag beschieden ist, gilt der zuletzt schon
  // beschiedene weiter – aber nur, wenn er selbst gilt (nach einem Zugang seit seiner Einreichung
  // nicht; dann nennt der Hinweis den jüngeren Antrag)
  if (opts.bescheidBisStichtag) {
    const beschieden = bisStichtag.find(a => { const b = pnTag(a.bescheidAm); return b === null || b <= stichtag })
    if (beschieden && beschieden !== bisStichtag[0]) {
      const e = auswerten(beschieden)
      if (e.gueltig) return e
    }
  }
  return auswerten(bisStichtag[0])
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
// und Probe verschiedenen Wein. Dieselbe Datumsregel (fuellungDatumVerletzung, in beide
// Richtungen) gilt, wo nichts neu abgebucht wird: geändertes Abfülldatum, nachträglich
// zugeordnete Charge und die Ersatznummer aus dem Antrag (ersatzPruefnummer: TBS, Blend-
// Protokoll – ein beim Anlegen noch nicht eingereichter Entwurf ließ sie nicht prüfen).

export type PnFuellungPruefung = { ok: true; pruefnummer: string | null } | { ok: false; fehler: string }

/** Zugang zwischen Abfüllung und Beginn eines Antrags (vorher: Abfüllung vor dem Beginn) */
export type PnDatumVerletzung = { zugang: PnZugang; vorher: boolean; beginn: { tag: string; quelle: PnBeginnQuelle } }

/**
 * Zwischen Abfüllung und Beginn des Antrags darf nichts zugebucht worden sein: liegt die
 * Abfüllung davor, enthalten Flaschen und Probe sonst verschiedenen Wein; liegt sie danach,
 * enthalten die Flaschen den Zugang (Regel 2 am Abfülltag). Ohne Beginn (Entwurf) keine Prüfung.
 */
export function fuellungDatumVerletzung(antrag: PnAntrag, zugaenge: readonly PnZugang[], abfuelldatum: string): PnDatumVerletzung | null {
  const beginn = antragBeginnMitQuelle(antrag)
  if (!beginn || abfuelldatum === beginn.tag) return null
  const vorher = abfuelldatum < beginn.tag
  const z = (vorher ? zugaengeZwischen(zugaenge, abfuelldatum, beginn.tag) : zugaengeZwischen(zugaenge, beginn.tag, abfuelldatum))[0]
  return z ? { zugang: z, vorher, beginn } : null
}

/** „der Einreichung des DAC-Antrags „X“ am …“ – oder der Ersatz, wenn eingereicht_am fehlt */
function beginnText(b: { tag: string; quelle: PnBeginnQuelle }, antrag: PnAntrag): string {
  const name = antrag.bezeichnung ? ` „${antrag.bezeichnung}“` : ''
  if (b.quelle === 'angelegt') return `der Erfassung des DAC-Antrags${name} am ${pnDatumDe(b.tag)} (Einreichungsdatum fehlt)`
  if (b.quelle === 'bescheid') return `dem Bescheid zum DAC-Antrag${name} vom ${pnDatumDe(b.tag)} (Einreichungsdatum fehlt)`
  return `der Einreichung des DAC-Antrags${name} am ${pnDatumDe(b.tag)}`
}

/** Text zu fuellungDatumVerletzung, ohne Schlusspunkt */
export function fuellungDatumText(v: PnDatumVerletzung, abfuelldatum: string, antrag: PnAntrag): string {
  return v.vorher
    ? `Die Abfüllung am ${pnDatumDe(abfuelldatum)} liegt vor ${beginnText(v.beginn, antrag)}; dazwischen: ${pnZugangText(v.zugang.art, v.zugang.datum)}. Flaschen und Probe enthalten damit verschiedenen Wein`
    : `Die Abfüllung am ${pnDatumDe(abfuelldatum)} liegt nach ${beginnText(v.beginn, antrag)}; dazwischen: ${pnZugangText(v.zugang.art, v.zugang.datum)}. Die Flaschen enthalten damit Wein, den der Antrag nicht umfasst`
}

/**
 * Ersatznummer einer Füllung ohne eigene Prüfnummer aus ihrem DAC-Antrag (fuellungen.dac_antrag_id)
 * für Blend-Protokoll und TBS-Flaschenposition: nur genehmigt, aktiv und derselben Charge
 * (pruefnummerAusAntrag) – und nur, wenn das Abfülldatum gegen den Beginn hält
 * (fuellungDatumVerletzung mit den Zugängen der Charge der Füllung). `hinweis`: warum es keine gibt.
 */
export function ersatzPruefnummer(
  antrag: PnAntrag | null | undefined,
  fuellung: { datum: string | null | undefined; chargeId: string | null },
  zugaenge: readonly PnZugang[],
): { pruefnummer: string | null; hinweis: string | null } {
  if (!antrag) return { pruefnummer: null, hinweis: null }
  const nr = pruefnummerAusAntrag(antrag, fuellung.chargeId)
  if (!nr) return { pruefnummer: null, hinweis: pruefnummerAusAntrag(antrag) ? 'Der DAC-Antrag der Füllung gehört zu einer anderen Charge.' : null }
  const datum = pnTag(fuellung.datum)
  const v = datum ? fuellungDatumVerletzung(antrag, zugaenge, datum) : null
  if (v && datum) return { pruefnummer: null, hinweis: `Prüfnummer ${nr} des DAC-Antrags gilt nicht für diese Füllung: ${fuellungDatumText(v, datum, antrag)}.` }
  return { pruefnummer: nr, hinweis: null }
}

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
  // Abfüllung vor der Einreichung: nichts zwischen Abfüllung und Einreichung zugebucht (danach
  // prüfen pruefnummerGueltig bzw. antragVerletzung am Buchungstag ≥ Abfülldatum)
  const datumV = fuellungDatumVerletzung(antrag, daten.zugaenge, abfuelldatum)
  const vorher = datumV?.vorher ? datumV : null
  const vorherFehler = (v: PnDatumVerletzung) => ({
    ok: false as const,
    fehler: `${fuellungDatumText(v, abfuelldatum, antrag)} – die Füllung kann nicht mit diesem Antrag verknüpft werden.`,
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
 * Mengenregel einer Umzugs-Charge (freiePruefnummerPruefen): Wein mit der Nummer des Antrags =
 * heutiger Bestand der Antrags-Charge + seit dem Beginn aus ihr umgezogen bzw. offen (Tank)
 * verkauft (Tag = Beginn zählt mit) + abgefüllt (wie mengeRegel); das muss der beantragten Menge
 * entsprechen. Tankverkäufe zählen wie Füllungen vorsichtshalber alle – ob die TBS die Nummer
 * trug, steht nicht fest; sonst gäbe der Verkauf des Rests der Antrags-Charge (die die Nummer
 * behält) die Nummer ein zweites Mal für den umgezogenen Wein frei. Ab dem ersten Zugang seit
 * dem Beginn trägt der Wein der Antrags-Charge die Nummer nicht mehr: ihr Bestand zählt dann
 * nicht, spätere Umzüge, Verkäufe und nicht verknüpfte Füllungen auch nicht (am Tag des Zugangs
 * noch). Anders als die Mengenregel der Antrags-Charge unabhängig vom Umzugstag (heutiger
 * Bestand). null = nicht prüfbar (keine beantragte Menge, Bestand unbekannt).
 */
function herkunftMenge(antrag: PnAntrag, h: PnUmzugsherkunft): { bestandLiter: number; umgezogenLiter: number; verkauftLiter: number; abgefuelltLiter: number; beantragtLiter: number } | null {
  const d = h.daten
  const bestandAm = pnTag(d.bestandAm)
  if (antrag.mengeLiter === null || !Number.isFinite(antrag.mengeLiter)) return null
  if (d.bestandLiter === null || !Number.isFinite(d.bestandLiter) || bestandAm === null) return null
  const beginn = antragBeginn(antrag)
  const zugang = beginn !== null ? zugaengeZwischen(d.zugaenge, beginn, bestandAm)[0] ?? null : null
  const grenze = zugang ? pnTag(zugang.datum) : null
  const seitBeginn = (abgaenge: readonly { datum: string | null; liter: number }[]) => abgaenge
    .filter(u => { const t = pnTag(u.datum); return t === null || ((beginn === null || t >= beginn) && (grenze === null || t <= grenze)) })
    .reduce((s, u) => s + (Number.isFinite(u.liter) ? u.liter : 0), 0)
  return {
    bestandLiter: r2(grenze ? 0 : d.bestandLiter),
    umgezogenLiter: r2(seitBeginn(h.umzuegeAus ?? [])),
    verkauftLiter: r2(seitBeginn(d.tankverkaeufe ?? [])),
    abgefuelltLiter: r2(abgefuelltLiter(antrag, d, grenze)),
    beantragtLiter: r2(antrag.mengeLiter),
  }
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
 *     nur über Umzüge aus der Antrags-Charge (`herkunft`, ladeUmzugsherkunft), die Nummer galt
 *     dort am ersten und am letzten Umzugstag laut pruefnummerGueltig und der Antrag deckt die
 *     Menge (herkunftMenge: Bestand + seither umgezogen + offen verkauft + abgefüllt ≤ beantragt).
 * `nachtraeglich` (Charge einer bestehenden Füllung nachträglich zugeordnet, nichts wird
 * abgebucht): der erste Punkt entfällt – eine Nummer, die zu keinem Antrag des Betriebs gehört
 * (z. B. aus einem früheren, nicht erfassten Los), bleibt zulässig.
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
    nachtraeglich?: boolean
  },
): string | null {
  if (p.chargeId && !p.nachtraeglich && chargeHatAntrag(p.charge)) {
    return `Für die Charge${p.chargeName ? ` „${p.chargeName}“` : ''} gibt es einen DAC-Antrag – die Prüfnummer kommt aus dem Antrag, eine andere Nummer ist nicht zulässig. Im Formular „Neue Füllung“ den Antrag unter „DAC-Antrag / Prüfnummer“ wählen (fehlt die Auswahl, die Seite neu laden).`
  }
  const n = pnNormiert(pruefnummer)
  const treffer = p.antraegeMitNummer.filter(a => pnNormiert(a.pruefnummer) === n)
  if (treffer.length === 0) return null
  const bez = (a: PnAntrag) => (a.bezeichnung ? ` „${a.bezeichnung}“` : '')

  // Umzugs-Charge: Nummer der Charge, aus der sie per Umzug hervorging – nur, wenn sie am ersten
  // (Beginn davor) und am letzten Umzugstag (bis dahin kein Zugang) galt und die Menge passt
  const h = p.chargeId ? p.herkunft ?? null : null
  if (h && treffer.some(a => a.weinausbauId === h.daten.chargeId)) {
    const herkunftCharge = `der Charge${h.name ? ` „${h.name}“` : ''}`
    const nichtFuerDiesenWein = (grund: string | null) =>
      `Die Prüfnummer ${nummer(pruefnummer)} stammt aus ${herkunftCharge}, aus der diese Charge per Umzug hervorging, gilt aber nicht für diesen Wein${grund ? ` – ${grund}` : '.'}`
    const erster = pnTag(h.ersterUmzugAm) ?? h.umzugAm
    let e: PnErgebnis | null = null
    for (const tag of erster < h.umzugAm ? [erster, h.umzugAm] : [h.umzugAm]) {
      e = pruefnummerGueltig(h.daten, tag)
      if (!e.gueltig) return nichtFuerDiesenWein(pruefnummerHinweis(e, `den Wein, der am ${pnDatumDe(tag)} umgezogen wurde`))
      if (pnNormiert(e.pruefnummer) !== n) return `Für den Wein, der am ${pnDatumDe(tag)} aus ${herkunftCharge} umgezogen wurde, gilt die Prüfnummer ${e.pruefnummer}, nicht ${nummer(pruefnummer)}.`
    }
    const antrag = h.daten.antraege.find(a => a.id === e?.antragId)
    const m = antrag ? herkunftMenge(antrag, h) : null
    if (m && m.bestandLiter + m.umgezogenLiter + m.verkauftLiter + m.abgefuelltLiter > m.beantragtLiter + RUNDUNG) {
      const teile = [`${liter(m.umgezogenLiter)} aus ihr umgezogen`]
      if (m.verkauftLiter > 0) teile.push(`${liter(m.verkauftLiter)} offen (Tank) verkauft`)
      if (m.abgefuelltLiter > 0) teile.push(`${liter(m.abgefuelltLiter)} abgefüllt`)
      const seither = `seither wurden ${teile.length > 1 ? `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}` : teile[0]}`
        + (m.bestandLiter > 0 ? `, ${liter(m.bestandLiter)} liegen noch in ihr` : '')
      return nichtFuerDiesenWein(`der DAC-Antrag umfasst ${liter(m.beantragtLiter)}; ${seither} – zusammen mehr als beantragt.`)
    }
    return null
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
