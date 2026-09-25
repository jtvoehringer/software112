// ── Traubenverkauf: BKI-Datenblatt (EDV-Liste) und interne Liste (24.09.2026) ─────
//
// BKI-Datenblatt „EDV-Liste zum automatischen Einlesen in die Weindatenbank“
// (§ 3 Weingesetz-Formularverordnung, BGBl. II Nr. 13/2012) – Register-Eintrag
// 'bki-traubenverkauf' mit PROFIL_BKI. Die alte URL /weinhandel/traubenverkauf/datenblatt
// delegiert an /meldungen/bki-traubenverkauf/csv. Gegenüber der alten Route behoben:
//   • ?jahrgang ungültig oder im Betrieb unbekannt → HTTP 400 (vorher still alle Jahrgänge)
//   • alle() statt 1.000er-Deckel, Datum stringbasiert TT.MM.JJJJ (vorher toLocaleDateString
//     in UTC), Menge_kg: ganze kg wie bisher ohne Nachkommastellen (Schnittstelle „Menge int“),
//     nur echte Bruchteile mit Dezimalkomma statt Punkt – samt Hinweis (Review 25.09.2026)
//   • Rebsorte vom Grundstück, sonst vom Ried, sonst vom Zukauf-Posten (KAN-36); Kürzel,
//     Qualitätsstufe und Herkunft nur noch amtlich – Unbekanntes bleibt leer und steht in
//     X-Warnungen (Herkunft: interne Stufe „wlnoe“ → WLNO, Freitext nur als Bezeichnung
//     der Kürzelliste; ein nicht abbildbarer genauerer Wert wird nie durch eine gröbere
//     Quelle ersetzt, herkunftDerLieferung)
//   • Weiss/Rot aus dem Sortenkürzel (vorher feste Liste von 12 roten Sorten)
// Die Spaltenköpfe sind das Format der Weindatenbank und bleiben ohne Umlaute.
//
// Die interne „Traubenverkauf-Liste“ (Bildschirm-Listen auf /weinhandel/traubenverkauf
// und /erntemeldung/[id]) nutzt SPALTEN_TRAUBENVERKAUF_LISTE mit PROFIL_EXCEL_AT.
// Isomorph (auch in Client-Komponenten) – keine Server-/Next-Importe.

import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { bkiFarbe, bkiRebsorteKuerzel, herkunftPruefen, qualitaetBki } from '@/lib/wein/bki_kuerzel'
import { HERKUNFT_LABEL } from '@/lib/herkunft'
import { MeldungsFehler } from './typen'
import { Hinweise, datumAT, textOderNull, zahlOderNull } from './ernte_hilfen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

/**
 * Weder tenant_einstellungen noch kontakte/firmen haben eine eigene Hausnummer-Spalte –
 * die Adresse steckt kombiniert in `strasse` („Musterstraße 12“). Für das BKI-Format
 * (getrennte Straße/Hausnr-Spalten) heuristisch auftrennen.
 */
export function splitStrasseHausnr(full: string | null | undefined): { strasse: string; hausnr: string } {
  if (!full) return { strasse: '', hausnr: '' }
  const m = full.trim().match(/^(.*?),?\s+(\d+[a-zA-Z\-/]*)$/)
  if (m) return { strasse: m[1].trim(), hausnr: m[2].trim() }
  return { strasse: full.trim(), hausnr: '' }
}

// ── BKI-Datenblatt ──────────────────────────────────────────────────────────

type Adresse = { betriebsnr: string; name: string; vorname: string; strasse: string; hausnr: string; plz: string; ort: string }

export type BkiZeile = {
  empf: Adresse
  vers: Adresse
  /** Lieferdatum 'JJJJ-MM-TT' */
  datum: string | null
  mengeKg: number | null
  weiss: boolean | null
  rot: boolean | null
  sorte1: string | null
  qualitaet: string | null
  jahrgang: number | null
  /** amtliches BKI-Herkunftskürzel (herkunftDerLieferung) */
  herkunft: string | null
  kmw: number | null
}

