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
//   2. nach der Einreichung (eingereicht_am) bis zum Stichtag kein Zugang, Verschnitt oder
//      Zukauf mit der Charge als ZIEL gebucht wurde (§ 25 Abs. 6 WeinG) – Abgänge (Füllung,
//      Tankverkauf, Schwund, Umzug/Verschnitt als Quelle) schaden nicht,
//   3. der Bestand höchstens der beantragten Menge minus der seither abgefüllten Menge
//      entspricht (Sicherung gegen Mehrmengen ohne Zugangsbuchung).
// Gelten mehrere genehmigte Anträge, zählt der zuletzt eingereichte bis zum Stichtag.
//
// Annahmen (offen, siehe KAN-38 – nicht hier entscheiden):
//   * Maßgeblich ist eingereicht_am, nicht bescheid_am: ein Verschnitt nach der Einreichung,
//     aber vor dem Bescheid zählt schon. Ob das rechtlich bereits ein Verstoß ist, klärt KAN-38.
//   * Buchungen AM Einreichungstag gelten als davor (Probe nach dem letzten Verschnitt des
//     Tages gezogen). Fehlt eingereicht_am (Entwurf, Altdaten), gilt der Anlagetag, dann der
//     Bescheidtag.
//   * Zugänge ohne Datum werden nicht gewertet (z. B. Pressung ohne Datum = Herkunft).
//   * Mengenregel nur, wenn der Bestand am Stichtag bekannt ist: der Lader liefert den
//     aktuellen Bestand (bestandAm = heute). Für einen Stichtag in der Vergangenheit (z. B.
//     Verkaufsdatum der TBS) entfällt sie – mengeGeprueft: false.
//
// Grundlage für KAN-83 (Warnung „Prüfnummer gilt nicht mehr“ bei Verschnitt/Umzug/Zugang)
// und KAN-84 (Füllung: Merkmale serverseitig aus der Charge); KAN-99 ersetzt die Ableitung
// später durch eine Tabelle pruefnummer_chargen – die Signaturen hier bleiben dafür stabil.

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

export type PnZugangArt = 'verschnitt' | 'zugang' | 'zukauf'

/** Buchung mit der Charge als ZIEL: Verschnitt (verschneidungen), Zugang (Umzug aus einer
 *  anderen Charge, Pressung), Zukauf (zukauf_posten) */
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
  | 'verschnitt' | 'zugang' | 'zukauf'   // Buchung mit der Charge als Ziel nach der Einreichung
  | 'menge'                              // Bestand > beantragt − abgefüllt
  | 'nicht_genehmigt'                    // kein genehmigter, aktiver Antrag mit Nummer
  | 'nach_stichtag'                      // genehmigter Antrag erst nach dem Stichtag eingereicht
  | 'kein_antrag'                        // Charge hat keinen DAC-Antrag

export type PnMenge = { bestandLiter: number; beantragtLiter: number; abgefuelltLiter: number; zulaessigLiter: number }

export type PnErgebnis = {
  gueltig: boolean
  /** gültig: die Nummer; ungültig: die nicht (mehr) geltende Nummer für den Hinweis, sonst null */
  pruefnummer: string | null
  antragId: string | null
  grund: PnGrund | null
  /** Tag der ersten schädlichen Buchung (verschnitt/zugang/zukauf) bzw. Einreichung (nach_stichtag) */
  ereignisDatum: string | null
  menge: PnMenge | null
  /** false: Mengenregel nicht geprüft (Bestand am Stichtag unbekannt oder keine beantragte Menge) */
  mengeGeprueft: boolean
}

export type PnVerletzung = { grund: 'verschnitt' | 'zugang' | 'zukauf' | 'menge'; ereignisDatum: string | null; menge: PnMenge | null }

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

/** Beginn eines Antrags für die Zugangsregel: Einreichung, sonst Anlage, sonst Bescheid */
export function antragBeginn(a: PnAntrag): string | null {
  return pnTag(a.eingereichtAm) ?? pnTag(a.angelegtAm) ?? pnTag(a.bescheidAm)
}

