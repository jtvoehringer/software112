// ── Behördenmeldung „Transportbescheinigung gemäß Weingesetz“ (24.09.2026) ─────────
//
// Eine Ladefunktion für Druckseite (weinhandel/verkauf/[id]/transportbescheinigung)
// UND CSV (/meldungen/transportbescheinigung/csv?id=…): Formulardaten aus
// transportbescheinigungen.formular_daten (JSONB) bzw. – solange nichts gespeichert
// ist – die Vorbelegung, die auch die Druckansicht zeigt. Die CSV kennzeichnet eine
// nicht gespeicherte Vorbelegung (Spalte „Formularstand“ + Warnung), denn einzelne
// Felder (v. a. „Angereichert“) sind nicht aus dem Kellerbuch abgeleitet.
//
// CSV: eine Zeile je Weinposition, Kopfangaben (Versender, Empfänger, Transportmittel)
// in jeder Zeile. Zeitraumliste „transportbescheinigungen“: dieselben Spalten für alle
// Verkaufsposten eines Zeitraums, die eine Transportbescheinigung brauchen.
//
// Isomorph ohne Server-Importe (Supabase-Client wird übergeben) – Tests: scripts/tests/verkehr.test.mjs

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { STELLEN, runden, wienHeute, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { bkiFarbe, formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { bestandVorVerkauf, ersatzPruefnummer, pnDatumDe, pnTag, pruefnummerGueltig, pruefnummerHinweis, type PnAntrag, type PnChargeDaten } from '@/lib/kellerbuch/pruefnummer'
import { antragAusZeile, ladePruefnummerDaten, PN_ANTRAG_SELECT } from '@/lib/kellerbuch/pruefnummerLaden'
import { rebsorteDerLieferung } from './traubenverkauf'
import { abrunden } from '@/lib/wein/mostgewicht'
import {
  UUID_RE, datumAusTeilen, feld, formularZahl, inBloecken, jaNeinFeld, strasseTeilen, textOderNull, zahlFeld, type R,
} from './verkehr-hilfen'

// ── Formular (JSONB) ─────────────────────────────────────────────────────────

export type TBWeinposition = {
  menge_liter: string
  /** 'l' oder 'kg' (Formularspalte „Menge (Liter/kg)“); fehlt bei Positionen ohne Angabe */
  einheit?: string
  art: string          // Rot/Weiß/Rosé
  traubensorte: string
  qualitaetsstufe: string
  jahrgang: string
  herkunft: string
  fremd_sorten_pct: string
  fremd_jg_pct: string
  pruefnummer: string
  anreicherung: string // J/N
  alkohol_pct: string  // Freitext „% vol / °KMW“
  kmw: string
}

export type TBDaten = {
  laufende_nr: string
  jahr: string
  datum_tag: string
  datum_monat: string
  datum_jahr: string
  uhrzeit: string
  zugmaschine: string
  anhaenger1: string
  anhaenger2: string
  // Versender
  v_betriebsnummer: string
  v_telefon: string
  v_name: string
  v_vorname: string
  v_strasse: string
  v_hausnr: string
  v_plz: string
  v_ort: string
  v_ort_versendung: string
  v_plz_versendung: string
  // Empfänger
  e_betriebsnummer: string
  e_telefon: string
  e_name: string
  e_vorname: string
  e_strasse: string
  e_hausnr: string
  e_plz: string
  e_ort: string
  e_ort_einlagerung: string
  e_plz_einlagerung: string
  positionen: TBWeinposition[]
}

export const TB_LEERE_POSITION: TBWeinposition = {
  menge_liter: '', einheit: 'l', art: 'Weiß', traubensorte: '', qualitaetsstufe: '',
  jahrgang: '', herkunft: '', fremd_sorten_pct: '', fremd_jg_pct: '',
  pruefnummer: '', anreicherung: 'N', alkohol_pct: '', kmw: '',
}

/** Positionstypen im Verkauf, die eine Transportbescheinigung brauchen (Most/Wein lose, Flaschenwein, Trauben) */
export const TB_POSITIONSTYPEN = ['tank', 'flasche', 'trauben'] as const

// ── CSV-Zeile ────────────────────────────────────────────────────────────────

export const FORMULAR_GESPEICHERT = 'gespeichert'
export const FORMULAR_VORBELEGUNG = 'nicht gespeicherte Vorbelegung'

export type TBZeile = {
  verkaufspostenId: string
  rechnungsnummer: string | null
  verkaufsdatum: string | null
  empfaengerKurz: string
  formularstand: string
  gespeichertAm: string | null
  laufendeNr: string
  jahr: string
  lieferdatum: string | null
  uhrzeit: string
  zugmaschine: string
  anhaenger1: string
  anhaenger2: string
  vBetriebsnummer: string
  vName: string
  vVorname: string
  vStrasse: string
  vHausnr: string
  vPlz: string
  vOrt: string
  vTelefon: string
  vOrtVersendung: string
  vPlzVersendung: string
  eBetriebsnummer: string
  eName: string
  eVorname: string
  eStrasse: string
  eHausnr: string
  ePlz: string
  eOrt: string
  eTelefon: string
  eOrtEinlagerung: string
  ePlzEinlagerung: string
  position: number
  menge: number | null
  einheit: string | null
  art: string | null
  traubensorte: string | null
  qualitaetsstufe: string | null
  jahrgang: string | null
  herkunft: string | null
  fremdSortenPct: number | null
  fremdJgPct: number | null
  pruefnummer: string | null
  angereichert: boolean | null
  alkohol: string | null
}

export const SPALTEN_TRANSPORTBESCHEINIGUNG: CsvSpalte<TBZeile>[] = [
  { kopf: 'Rechnungsnummer', typ: 'code', wert: z => z.rechnungsnummer },
  { kopf: 'Verkaufsdatum', typ: 'datum', wert: z => z.verkaufsdatum },
  { kopf: 'Formularstand', typ: 'text', wert: z => z.formularstand },
  { kopf: 'Gespeichert am', typ: 'zeitpunkt', wert: z => z.gespeichertAm },
  { kopf: 'Laufende Nummer', typ: 'code', wert: z => z.laufendeNr },
  { kopf: 'Jahr', typ: 'code', wert: z => z.jahr },
  { kopf: 'Datum der Lieferung', typ: 'datum', wert: z => z.lieferdatum },
  { kopf: 'Uhrzeit', typ: 'code', wert: z => z.uhrzeit },
  { kopf: 'Kennzeichen Zugmaschine', typ: 'code', wert: z => z.zugmaschine },
  { kopf: 'Kennzeichen 1. Anhänger', typ: 'code', wert: z => z.anhaenger1 },
  { kopf: 'Kennzeichen 2. Anhänger', typ: 'code', wert: z => z.anhaenger2 },
  { kopf: 'Versender Betriebsnummer', typ: 'code', wert: z => z.vBetriebsnummer },
  { kopf: 'Versender Firmen- oder Familienname', typ: 'text', wert: z => z.vName },
  { kopf: 'Versender Vorname', typ: 'text', wert: z => z.vVorname },
  { kopf: 'Versender Straße', typ: 'text', wert: z => z.vStrasse },
  { kopf: 'Versender Nr.', typ: 'code', wert: z => z.vHausnr },
  { kopf: 'Versender PLZ', typ: 'code', wert: z => z.vPlz },
  { kopf: 'Versender Ort', typ: 'text', wert: z => z.vOrt },
  { kopf: 'Versender Telefon', typ: 'code', wert: z => z.vTelefon },
  { kopf: 'Ort der Versendung', typ: 'text', wert: z => z.vOrtVersendung },
  { kopf: 'PLZ der Versendung', typ: 'code', wert: z => z.vPlzVersendung },
  { kopf: 'Empfänger Betriebsnummer', typ: 'code', wert: z => z.eBetriebsnummer },
  { kopf: 'Empfänger Firmen- oder Familienname', typ: 'text', wert: z => z.eName },
  { kopf: 'Empfänger Vorname', typ: 'text', wert: z => z.eVorname },
  { kopf: 'Empfänger Straße', typ: 'text', wert: z => z.eStrasse },
  { kopf: 'Empfänger Nr.', typ: 'code', wert: z => z.eHausnr },
  { kopf: 'Empfänger PLZ', typ: 'code', wert: z => z.ePlz },
  { kopf: 'Empfänger Ort', typ: 'text', wert: z => z.eOrt },
  { kopf: 'Empfänger Telefon', typ: 'code', wert: z => z.eTelefon },
  { kopf: 'Ort der Einlagerung', typ: 'text', wert: z => z.eOrtEinlagerung },
  { kopf: 'PLZ der Einlagerung', typ: 'code', wert: z => z.ePlzEinlagerung },
  { kopf: 'Position', typ: 'ganzzahl', wert: z => z.position },
  { kopf: 'Menge (Liter/kg)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'code', wert: z => z.einheit },
  { kopf: 'Art (Rot/Weiß/Rosé)', typ: 'text', wert: z => z.art },
  { kopf: 'Traubensorte(n)', typ: 'text', wert: z => z.traubensorte },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => z.qualitaetsstufe },
  { kopf: 'Jahrgang', typ: 'code', wert: z => z.jahrgang },
  { kopf: 'Herkunft', typ: 'text', wert: z => z.herkunft },
  { kopf: 'Fremdsortenanteil (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.fremdSortenPct },
  { kopf: 'Fremdjahrgangsanteil (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.fremdJgPct },
  { kopf: 'Staatliche Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Angereichert', typ: 'janein', wert: z => z.angereichert },
  { kopf: 'Alkohol (% vol) / KMW (°)', typ: 'text', wert: z => z.alkohol },
]

// ── Vorbelegung (wie die Druckansicht sie zeigt) ─────────────────────────────

const WEINART_FARBE: Record<string, string> = { rot: 'Rot', weiss: 'Weiß', rose: 'Rosé' }

/** Farbe für das Formular: Weinart der Charge, sonst aus der amtlichen Kürzelliste (bkiFarbe –
 *  wie das BKI-Datenblatt); null = nicht bestimmbar (Sorte ohne eindeutige Farbe, z. B.
 *  Rosenmuskateller oder Direktträger, bzw. keine Rebsorte) → „Weiß“ nur mit Hinweis vorbelegt. */
function farbe(weinart: unknown, rebsorte: unknown): string | null {
  if (typeof weinart === 'string' && WEINART_FARBE[weinart]) return WEINART_FARBE[weinart]
  const f = typeof rebsorte === 'string' ? bkiFarbe(rebsorte.trim()) : null
  return f === 'rot' ? 'Rot' : f === 'weiss' ? 'Weiß' : null
}

/** Hinweis bei nicht bestimmbarer Farbe, mit Grund */
function farbHinweis(nr: number, rebsorte: unknown): string {
  const sorte = typeof rebsorte === 'string' && rebsorte.trim() ? rebsorte.trim() : null
  const grund = sorte ? ` (Rebsorte „${sorte}“ hat laut BKI-Kürzelliste keine eindeutige Farbe)` : ' (keine Rebsorte erfasst)'
  return `Position ${nr}: Farbe (Rot/Weiß/Rosé) nicht bestimmbar${grund} – „Weiß“ vorbelegt, bitte prüfen`
}

export type TBPruefnummern = {
  /** Prüfnummern-Daten je Charge – Tankposition: pruefnummerGueltig am Verkaufsdatum; Charge einer Füllung: Zugänge für ersatzPruefnummer */
  jeWeinausbau: Record<string, PnChargeDaten>
  /** DAC-Antrag je id (fuellungen.dac_antrag_id) – Nummer über ersatzPruefnummer (genehmigt, aktiv, Charge der Füllung, Abfülldatum gegen den Beginn) */
  jeDacAntrag: Record<string, PnAntrag>
}

/** Endung der Prüfnummern-Hinweise der Vorbelegung (die Zeitraumliste übernimmt nur diese) */
export const TB_PN_NICHT_VORBELEGT = 'Prüfnummer nicht vorbelegt.'

/**
 * Vorbelegung eines noch nicht gespeicherten Formulars aus Verkaufsposten und Betriebsdaten.
 * `hinweise` sammelt Felder, die nicht sicher bestimmt werden konnten (→ X-Warnungen).
 *
 * Prüfnummer (KAN-72): Tankposition nur mit einer am Verkaufsdatum gültigen Nummer der Charge
 * (pruefnummerGueltig – dieselbe Regel wie Blend-Protokoll und Füllungsvorschlag; bisher der
 * älteste Antrag mit Nummer ohne Status-/Datumsprüfung; Mengenregel mit dem Bestand vor dem
 * Verkauf, bestandVorVerkauf), sonst leer mit Hinweis. Flaschen-
 * position: Nummer der Füllung, ersatzweise die ihres genehmigten, aktiven DAC-Antrags derselben
 * Charge, wenn zwischen Abfüllung und Beginn des Antrags nichts zugebucht wurde (ersatzPruefnummer
 * – etwa nach einer Verknüpfung mit einem noch nicht eingereichten Entwurf). Für den Transport
 * an einem Tag gibt es die Nummer erst ab dem Bescheid (bescheidBisStichtag) – ein Verkauf
 * zwischen Einreichung und Bescheid bleibt leer (Hinweis).
 */
export function tbVorbelegung(posten: R, cfg: R, pn: TBPruefnummern, heute: string, hinweise: string[]): TBDaten {
  const [jahr, monat, tag] = heute.split('-')
  const verkaufstag = pnTag(posten.datum) ?? heute
  const kunde = (posten.kontakt ?? posten.firma ?? {}) as R
  const eName = posten.kontakt
    ? [kunde.vorname, kunde.nachname].map(feld).filter(Boolean).join(' ')
    : feld(kunde.name)
  const betrieb = strasseTeilen(cfg.betrieb_strasse)
  const empf = strasseTeilen(kunde.strasse)
  const relevant = ((posten.positionen ?? []) as R[]).filter(p => (TB_POSITIONSTYPEN as readonly string[]).includes(p.typ))

  const positionen: TBWeinposition[] = relevant.map((p, i) => {
    const nr = i + 1
    if (p.typ === 'tank') {
      const wa = (p.weinausbau ?? null) as R | null
      const art = farbe(wa?.weinart, wa?.rebsorte)
      if (!art) hinweise.push(farbHinweis(nr, wa?.rebsorte))
      // Mengenregel mit dem Bestand vor dem Verkauf – sonst machte der Verkauf von mehr Wein als
      // beantragt die Nummer selbst „gültig“ (bestandVorVerkauf)
      const roh = wa?.id ? pn.jeWeinausbau[wa.id] : undefined
      const daten = roh ? bestandVorVerkauf(roh, verkaufstag) : undefined
      const e = daten ? pruefnummerGueltig(daten, verkaufstag, { bescheidBisStichtag: true }) : null
      const pnHinweis = e ? pruefnummerHinweis(e, `den Bestand am ${pnDatumDe(verkaufstag)} (Verkaufsdatum)`) : null
      if (pnHinweis) hinweise.push(`Position ${nr}: ${pnHinweis} ${TB_PN_NICHT_VORBELEGT}`)
      return {
        ...TB_LEERE_POSITION,
        menge_liter:     formularZahl(p.menge === null || p.menge === undefined ? null : Number(p.menge), STELLEN.liter),
        einheit:         'l',
        art:             art ?? 'Weiß',
        traubensorte:    wa?.rebsorte ? formatRebsorteMitKuerzel(wa.rebsorte) : '',
        qualitaetsstufe: feld(wa?.qualitaetsstufe),
        jahrgang:        wa?.jahrgang ? String(wa.jahrgang) : '',
        herkunft:        feld(cfg.betrieb_ort),
        pruefnummer:     e?.gueltig ? (e.pruefnummer ?? '') : '',
      }
    }
    if (p.typ === 'flasche') {
      const f = (p.fuellung ?? null) as R | null
      const art = farbe(null, f?.rebsorte)
      if (!art) hinweise.push(farbHinweis(nr, f?.rebsorte))
      // Verkauft werden Flaschen (Stück) – das Formular verlangt Liter: über die Flaschengröße umrechnen
      const ml = Number(f?.flaschengroesse_ml)
      const stueck = p.menge === null || p.menge === undefined || p.menge === '' ? NaN : Number(p.menge)
      const hatGroesse = Number.isFinite(ml) && ml > 0
      if (!hatGroesse) hinweise.push(`Position ${nr}: Flaschengröße unbekannt – Menge ist die Flaschenanzahl, nicht Liter`)
      let pruef = feld(f?.pruefnummer)
      const antrag = !pruef && f?.dac_antrag_id ? pn.jeDacAntrag[f.dac_antrag_id] : undefined
      if (antrag) {
        const chargeId = f?.weinausbau_id ? String(f.weinausbau_id) : null
        const e = ersatzPruefnummer(antrag, { datum: pnTag(f?.datum), chargeId }, (chargeId ? pn.jeWeinausbau[chargeId]?.zugaenge : null) ?? [])
        const ersatz = e.pruefnummer
        const bescheid = pnTag(antrag.bescheidAm)
        if (e.hinweis) {
          hinweise.push(`Position ${nr}: ${e.hinweis} ${TB_PN_NICHT_VORBELEGT}`)
        } else if (ersatz && bescheid !== null && bescheid > verkaufstag) {
          const h = pruefnummerHinweis({ gueltig: false, pruefnummer: ersatz, antragId: antrag.id, grund: 'vor_bescheid', ereignisDatum: bescheid, menge: null, mengeGeprueft: false }, `den Verkauf am ${pnDatumDe(verkaufstag)}`)
          hinweise.push(`Position ${nr}: ${h} ${TB_PN_NICHT_VORBELEGT}`)
        } else if (ersatz) {
          pruef = ersatz
        }
      }
      return {
        ...TB_LEERE_POSITION,
        menge_liter:     hatGroesse && Number.isFinite(stueck) ? formularZahl((stueck * ml) / 1000, STELLEN.liter) : formularZahl(Number.isFinite(stueck) ? stueck : null, STELLEN.liter),
        einheit:         hatGroesse ? 'l' : '',
        art:             art ?? 'Weiß',
        traubensorte:    f?.rebsorte ? formatRebsorteMitKuerzel(f.rebsorte) : '',
        qualitaetsstufe: feld(f?.qualitaet),
        jahrgang:        f?.jahrgang ? String(f.jahrgang) : '',
        herkunft:        feld(f?.anbaugebiet) || feld(cfg.betrieb_ort),
        pruefnummer:     pruef,
      }
    }
    // Traubenverkauf: Menge in kg, Jahrgang = Jahr der Lieferung, KMW in die Spalte „Alkohol % vol / °KMW“
    const tv = (p.traubenverkauf ?? null) as R | null
    // Rebsorte wie im BKI-Datenblatt: Grundstück → Ried → Zukauf-Posten (KAN-36)
    const rebsorte = tv ? rebsorteDerLieferung(tv) : null
    const art = farbe(null, rebsorte)
    if (!art) hinweise.push(farbHinweis(nr, rebsorte))
    // KAN-128 (Entscheidung 8): kmw_grad hat nach Migration A 2 Stellen (°Oe-Messung: 94 °Oe = 18,97 °KMW)
    // – auf die 1 Stelle des Formblatts ABRUNDEN, nie über eine Stufenschwelle („18,9“, nicht „19,0“).
    // °Oe auf dem amtlichen Formblatt: KAN-131 (Entscheidung 7).
    const kmwRoh = tv?.kmw_grad === null || tv?.kmw_grad === undefined ? null : Number(tv.kmw_grad)
    const kmw = kmwRoh === null || !Number.isFinite(kmwRoh) ? kmwRoh : abrunden(kmwRoh, STELLEN.kmwBki)
    const kmwText = formularZahl(kmw, STELLEN.kmwBki)
    const lieferjahr = /^\d{4}-/.test(feld(tv?.datum)) ? feld(tv?.datum).slice(0, 4) : ''
    return {
      ...TB_LEERE_POSITION,
      menge_liter:     formularZahl(p.menge === null || p.menge === undefined ? null : Number(p.menge), STELLEN.kgGenau),
      einheit:         'kg',
      art:             art ?? 'Weiß',
      traubensorte:    rebsorte ? formatRebsorteMitKuerzel(rebsorte) : '',
      qualitaetsstufe: feld(tv?.qualitaetsstufe),
      jahrgang:        lieferjahr,
      herkunft:        feld(tv?.herkunft_code) || feld(cfg.betrieb_ort),
      alkohol_pct:     kmwText ? `${kmwText} °KMW` : '',
      kmw:             kmwText,
    }
  })

  return {
    laufende_nr: '',
    jahr:        jahr ?? '',
    datum_tag:   tag ?? '',
    datum_monat: monat ?? '',
    datum_jahr:  jahr ?? '',
    uhrzeit:     '',
    zugmaschine: '',
    anhaenger1:  '',
    anhaenger2:  '',
    v_betriebsnummer: feld(cfg.betrieb_betriebsnummer),
    v_telefon:        feld(cfg.betrieb_telefon),
    v_name:           feld(cfg.betrieb_name),
    v_vorname:        '',
    v_strasse:        betrieb.strasse,
    v_hausnr:         betrieb.hausnr,
    v_plz:            feld(cfg.betrieb_plz),
    v_ort:            feld(cfg.betrieb_ort),
    v_ort_versendung: feld(cfg.betrieb_ort),
    v_plz_versendung: feld(cfg.betrieb_plz),
    e_betriebsnummer:  feld(kunde.betrieb_nr),
    e_telefon:         feld(kunde.telefon),
    e_name:            eName,
    e_vorname:         '',
    e_strasse:         empf.strasse,
    e_hausnr:          empf.hausnr,
    e_plz:             feld(kunde.plz),
    e_ort:             feld(kunde.ort),
    e_ort_einlagerung: feld(kunde.ort),
    e_plz_einlagerung: feld(kunde.plz),
    positionen: positionen.length > 0 ? positionen : [{ ...TB_LEERE_POSITION }],
  }
}

// ── Abflachen: Formular → CSV-Zeilen ─────────────────────────────────────────

export type TBMeta = {
  verkaufspostenId: string
  rechnungsnummer: string | null
  verkaufsdatum: string | null
  gespeichert: boolean
  gespeichertAm: string | null
  /** Einheit für Positionen ohne Angabe: 'l'/'kg', wenn alle TB-Positionen des Verkaufs dieselbe haben */
  einheitStandard: string | null
}

function positionLeer(p: R): boolean {
  return ['menge_liter', 'traubensorte', 'qualitaetsstufe', 'jahrgang', 'herkunft', 'fremd_sorten_pct', 'fremd_jg_pct', 'pruefnummer', 'alkohol_pct']
    .every(k => feld(p[k]) === '')
}

/** Formulardaten in CSV-Zeilen (eine je Weinposition). Leere Positionen entfallen (mit Hinweis). */
export function tbZeilen(formular: R, meta: TBMeta, warnungen: string[], praefix = ''): TBZeile[] {
  const w = (s: string) => `${praefix}${s}`
  const f = formular ?? {}
  const lokal: string[] = []
  const kopf = {
    verkaufspostenId: meta.verkaufspostenId,
    rechnungsnummer: meta.rechnungsnummer,
    verkaufsdatum: meta.verkaufsdatum,
    empfaengerKurz: [feld(f.e_name), feld(f.e_vorname)].filter(Boolean).join(' '),
    formularstand: meta.gespeichert ? FORMULAR_GESPEICHERT : FORMULAR_VORBELEGUNG,
    gespeichertAm: meta.gespeichertAm,
    laufendeNr: feld(f.laufende_nr),
    jahr: feld(f.jahr),
    lieferdatum: datumAusTeilen(f.datum_tag, f.datum_monat, f.datum_jahr, w('Datum der Lieferung'), lokal),
    uhrzeit: feld(f.uhrzeit),
    zugmaschine: feld(f.zugmaschine),
    anhaenger1: feld(f.anhaenger1),
    anhaenger2: feld(f.anhaenger2),
    vBetriebsnummer: feld(f.v_betriebsnummer),
    vName: feld(f.v_name),
    vVorname: feld(f.v_vorname),
    vStrasse: feld(f.v_strasse),
    vHausnr: feld(f.v_hausnr),
    vPlz: feld(f.v_plz),
    vOrt: feld(f.v_ort),
    vTelefon: feld(f.v_telefon),
    vOrtVersendung: feld(f.v_ort_versendung),
    vPlzVersendung: feld(f.v_plz_versendung),
    eBetriebsnummer: feld(f.e_betriebsnummer),
    eName: feld(f.e_name),
    eVorname: feld(f.e_vorname),
    eStrasse: feld(f.e_strasse),
    eHausnr: feld(f.e_hausnr),
    ePlz: feld(f.e_plz),
    eOrt: feld(f.e_ort),
    eTelefon: feld(f.e_telefon),
    eOrtEinlagerung: feld(f.e_ort_einlagerung),
    ePlzEinlagerung: feld(f.e_plz_einlagerung),
  }

  const positionen = (Array.isArray(f.positionen) ? f.positionen : []) as R[]
  const zeilen: TBZeile[] = []
  let leer = 0
  let ohneEinheit = 0
  positionen.forEach((p, i) => {
    if (!p || typeof p !== 'object' || positionLeer(p)) { leer++; return }
    const nr = i + 1
    const menge = zahlFeld(p.menge_liter, w(`Position ${nr}: Menge`), lokal)
    const einheitRoh = feld(p.einheit)
    const einheit = einheitRoh || meta.einheitStandard || null
    if (menge !== null && !einheit) ohneEinheit++
    const fs = zahlFeld(p.fremd_sorten_pct, w(`Position ${nr}: Fremdsortenanteil`), lokal)
    const fj = zahlFeld(p.fremd_jg_pct, w(`Position ${nr}: Fremdjahrgangsanteil`), lokal)
    zeilen.push({
      ...kopf,
      position: nr,
      menge: menge === null ? null : runden(menge, STELLEN.liter),
      einheit,
      art: textOderNull(p.art),
      traubensorte: textOderNull(p.traubensorte),
      qualitaetsstufe: textOderNull(p.qualitaetsstufe),
      jahrgang: textOderNull(p.jahrgang),
      herkunft: textOderNull(p.herkunft),
      fremdSortenPct: fs === null ? null : runden(fs, STELLEN.prozent),
      fremdJgPct: fj === null ? null : runden(fj, STELLEN.prozent),
      pruefnummer: textOderNull(p.pruefnummer),
      angereichert: jaNeinFeld(p.anreicherung, w(`Position ${nr}: Angereichert`), lokal),
      alkohol: textOderNull(p.alkohol_pct),
    })
  })
  if (leer > 0) lokal.push(w(`${leer} ${leer === 1 ? 'leere Weinposition' : 'leere Weinpositionen'} nicht ausgegeben`))
  if (ohneEinheit > 0) lokal.push(w(`${ohneEinheit} ${ohneEinheit === 1 ? 'Position' : 'Positionen'} ohne Einheit (Liter/kg) – bitte im Formular ergänzen`))
  if (zeilen.length === 0) lokal.push(w('keine Weinposition ausgefüllt – nur die Kopfzeile ausgegeben'))
  warnungen.push(...lokal)
  return zeilen
}

/** 'l'/'kg', wenn alle TB-Positionen des Verkaufs dieselbe Einheit haben (Trauben kg, Wein l) */
function einheitStandard(posten: R): string | null {
  const typen = new Set(((posten.positionen ?? []) as R[])
    .filter(p => (TB_POSITIONSTYPEN as readonly string[]).includes(p.typ))
    .map(p => (p.typ === 'trauben' ? 'kg' : 'l')))
  return typen.size === 1 ? [...typen][0] : null
}

// ── Laden ────────────────────────────────────────────────────────────────────

const POSTEN_SELECT = `
  id, rechnungsnummer, datum, storniert,
  kontakt:kontakte!verkaufsposten_kontakt_id_fkey(vorname, nachname, telefon, strasse, plz, ort, betrieb_nr),
  firma:firmen(name, telefon, strasse, plz, ort, betrieb_nr),
  positionen:verkauf_positionen(
    id, typ, name, menge, einheit,
    weinausbau:weinausbau(id, name, jahrgang, qualitaetsstufe, rebsorte, weinart),
    fuellung:fuellungen(id, name, jahrgang, qualitaet, rebsorte, anbaugebiet, flaschengroesse_ml, datum, pruefnummer, dac_antrag_id, weinausbau_id),
    traubenverkauf:traubenverkauf(id, storniert_am, datum, kmw_grad, qualitaetsstufe, herkunft_code, grundstueck:grundstueck_id(rebsorte), weingarten:weingarten_id(rebsorte), zukauf:zukauf_posten_id(rebsorte))
  )
`

const CFG_SELECT = 'betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_betriebsnummer'

type Client = any

async function betriebLaden(supabase: Client, tenantId: string): Promise<R> {
  // RLS-gescopter Client statt Admin-Client: keine Betriebsdaten eines fremden Mandanten auf dem amtlichen Dokument
  const { data, error } = await (supabase.from('tenant_einstellungen') as any)
    .select(CFG_SELECT)
    .eq('tenant_id', tenantId)
    .limit(1).maybeSingle()
  if (error) throw new Error(`Laden fehlgeschlagen (tenant_einstellungen): ${error.message}`)
  return (data ?? {}) as R
}

/**
 * Prüfnummern zu Chargen (Tank) und DAC-Anträgen (Füllungen) der Verkaufsposten. Tank: die
 * Daten für pruefnummerGueltig (lib/kellerbuch/pruefnummerLaden.ts), ausgewertet in
 * tbVorbelegung am Verkaufsdatum. Füllung: die Anträge und die Daten ihrer Charge (Zugänge für
 * ersatzPruefnummer); die Nummer wählt tbVorbelegung (genehmigt, aktiv, Charge der Füllung,
 * Abfülldatum gegen den Beginn, Bescheid bis zum Verkaufsdatum).
 */
async function pruefnummernLaden(supabase: Client, tenantId: string, posten: R[]): Promise<TBPruefnummern> {
  const pos = posten.flatMap(p => (p.positionen ?? []) as R[])
  const ersatzPos = pos.filter(p => p.typ === 'flasche' && p.fuellung?.dac_antrag_id && !feld(p.fuellung?.pruefnummer))
  const waIds = [...new Set([
    ...pos.filter(p => p.typ === 'tank' && p.weinausbau?.id).map(p => String(p.weinausbau.id)),
    ...ersatzPos.filter(p => p.fuellung?.weinausbau_id).map(p => String(p.fuellung.weinausbau_id)),
  ])]
  const dacIds = [...new Set(ersatzPos.map(p => String(p.fuellung.dac_antrag_id)))]
  const pn: TBPruefnummern = { jeWeinausbau: {}, jeDacAntrag: {} }
  if (waIds.length > 0) {
    for (const [id, daten] of await ladePruefnummerDaten(supabase, tenantId, waIds)) pn.jeWeinausbau[id] = daten
  }
  for (const block of inBloecken(dacIds)) {
    const { data, error } = await alle<R>((supabase.from('dac_antrag') as any)
      .select(PN_ANTRAG_SELECT)
      .eq('tenant_id', tenantId)
      .in('id', block)
      .order('id'))
    if (error) throw new Error(`Laden fehlgeschlagen (dac_antrag): ${error.message}`)
    for (const d of data) pn.jeDacAntrag[d.id] = antragAusZeile(d)
  }
  return pn
}

export type TBErgebnis = {
  posten: { id: string; rechnungsnummer: string | null; datum: string | null; storniert: boolean }
  /** Formular für die Druckansicht: gespeichert oder Vorbelegung */
  formular: TBDaten
  gespeichert: boolean
  gespeichertAm: string | null
  zeilen: TBZeile[]
  warnungen: string[]
  /** Hinweise zur nicht gespeicherten Vorbelegung (Farbe, Flaschengröße, Prüfnummer) – für die Druckseite */
  vorbelegungHinweise: string[]
}

const HINWEIS_VORBELEGUNG = 'Transportbescheinigung ist noch nicht gespeichert – ausgegeben ist die nicht gespeicherte Vorbelegung wie in der Druckansicht. Bitte Formular prüfen (v. a. Farbe, Prüfnummer, „Angereichert“ ist ungeprüft mit „N“ vorbelegt) und speichern.'

/**
 * Transportbescheinigung eines Verkaufspostens – für Druckseite und CSV.
 * null = Verkaufsposten nicht gefunden (oder keine gültige id).
 */
export async function ladeTransportbescheinigung(supabase: Client, tenantId: string, p: { id: string }): Promise<TBErgebnis | null> {
  if (!UUID_RE.test(p.id)) return null
  const [postenRes, cfg, tbRes] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(POSTEN_SELECT)
      .eq('id', p.id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    betriebLaden(supabase, tenantId),
    (supabase.from('transportbescheinigungen') as any)
      .select('formular_daten, erstellt_am, aktualisiert_am')
      .eq('verkaufsposten_id', p.id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  if (postenRes.error) throw new Error(`Laden fehlgeschlagen (verkaufsposten): ${postenRes.error.message}`)
  if (tbRes.error) throw new Error(`Laden fehlgeschlagen (transportbescheinigungen): ${tbRes.error.message}`)
  const posten = postenRes.data as R | null
  if (!posten) return null

  const warnungen: string[] = []
  const tb = tbRes.data as R | null
  const gespeicherteDaten = tb?.formular_daten && typeof tb.formular_daten === 'object' ? (tb.formular_daten as TBDaten) : null
  const gespeichertAm = tb ? (tb.aktualisiert_am ?? tb.erstellt_am ?? null) : null

  let formular: TBDaten
  let vorbelegungHinweise: string[] = []
  if (gespeicherteDaten) {
    formular = { ...gespeicherteDaten, positionen: Array.isArray(gespeicherteDaten.positionen) ? gespeicherteDaten.positionen : [] }
  } else {
    const pn = await pruefnummernLaden(supabase, tenantId, [posten])
    const hinweise: string[] = []
    formular = tbVorbelegung(posten, cfg, pn, wienHeute(), hinweise)
    warnungen.push(HINWEIS_VORBELEGUNG, ...hinweise)
    vorbelegungHinweise = hinweise
  }
  if (posten.storniert === true) warnungen.push('Der Verkaufsposten ist storniert.')

  const zeilen = tbZeilen(formular, {
    verkaufspostenId: posten.id,
    rechnungsnummer: textOderNull(posten.rechnungsnummer),
    verkaufsdatum: textOderNull(posten.datum),
    gespeichert: !!gespeicherteDaten,
    gespeichertAm,
    einheitStandard: einheitStandard(posten),
  }, warnungen)

  return {
    posten: { id: posten.id, rechnungsnummer: textOderNull(posten.rechnungsnummer), datum: textOderNull(posten.datum), storniert: posten.storniert === true },
    formular,
    gespeichert: !!gespeicherteDaten,
    gespeichertAm,
    zeilen,
    warnungen,
    vorbelegungHinweise,
  }
}

/**
 * Zeitraumliste: alle aktiven Verkaufsposten mit Verkaufsdatum von–bis, die eine
 * Transportbescheinigung brauchen (Tank-, Flaschen- oder Traubenposition) oder eine
 * gespeicherte haben. Stornierte Verkäufe entfallen (Hinweis). Gleiche Spalten wie die
 * einzelne Transportbescheinigung – für die Druckseite /weinhandel/transportbescheinigungen und die CSV.
 * nurGespeichert: nur tatsächlich gespeicherte Transportbescheinigungen (ohne Vorbelegungen).
 */
export async function ladeTransportbescheinigungen(supabase: Client, tenantId: string, p: { von: string; bis: string; nurGespeichert?: boolean }): Promise<{ zeilen: TBZeile[]; warnungen: string[] }> {
  const [postenRes, cfg] = await Promise.all([
    alle<R>((supabase.from('verkaufsposten') as any)
      .select(POSTEN_SELECT)
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .gte('datum', p.von)
      .lte('datum', p.bis)
      .order('datum', { ascending: true })
      .order('id')),
    betriebLaden(supabase, tenantId),
  ])
  if (postenRes.error) throw new Error(`Laden fehlgeschlagen (verkaufsposten): ${postenRes.error.message}`)

  const ids = postenRes.data.map(v => String(v.id))
  const tbJePosten = new Map<string, R>()
  for (const block of inBloecken(ids)) {
    const { data, error } = await alle<R>((supabase.from('transportbescheinigungen') as any)
      .select('verkaufsposten_id, formular_daten, erstellt_am, aktualisiert_am')
      .eq('tenant_id', tenantId)
      .in('verkaufsposten_id', block)
      .order('id'))
    if (error) throw new Error(`Laden fehlgeschlagen (transportbescheinigungen): ${error.message}`)
    for (const t of data) tbJePosten.set(String(t.verkaufsposten_id), t)
  }

  const warnungen: string[] = []
  const hatFormular = (v: R) => {
    const t = tbJePosten.get(String(v.id))
    return !!(t?.formular_daten && typeof t.formular_daten === 'object')
  }
  let storniert = 0
  let ungespeichertAusgeblendet = 0
  const kandidaten = postenRes.data.filter(v => {
    const brauchtTb = ((v.positionen ?? []) as R[]).some(x => (TB_POSITIONSTYPEN as readonly string[]).includes(x.typ))
    if (!brauchtTb && !tbJePosten.has(String(v.id))) return false
    if (v.storniert === true) { storniert++; return false }
    if (p.nurGespeichert && !hatFormular(v)) { ungespeichertAusgeblendet++; return false }
    return true
  })
  const ohneFormular = kandidaten.filter(v => !hatFormular(v))
  const pn = ohneFormular.length > 0 ? await pruefnummernLaden(supabase, tenantId, ohneFormular) : { jeWeinausbau: {}, jeDacAntrag: {} }
  const heute = wienHeute()

  const zeilen: TBZeile[] = []
  for (const v of kandidaten) {
    const t = tbJePosten.get(String(v.id))
    const daten = t?.formular_daten && typeof t.formular_daten === 'object' ? (t.formular_daten as R) : null
    const beleg = textOderNull(v.rechnungsnummer) ?? `Verkauf vom ${feld(v.datum)}`
    // Hinweise der Vorbelegung: nur die zur Prüfnummer (KAN-72) – eine leere Spalte braucht
    // ihren Grund; Farbe/Flaschengröße deckt der Sammelhinweis „bitte prüfen“ unten ab
    const hinweise: string[] = []
    const formular = daten ?? tbVorbelegung(v, cfg, pn, heute, hinweise)
    for (const h of hinweise) if (h.endsWith(TB_PN_NICHT_VORBELEGT)) warnungen.push(`${beleg}: ${h}`)
    zeilen.push(...tbZeilen(formular, {
      verkaufspostenId: String(v.id),
      rechnungsnummer: textOderNull(v.rechnungsnummer),
      verkaufsdatum: textOderNull(v.datum),
      gespeichert: !!daten,
      gespeichertAm: t ? (t.aktualisiert_am ?? t.erstellt_am ?? null) : null,
      einheitStandard: einheitStandard(v),
    }, warnungen, `${beleg}: `))
  }

  if (ohneFormular.length > 0) {
    const belege = ohneFormular.map(v => textOderNull(v.rechnungsnummer) ?? feld(v.datum))
    const liste = belege.slice(0, 10).join(', ') + (belege.length > 10 ? ' …' : '')
    warnungen.unshift(`${ohneFormular.length} von ${kandidaten.length} Transportbescheinigungen sind nicht gespeichert – ausgegeben ist die Vorbelegung wie in der Druckansicht (Spalte „Formularstand“), bitte prüfen: ${liste}`)
  }
  if (storniert > 0) warnungen.push(`${storniert} ${storniert === 1 ? 'stornierter Verkaufsposten' : 'stornierte Verkaufsposten'} nicht enthalten`)
  if (ungespeichertAusgeblendet > 0) warnungen.push(`${ungespeichertAusgeblendet} ${ungespeichertAusgeblendet === 1 ? 'Verkauf' : 'Verkäufe'} ohne gespeicherte Transportbescheinigung ausgeblendet (Filter „nur gespeicherte“)`)
  return { zeilen, warnungen }
}