const LEER: Adresse = { betriebsnr: '', name: '', vorname: '', strasse: '', hausnr: '', plz: '', ort: '' }

function adresse(betriebsnr: unknown, name: unknown, vorname: unknown, strasseVoll: unknown, plz: unknown, ort: unknown): Adresse {
  const a = splitStrasseHausnr(textOderNull(strasseVoll))
  return {
    betriebsnr: textOderNull(betriebsnr) ?? '',
    name: textOderNull(name) ?? '',
    vorname: textOderNull(vorname) ?? '',
    strasse: a.strasse,
    hausnr: a.hausnr,
    plz: textOderNull(plz) ?? '',
    ort: textOderNull(ort) ?? '',
  }
}

/** Rebsorte einer Lieferung: Grundstück → Ried → Zukauf-Posten (KAN-36) */
export function rebsorteDerLieferung(v: R): string | null {
  return textOderNull(v.grundstueck?.rebsorte) ?? textOderNull(v.weingarten?.rebsorte) ?? textOderNull(v.zukauf?.rebsorte)
}

type HerkunftQuelle = { quelle: string; kuerzel: string; grund: string | null }

/** Anzeige einer Herkunftsstufe („wein“ → „Wein / Landwein“); ohne Prototyp-Treffer („constructor“) */
function herkunftAnzeige(wert: string): string {
  return Object.prototype.hasOwnProperty.call(HERKUNFT_LABEL, wert) ? HERKUNFT_LABEL[wert] : wert
}

/** Grundstücke des Rieds als eine Quelle: nur ein einheitliches Kürzel zählt. Uneinheitlich ist
 *  auch ein nicht abbildbarer Wert („wein“, Freitext) neben einem gültigen – sonst würde ein
 *  abgestuftes Grundstück über die übrigen aufgestuft (lib/herkunft.ts: Aufstufungen nie).
 *  Unabhängig von der (ungeordneten) Reihenfolge der eingebetteten Grundstücke. */
function herkunftDerRiedGrundstuecke(v: R): HerkunftQuelle | null {
  const quelle = 'Grundstücke des Rieds'
  const werte = [...new Set(((v.weingarten?.grundstuecke ?? []) as R[])
    .map(g => textOderNull(g?.trauben_herkunft_code))
    .filter((w): w is string => w !== null))]
    .sort((a, b) => a.localeCompare(b, 'de'))
  if (werte.length === 0) return null
  const geprueft = werte.map(wert => ({ wert, ...herkunftPruefen(wert, quelle) }))
  const kuerzel = [...new Set(geprueft.map(p => p.kuerzel).filter(Boolean))].sort()
  const ungueltig = geprueft.filter(p => !p.kuerzel)
  if (ungueltig.length === 0 && kuerzel.length === 1) return { quelle, kuerzel: kuerzel[0], grund: null }
  if (kuerzel.length === 0 && ungueltig.length === 1) return { quelle, kuerzel: '', grund: ungueltig[0].grund }
  const teile = [...kuerzel, ...ungueltig.map(p => `„${herkunftAnzeige(p.wert)}“`)]
  return { quelle, kuerzel: '', grund: `Die Grundstücke des Rieds haben unterschiedliche Herkunft (${teile.join(', ')})` }
}

/**
 * Herkunft einer Lieferung als amtliches BKI-Kürzel (KAN-36): am Verkauf erfasst → Grundstück
 * → Ried → Grundstücke des Rieds → Zukauf. Es zählt die erste Quelle mit einem Wert; nur über
 * LEERE Quellen wird weitergeschaltet. Ist der erste erfasste Wert nicht abbildbar (Freitext,
 * eigenes Weinbaugebiet, „wein“/„sonstiges“), bleibt die Spalte leer – kein Ersatz aus einer
 * gröberen Quelle, denn der genauere Wert kann eine bewusste Abstufung sein (traubenverkauf.
 * herkunft_code ist die Kopie zum Erfassungszeitpunkt; lib/herkunft.ts: Aufstufungen nie).
 * Höchstens ein Hinweis je Lieferung: keine Herkunft erfasst bzw. keine gültige (Spalte leer).
 */