/** Genehmigt, aktiv und mit Nummer? */
export function antragGenehmigt(a: PnAntrag): boolean {
  return a.status === 'genehmigt' && a.aktiv === true && nummer(a.pruefnummer) !== null
}

/**
 * Nummer eines bestimmten Antrags (Füllung → fuellungen.dac_antrag_id): nur genehmigt und aktiv.
 * Für Füllungen gilt die Nummer der Abfüllung – spätere Zugänge der Charge betreffen die
 * Flaschen nicht mehr (Blend-Protokoll der Füllung, TBS-Flaschenposition).
 */
export function pruefnummerAusAntrag(a: PnAntrag | null | undefined): string | null {
  return a && antragGenehmigt(a) ? nummer(a.pruefnummer) : null
}

function neuesteZuerst(a: PnAntrag, b: PnAntrag): number {
  const x = antragBeginn(a) ?? '', y = antragBeginn(b) ?? ''
  if (x !== y) return x < y ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

const ART_REIHENFOLGE: Record<PnZugangArt, number> = { verschnitt: 0, zukauf: 1, zugang: 2 }

/**
 * Regeln 2 und 3 für einen bestimmten Antrag – unabhängig von seinem Status (auch für
 * offene Anträge, die eine Füllung ohne Nummer verknüpft). null = keine Verletzung.
 */
export function antragVerletzung(antrag: PnAntrag, daten: PnChargeDaten, stichtag: string): PnVerletzung | null {
  const beginn = antragBeginn(antrag)
  // Regel 2: Zugänge nach der Einreichung (am Einreichungstag: davor) bis einschließlich Stichtag
  const schaedlich = daten.zugaenge
    .filter(z => {
      const d = pnTag(z.datum)
      return d !== null && (beginn === null || d > beginn) && d <= stichtag
    })
    .sort((a, b) => (a.datum! < b.datum! ? -1 : a.datum! > b.datum! ? 1 : ART_REIHENFOLGE[a.art] - ART_REIHENFOLGE[b.art]))
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
 * (pruefnummerHinweis).
 */
export function pruefnummerGueltig(charge: PnChargeDaten, stichtag: string): PnErgebnis {
  const leer = { ereignisDatum: null, menge: null, mengeGeprueft: false }
  const eigene = charge.antraege.filter(a => a.weinausbauId === charge.chargeId)
  if (eigene.length === 0) return { gueltig: false, pruefnummer: null, antragId: null, grund: 'kein_antrag', ...leer }

  const genehmigt = eigene.filter(antragGenehmigt).sort(neuesteZuerst)
  const bisStichtag = genehmigt.filter(a => { const b = antragBeginn(a); return b === null || b <= stichtag })
  if (bisStichtag.length === 0) {
    if (genehmigt.length > 0) {
      const a = genehmigt[genehmigt.length - 1]   // ältester: ab ihm gäbe es eine Nummer
      return { gueltig: false, pruefnummer: nummer(a.pruefnummer), antragId: a.id, grund: 'nach_stichtag', ...leer, ereignisDatum: antragBeginn(a) }
    }
    // Kein genehmigter, aktiver Antrag: eine frühere Nummer (inaktiv, abgelehnt …) nur für den Hinweis
    const alle = [...eigene].sort(neuesteZuerst)
    const mitNummer = alle.find(a => nummer(a.pruefnummer) !== null) ?? null
    return { gueltig: false, pruefnummer: nummer(mitNummer?.pruefnummer), antragId: (mitNummer ?? alle[0]).id, grund: 'nicht_genehmigt', ...leer }
  }

  const a = bisStichtag[0]
  const pn = nummer(a.pruefnummer)
  const v = antragVerletzung(a, charge, stichtag)
  if (v) return { gueltig: false, pruefnummer: pn, antragId: a.id, grund: v.grund, ereignisDatum: v.ereignisDatum, menge: v.menge, mengeGeprueft: mengeRegel(a, charge, stichtag) !== null }
  const m = mengeRegel(a, charge, stichtag)
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

/**
 * Hinweis, wenn eine frühere Nummer nicht (mehr) gilt – null, wenn sie gilt oder es keine gibt.
 * `bezug` nennt den Bestand („den aktuellen Bestand“, „den Bestand am 01.09.2026“).
 */
export function pruefnummerHinweis(e: PnErgebnis, bezug = 'den aktuellen Bestand'): string | null {
  if (e.gueltig || !e.pruefnummer) return null
  const nr = e.pruefnummer
  switch (e.grund) {
    case 'verschnitt': return `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: Verschnitt am ${pnDatumDe(e.ereignisDatum)} (§ 25 Abs. 6 WeinG).`
    case 'zukauf': return `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: Zukauf am ${pnDatumDe(e.ereignisDatum)} (§ 25 Abs. 6 WeinG).`
    case 'zugang': return `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: Zugang aus einer anderen Charge am ${pnDatumDe(e.ereignisDatum)} (§ 25 Abs. 6 WeinG).`
    case 'menge': return e.menge
      ? `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: ${liter(e.menge.bestandLiter)} Bestand, beantragt waren ${liter(e.menge.beantragtLiter)}, davon ${liter(e.menge.abgefuelltLiter)} abgefüllt – höchstens ${liter(Math.max(0, e.menge.zulaessigLiter))} tragen die Nummer.`
      : `Frühere Prüfnummer ${nr} gilt nicht für ${bezug}: Bestand größer als die beantragte Menge.`
    case 'nicht_genehmigt': return `Prüfnummer ${nr} gilt nicht: Der DAC-Antrag ist nicht (mehr) genehmigt oder inaktiv.`
    case 'nach_stichtag': return `Prüfnummer ${nr} gilt nicht für ${bezug}: Der DAC-Antrag wurde erst am ${pnDatumDe(e.ereignisDatum)} eingereicht.`
    default: return null
  }
}

// ── Füllung (Formular und Server Action createFuellung) ──────────────────────

export type PnFuellungPruefung = { ok: true; pruefnummer: string | null } | { ok: false; fehler: string }

/**
 * Darf eine Füllung aus der Charge am Abfülldatum mit diesem DAC-Antrag verknüpft werden?
 * Dieselbe Regel für das Angebot im Formular und die Prüfung im Server.
 *   * Der Antrag muss zur Charge gehören (daten.antraege enthält nur Anträge der Charge im
 *     aktiven Betrieb) und aktiv, nicht abgelehnt sein.
 *   * Genehmigt: nur der Antrag, dessen Nummer laut pruefnummerGueltig gilt – die Nummer
 *     kommt aus dem Antrag, nie aus dem Formular.
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
  if (antragGenehmigt(antrag)) {
    // Abfüllung VOR der Einreichung (Probe aus der Füllung, Antrag danach): maßgeblich ist der
    // Stand am Einreichungstag – die Flaschen sind Teil der beantragten Menge (Annahme)
    const beginn = antragBeginn(antrag)
    const e = pruefnummerGueltig(daten, beginn && abfuelldatum < beginn ? beginn : abfuelldatum)
    if (e.gueltig && e.antragId === antrag.id) return { ok: true, pruefnummer: e.pruefnummer }
    if (e.antragId === antrag.id) {
      const h = pruefnummerHinweis(e, `die Abfüllung am ${pnDatumDe(abfuelldatum)}`)
      return { ok: false, fehler: `${h ?? 'Die Prüfnummer des DAC-Antrags gilt für diese Abfüllung nicht.'} Für den aktuellen Bestand ist ein neuer DAC-Antrag nötig.` }
    }
    return { ok: false, fehler: `Die Prüfnummer ${nummer(antrag.pruefnummer)} des DAC-Antrags${name} gilt für diese Abfüllung nicht – maßgeblich ist der zuletzt eingereichte, genehmigte Antrag der Charge.` }
  }
  if (!(PN_OFFENE_STATUS as readonly string[]).includes(antrag.status) && antrag.status !== 'genehmigt') {
    return { ok: false, fehler: `Der DAC-Antrag${name} hat den unbekannten Status „${antrag.status}“.` }
  }
  const v = antragVerletzung(antrag, daten, abfuelldatum)
  if (v) {
    const grund = v.grund === 'menge'
      ? 'der Bestand ist größer als die beantragte Menge abzüglich der Abfüllungen'
      : `${v.grund === 'verschnitt' ? 'Verschnitt' : v.grund === 'zukauf' ? 'Zukauf' : 'Zugang aus einer anderen Charge'} am ${pnDatumDe(v.ereignisDatum)} (§ 25 Abs. 6 WeinG)`
    return { ok: false, fehler: `Der DAC-Antrag${name} passt nicht mehr zum Bestand der Charge: ${grund}. Für den aktuellen Bestand ist ein neuer DAC-Antrag nötig.` }
  }
  return { ok: true, pruefnummer: null }
}

/** Anträge der Charge, die das Füllungsformular am Stichtag anbietet (gleiche Regel wie der Server) */
export function waehlbareAntraege(daten: PnChargeDaten, stichtag: string): string[] {
  return daten.antraege.filter(a => a.weinausbauId === daten.chargeId && fuellungAntragPruefen(daten, a.id, stichtag).ok).map(a => a.id)
}

/** Hat die Charge einen aktiven, nicht abgelehnten DAC-Antrag? Dann gibt es keine freie Eingabe. */
export function chargeHatAntrag(daten: PnChargeDaten | null | undefined): boolean {
  return !!daten && daten.antraege.some(a => a.weinausbauId === daten.chargeId && a.aktiv && a.status !== 'abgelehnt')
}

/**
 * Freie Eingabe einer Prüfnummer ohne DAC-Antrag – bewusst erhalten für Füllungen ohne Charge
 * (Altbestand) und Chargen ohne DAC-Antrag (z. B. Zukauf mit der Prüfnummer des Lieferanten).
 * Abgelehnt wird sie, wenn
 *   * die Charge einen (aktiven, nicht abgelehnten) DAC-Antrag hat – dann kommt die Nummer
 *     aus dem Antrag (Auswahl im Formular), oder
 *   * die Nummer zu einem DAC-Antrag einer ANDEREN Charge (bzw. ohne gewählte Charge: zu
 *     irgendeinem Antrag) des Betriebs gehört – typisch ein beim Chargenwechsel stehen
 *     gebliebener Wert.
 * Eine freie Nummer prüft der Helfer nicht gegen Verschnitte (kein Antrag als Bezug) – das
 * bleibt KAN-84/KAN-99. Rückgabe: Fehlertext oder null.
 */
export function freiePruefnummerPruefen(
  pruefnummer: string,
  p: { chargeId: string | null; chargeName?: string | null; charge: PnChargeDaten | null; antraegeMitNummer: readonly PnAntrag[] },
): string | null {
  if (p.chargeId && chargeHatAntrag(p.charge)) {
    return `Für die Charge${p.chargeName ? ` „${p.chargeName}“` : ''} gibt es einen DAC-Antrag – die Prüfnummer kommt aus dem Antrag (Auswahl „DAC-Antrag / Prüfnummer“), nicht aus der freien Eingabe. Bitte die Seite neu laden.`
  }
  const n = pnNormiert(pruefnummer)
  const fremd = p.antraegeMitNummer.find(a => pnNormiert(a.pruefnummer) === n && a.weinausbauId !== p.chargeId)
  if (fremd) {
    return p.chargeId
      ? `Die Prüfnummer ${nummer(fremd.pruefnummer)} gehört zum DAC-Antrag${fremd.bezeichnung ? ` „${fremd.bezeichnung}“` : ''} einer anderen Charge und kann nicht für diese Füllung verwendet werden.`
      : `Die Prüfnummer ${nummer(fremd.pruefnummer)} gehört zum DAC-Antrag${fremd.bezeichnung ? ` „${fremd.bezeichnung}“` : ''} einer Kellerbuch-Charge – bitte diese Charge wählen, dann wird die Nummer aus dem Antrag übernommen.`
  }
  return null
}