export function herkunftDerLieferung(v: R): { kuerzel: string | null; hinweis: string | null } {
  const einzeln = (quelle: string, wert: unknown): HerkunftQuelle | null => {
    const w = textOderNull(wert)
    return w === null ? null : { quelle, ...herkunftPruefen(w, quelle) }
  }
  const quellen = [
    einzeln('Traubenverkauf', v.herkunft_code),
    einzeln('Grundstück', v.grundstueck?.trauben_herkunft_code),
    einzeln('Ried', v.weingarten?.trauben_herkunft_code),
    herkunftDerRiedGrundstuecke(v),
    einzeln('Zukauf', v.zukauf?.herkunft),
  ].filter((q): q is HerkunftQuelle => q !== null)

  const erster = quellen[0]
  if (!erster) return { kuerzel: null, hinweis: 'Keine Herkunft (weder Traubenverkauf noch Grundstück, Ried bzw. Zukauf) – Spalte leer gelassen.' }
  if (erster.kuerzel) return { kuerzel: erster.kuerzel, hinweis: null }
  // Eine spätere Quelle mit Kürzel wird nur genannt, damit klar ist, woher der Unterschied kommt
  const spaeter = quellen.find(q => q.kuerzel)
  return {
    kuerzel: null,
    hinweis: spaeter
      ? `${erster.grund} – Spalte leer gelassen, nicht ersatzweise ${spaeter.kuerzel} (${spaeter.quelle}) gemeldet, bitte prüfen.`
      : `${erster.grund} – Spalte leer gelassen.`,
  }
}

/** Rechnung (Verkaufsposten) des Traubenverkaufs ist storniert? */
export function lieferungStorniert(v: R): boolean {
  return (v.verkaufsposten as R | null | undefined)?.storniert === true
}

/**
 * Traubenverkäufe mit stornierter Rechnung weglassen – gleiche Regel für BKI-Datenblatt und
 * Erntemeldung („davon als Trauben verkauft“). Der Datensatz bleibt nach einem Storno bestehen
 * (weinhandel/traubenverkauf/actions.ts: „bitte den Traubenverkauf löschen und neu erfassen“);
 * ein neu erfasster Ersatz würde sonst doppelt gemeldet. Liefert den Hinweis für X-Warnungen.
 */
export function ohneStornierte<T extends R>(verkaeufe: readonly T[]): { gueltig: T[]; hinweis: string | null } {
  const storniert = verkaeufe.filter(lieferungStorniert)
  if (storniert.length === 0) return { gueltig: [...verkaeufe], hinweis: null }
  const bezug = storniert.map(v => textOderNull(v.liefernummer) ?? `vom ${datumAT(textOderNull(v.datum))}`)
  const auszug = bezug.slice(0, 5).join(', ') + (bezug.length > 5 ? ' …' : '')
  return {
    gueltig: verkaeufe.filter(v => !lieferungStorniert(v)),
    hinweis: `${storniert.length} ${storniert.length === 1 ? 'Traubenverkauf mit stornierter Rechnung ist' : 'Traubenverkäufe mit stornierter Rechnung sind'} nicht enthalten (${auszug}) – den Traubenverkauf löschen bzw. neu erfassen.`,
  }
}

/** Datensätze → Zeilen der EDV-Liste samt Hinweisen (reine Funktion, testbar ohne Datenbank) */
export function bkiZeilen(alleVerkaeufe: readonly R[], betrieb: R | null): { zeilen: BkiZeile[]; warnungen: string[] } {
  const hinweise = new Hinweise(['Lieferung', 'Lieferungen'])
  const { gueltig: verkaeufe, hinweis: stornoHinweis } = ohneStornierte(alleVerkaeufe)
  if (stornoHinweis) hinweise.add(stornoHinweis)
  const vers = adresse(betrieb?.betrieb_betriebsnummer, betrieb?.betrieb_name, null, betrieb?.betrieb_strasse, betrieb?.betrieb_plz, betrieb?.betrieb_ort)
  if (verkaeufe.length > 0 && !vers.betriebsnr) {
    hinweise.add('Die Betriebsnummer des eigenen Betriebs fehlt (Einstellungen › Betriebsdaten) – Betriebsnr_Vers leer gelassen.')
  }

  const zeilen = verkaeufe.map(v => {
    const bezug = textOderNull(v.liefernummer) ?? `Lieferung vom ${datumAT(textOderNull(v.datum))}`
    let empf = LEER
    if (v.kontakt) {
      const k = v.kontakt as R
      empf = adresse(k.betrieb_nr, k.nachname, k.vorname, k.strasse, k.plz, k.ort)
    } else if (v.firma) {
      const f = v.firma as R
      empf = adresse(f.betrieb_nr, f.name, null, f.strasse, f.plz, f.ort)
    }
    if (!v.kontakt && !v.firma) hinweise.add('Kein Abnehmer erfasst – Empfängerfelder leer gelassen.', bezug)
    else if (!empf.betriebsnr) hinweise.add(`Abnehmer „${[empf.vorname, empf.name].filter(Boolean).join(' ')}“ ohne BKI-Betriebsnummer (Stammdaten Kontakt bzw. Firma) – Betriebsnr_Empf leer gelassen.`, bezug)

    const rebsorte = rebsorteDerLieferung(v)
    const sorte1 = bkiRebsorteKuerzel(rebsorte)
    const farbe = bkiFarbe(rebsorte)
    if (!rebsorte) hinweise.add('Keine Rebsorte (weder Grundstück noch Ried bzw. Zukauf) – Sorte1, Weiss und Rot leer gelassen.', bezug)
    else if (!sorte1) hinweise.add(`Rebsorte „${rebsorte}“ steht nicht in der BKI-Kürzelliste – Sorte1, Weiss und Rot leer gelassen.`, bezug)
    else if (!farbe) hinweise.add(`Rebsorte „${rebsorte}“ (${sorte1}): Farbe nicht eindeutig – Weiss und Rot leer gelassen.`, bezug)

    const kg = zahlOderNull(v.menge_kg)
    const mengeKg = kg === null ? null : runden(kg, STELLEN.kgGenau)
    if (mengeKg !== null && !Number.isInteger(mengeKg)) {
      hinweise.add('Menge mit Nachkommastellen – die Weindatenbank erwartet laut Schnittstellenbeschreibung ganze kg; vor dem Upload prüfen bzw. am Traubenverkauf auf ganze kg korrigieren.', bezug)
    }

    const q = qualitaetBki(textOderNull(v.qualitaetsstufe))
    if (q.hinweis) hinweise.add(q.hinweis, bezug)

    const herkunft = herkunftDerLieferung(v)
    if (herkunft.hinweis) hinweise.add(herkunft.hinweis, bezug)

    return {
      empf,
      vers,
      datum: textOderNull(v.datum),
      mengeKg,
      weiss: farbe === null ? null : farbe === 'weiss',
      rot: farbe === null ? null : farbe === 'rot',
      sorte1,
      qualitaet: q.kuerzel || null,
      jahrgang: zahlOderNull((v.jahrgang as R | null)?.jahrgang),
      herkunft: herkunft.kuerzel,
      kmw: zahlOderNull(v.kmw_grad),
    }
  })
  return { zeilen, warnungen: hinweise.liste() }
}

/**
 * Traubenverkäufe des Betriebs (optional eines Jahrgangs) als EDV-Liste.
 * Ein angegebener, im Betrieb unbekannter Jahrgang bricht mit HTTP 400 ab.
 */
export async function ladeBkiTraubenverkauf(
  supabase: Client,
  tenantId: string,
  p: { jahrgang: number | null },
): Promise<{ zeilen: BkiZeile[]; warnungen: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const einstellungen = (supabase.from('tenant_einstellungen') as any)
    .select('betrieb_betriebsnummer, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  let jahrgangId: string | null = null
  if (p.jahrgang !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jg, error } = await (supabase.from('weinjahrgaenge') as any)
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('jahrgang', p.jahrgang)
      .maybeSingle()
    if (error) throw new Error(`Laden fehlgeschlagen (weinjahrgaenge): ${error.message}`)
    if (!jg) throw new MeldungsFehler(400, `Den Jahrgang ${p.jahrgang} gibt es in diesem Betrieb nicht.`)
    jahrgangId = (jg as R).id
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let abfrage = (supabase.from('traubenverkauf') as any)
    .select(`
      id, datum, liefernummer, menge_kg, kmw_grad, qualitaetsstufe, herkunft_code,
      weingarten:weingarten_id(name, rebsorte, trauben_herkunft_code, grundstuecke(trauben_herkunft_code)),
      grundstueck:grundstueck_id(rebsorte, trauben_herkunft_code),
      zukauf:zukauf_posten_id(rebsorte, herkunft),
      kontakt:kontakt_id(betrieb_nr, vorname, nachname, strasse, plz, ort),
      firma:firma_id(betrieb_nr, name, strasse, plz, ort),
      jahrgang:jahrgang_id(jahrgang),
      verkaufsposten:verkaufsposten_id(storniert, rechnungsnummer)
    `)
    .eq('tenant_id', tenantId)
  if (jahrgangId) abfrage = abfrage.eq('jahrgang_id', jahrgangId)

  const [{ data: betrieb, error: eFehler }, { data: verkaeufe, error: vFehler }] = await Promise.all([
    einstellungen,
    alle<R>(abfrage.order('datum', { ascending: true }).order('id')),
  ])
  if (eFehler) throw new Error(`Laden fehlgeschlagen (tenant_einstellungen): ${eFehler.message}`)
  if (vFehler) throw new Error(`Laden fehlgeschlagen (traubenverkauf): ${vFehler.message}`)
  return bkiZeilen(verkaeufe, (betrieb ?? null) as R | null)
}

const adr = (feld: keyof Adresse, seite: 'empf' | 'vers', kopf: string): CsvSpalte<BkiZeile> =>
  ({ kopf, typ: feld === 'name' || feld === 'vorname' || feld === 'strasse' || feld === 'ort' ? 'text' : 'code', wert: z => z[seite][feld] })

/** Spalten der EDV-Liste – Reihenfolge und Köpfe exakt wie bisher (Format der Weindatenbank) */
export const SPALTEN_BKI_TRAUBENVERKAUF: CsvSpalte<BkiZeile>[] = [
  adr('betriebsnr', 'empf', 'Betriebsnr_Empf'), adr('name', 'empf', 'Name_Empf'), adr('vorname', 'empf', 'Vorname_Empf'),
  adr('strasse', 'empf', 'Strasse_Empf'), adr('hausnr', 'empf', 'Hausnr_Empf'), adr('plz', 'empf', 'PLZ_Empf'), adr('ort', 'empf', 'Ort_Empf'),
  adr('betriebsnr', 'vers', 'Betriebsnr_Vers'), adr('name', 'vers', 'Name_Vers'), adr('vorname', 'vers', 'Vorname_Vers'),
  adr('strasse', 'vers', 'Strasse_Vers'), adr('hausnr', 'vers', 'Hausnr_Vers'), adr('plz', 'vers', 'PLZ_Vers'), adr('ort', 'vers', 'Ort_Vers'),
  { kopf: 'Datum_Lieferung', typ: 'datum', wert: z => z.datum },
  // Ganze kg ohne Komma (wie bisher, Schnittstelle „Menge int“), Bruchteile mit Dezimalkomma:
  // 'roh' = kürzeste Darstellung des bereits auf 2 Stellen gerundeten Werts (1250 → 1250, 1250,5 → "1250,5")
  { kopf: 'Menge_kg', typ: 'dezimal', stellen: 'roh', wert: z => z.mengeKg },
  { kopf: 'Art', typ: 'code', wert: () => 'TB' },                 // Art laut BKI-Kürzelliste: TB = Trauben
  { kopf: 'Weiss', typ: 'janein', wert: z => z.weiss },
  { kopf: 'Rot', typ: 'janein', wert: z => z.rot },
  { kopf: 'Sorte1', typ: 'code', wert: z => z.sorte1 },
  { kopf: 'Sorte2', typ: 'code', wert: () => null },
  { kopf: 'Sorte3', typ: 'code', wert: () => null },
  { kopf: 'Qualitaetsstufe', typ: 'code', wert: z => z.qualitaet },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Herkunft', typ: 'code', wert: z => z.herkunft },
  { kopf: 'KMW_Grad', typ: 'dezimal', stellen: STELLEN.kmwBki, wert: z => z.kmw },
  { kopf: 'Oechsle', typ: 'ganzzahl', wert: () => null },          // Pflichtspalte, leer wenn KMW angegeben
]

// ── Interne Traubenverkauf-Liste (Bildschirm-Listen, Excel) ──────────────────

export type TraubenverkaufListenZeile = {
  liefernummer: string | null
  /** 'JJJJ-MM-TT' */
  datum: string | null
  jahrgang: number | null
  /** Ried bzw. „Zukauf – …“ */
  quelle: string | null
  gstNr: string | null
  mengeKg: number | null
  preisProKg: number | null
  kmw: number | null
  /** Anzeige-Bezeichnung (qualitaetLabel) */
  qualitaet: string | null
  gesundheit: string | null
  herkunftscode: string | null
  kaeufer: string | null
  rechnungsnummer: string | null
  notizen: string | null
}

/** Betrag der Lieferung (€), kaufmännisch auf Cent */
export function betragDerLieferung(z: Pick<TraubenverkaufListenZeile, 'mengeKg' | 'preisProKg'>): number | null {
  return z.mengeKg !== null && z.preisProKg !== null ? runden(z.mengeKg * z.preisProKg, STELLEN.betrag) : null
}

export const SPALTEN_TRAUBENVERKAUF_LISTE: CsvSpalte<TraubenverkaufListenZeile>[] = [
  { kopf: 'Liefernummer', typ: 'code', wert: z => z.liefernummer },
  { kopf: 'Lieferdatum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Quelle (Ried bzw. Zukauf)', typ: 'text', wert: z => z.quelle },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: STELLEN.kgGenau, wert: z => z.mengeKg },
  { kopf: 'Preis (€/kg)', typ: 'dezimal', stellen: 4, wert: z => z.preisProKg },
  { kopf: 'Betrag (€)', typ: 'betrag', wert: z => betragDerLieferung(z) },
  { kopf: 'Mostgewicht (°KMW)', typ: 'dezimal', stellen: STELLEN.kmwBki, wert: z => z.kmw },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => z.qualitaet },
  { kopf: 'Gesundheit (G/K)', typ: 'code', wert: z => z.gesundheit },
  { kopf: 'Herkunftscode', typ: 'code', wert: z => z.herkunftscode },
  { kopf: 'Käufer', typ: 'text', wert: z => z.kaeufer },
  { kopf: 'Rechnung', typ: 'code', wert: z => z.rechnungsnummer },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
]
