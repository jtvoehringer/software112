// ── Weinerntemeldung und Lesedaten (Behördenmeldungen „Ernte & Lese“, 24.09.2026) ──
//
// Eine Quelle für Druck, Bildschirm und CSV:
//   /reports/ama                 Druck „AMA Weinerntemeldung“        → ladeErntemeldung()
//   /erntemeldung/[id]           Lese-Seite (Druck, Bearbeiten)      → ladeLesedaten(),
//                                                                      berechneHektarhoechstertrag()
//   /meldungen/erntemeldung/csv  und /meldungen/lesedaten/csv        → register/ernte.ts
//   erntemeldung/actions.ts      „AMA-Meldung erstellen“ schreibt die Meldepositionen
//                                mit aggregiereJeRebsorte() – Vorschau, Druck und gespeicherte
//                                Meldung rechnen damit gleich.
//
// Zahlen je Zeile sind bereits gerundet (runden() aus lib/csv, Stellen wie die CSV-Spalte);
// Summen im Ausdruck addieren genau diese Werte – CSV und Ausdruck stimmen überein.
// Mostgewicht (KAN-128): °KMW und °Oe, °KMW-Mittelwerte abgerundet (Entscheidung 8), Lesedaten
// zusätzlich mit der gemessenen Einheit – Regeln in mostgewicht_export.ts.
// Ohne 'server-only' und ohne Next-Importe: scripts/tests/ernte.test.mjs lädt die Datei direkt.

import { herkunftBundesland, herkunftGebietTolerant } from '@/lib/herkunft'
import { amaAktualisierenText } from './amaMeldung'
import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { mischen } from '@/lib/wein/mostgewicht'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { erntemeldungRahmen, leseTitel } from '@/lib/wein/lesen'
import { MeldungsFehler } from './typen'
import { Hinweise, datumAT, kuerzelWarnungen, textOderNull, zahlOderNull } from './ernte_hilfen'
import { gemessenInText, mostgewichtFuerExport, type MostgewichtExport } from './mostgewicht_export'
import { ohneStornierte } from './traubenverkauf'
import { gstImJahr } from '../wein/grundstueckAktiv'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

/** Hektarhöchstertrag lt. BKI-Hinweis (18.07.2026): 10.000 kg/ha, betriebsweit gegen die GST-Fläche lt. AMA */
export const HEKTARHOECHSTERTRAG_KG_HA = 10000
/** Gilt der Hektarhöchstertrag für eine Lese dieser Stufe? KAN-79 (02.10.2026, Bezugsebene Betrieb lt. Jörgen):
 *  § 23 Abs. 1 WeinG 2009 erfasst Wein gemäß § 8 (Wein MIT Rebsorten- bzw. Jahrgangsangabe), Land-, Qualitäts- und
 *  Prädikatswein. Frei ist nur Wein ohne Rebsorten- und Jahrgangsbezeichnung – das unterscheidet die Lese nicht (sie
 *  trägt immer Sorte und Jahrgang), also zählt jede Lese, auch „Wein“ (bis 01.10.2026 nur 'qualitaetswein'). Ohne
 *  bzw. mit unbekannter Stufe zählt sie ebenfalls (sichere Richtung). */
export function unterliegtHoechstertrag(stufe: string | null | undefined): boolean {
  const r = qualitaetsRang(stufe)
  return !r || r.art !== 'erzeugnis'
}
/** Hinweis bei Überschreitung (Erntemeldung, Lese-Seite, Druck, CSV) */
export { HOECHSTERTRAG_RECHTSFOLGE } from './hoechstertragText'
import { qualitaetsRang } from '../wein/qualitaetsrang'
import { HOECHSTERTRAG_RECHTSFOLGE } from './hoechstertragText'
import { AktionsFehler } from '@/lib/fehler'
/** Umrechnung Trauben → Most, wenn keine hl erfasst sind */
export const KG_JE_HL = 130
/** Schlüssel für Lesedaten ohne Rebsorte (wie bisher in „AMA-Meldung erstellen“) */
export const REBSORTE_UNBEKANNT = 'Unbekannt'

const LESEMETHODE_LABEL: Record<string, string> = {
  handlese: 'Handlese',
  maschinenlese: 'Maschinenlese',
  selektionslese: 'Selektionslese',
}

export type Jahrgang = { id: string; jahrgang: number }

// ── Jahrgang ────────────────────────────────────────────────────────────────

/** Jahrgang des Betriebs (mandantengefiltert) oder null */
export async function jahrgangFinden(supabase: Client, tenantId: string, jahrgang: number): Promise<Jahrgang | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('weinjahrgaenge') as any)
    .select('id, jahrgang')
    .eq('tenant_id', tenantId)
    .eq('jahrgang', jahrgang)
    .maybeSingle()
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (weinjahrgaenge): ${error.message}`)
  if (!data) return null
  return { id: (data as R).id, jahrgang: Number((data as R).jahrgang) }
}

/** Wie jahrgangFinden(), ein unbekannter Jahrgang bricht mit HTTP 400 ab (CSV-Route) */
export async function jahrgangPflicht(supabase: Client, tenantId: string, jahrgang: number): Promise<Jahrgang> {
  const jg = await jahrgangFinden(supabase, tenantId, jahrgang)
  if (!jg) throw new MeldungsFehler(400, `Den Jahrgang ${jahrgang} gibt es in diesem Betrieb nicht.`)
  return jg
}

// ── Lesedaten je Parzelle ───────────────────────────────────────────────────

export type LeseZeile = {
  id: string
  /** Lese des Eintrags (KAN-129, lesen.id) */
  leseId: string | null
  /** „2026/1 Hauptlese“ (KAN-129, CSV-Spalte „Lese“) */
  lese: string | null
  /** lfd. Nr. der Lese – Sortierung/Gruppierung */
  leseNr: number | null
  weingartenId: string | null
  /** Ried (weingarten.name) */
  ried: string | null
  weingartenRebsorte: string | null
  weingartenFlaecheHa: number | null
  grundstueckId: string | null
  gstNr: string | null
  /** Katastralgemeinde (Code, z. B. '04023' – bleibt unverändert) */
  kgNr: string | null
  grundstueckRebsorte: string | null
  grundstueckFlaecheHa: number | null
  /** Rebsorte des Grundstücks, sonst die des Rieds (wie in der Lesedaten-Tabelle) */
  rebsorte: string | null
  /** KAN-165: Bundesland-Gebiet (Niederösterreich, Burgenland, Wien, Steiermark, Bergland-Bundesland) aus dem
   *  Herkunft-Code des Grundstücks, sonst des Rieds, der Lese bzw. dem Weinbaugebiet am Ried – Gliederung der Erntemeldung */
  weinbaugebiet: string | null
  /** KAN-165: genauestes Gebiet im selben Bundesland (Weinbaugebiet am Ried, sonst aus dem Code) – Kopf der AMA-Meldung */
  gebietGenau: string | null
  kuerzel: string | null
  /** Lesedatum 'JJJJ-MM-TT' */
  datum: string | null
  /** kg (numeric(12,2) – verlustfrei auf 2 Stellen) */
  mengeKg: number | null
  mengeHl: number | null
  /** °Oe wie gespeichert (Bearbeiten) */
  oechsle: number | null
  /** °KMW wie gespeichert (Bearbeiten); Ausgabe über `mostgewicht` */
  kmw: number | null
  /** gemessene Einheit wie gespeichert ('kmw' | 'oechsle'; vor Migration A null) */
  mostgewichtEinheit: string | null
  /** Mostgewicht für Anzeige und CSV (KAN-128): beide Werte, °KMW mit STELLEN.kmw, °Oe mit
   *  STELLEN.oechsle, gemessene Einheit – nichts neu gerechnet, nur ein fehlender Wert ergänzt */
  mostgewicht: MostgewichtExport
  qualitaetsstufe: string | null
  /** KAN-81: Herkunft-Code des Eintrags (ggf. abgestuft) und Art der Lese (Obergrenze der Stufe beim Bearbeiten) */
  herkunftCode: string | null
  leseArt: string | null
  lesemethode: string | null
  notizen: string | null
  /** KAN-148 C1b: Storno (Zeitpunkt, Grund, Benutzer) – nur mit `mitStornierten` geladen, sonst immer null */
  storniertAm: string | null
  stornoGrund: string | null
  storniertVon: string | null
}

function leseFelder(l: R | null): { lese: string | null; leseNr: number | null } {
  const nr = zahlOderNull(l?.lfd_nr)
  const jahr = zahlOderNull((l?.jahrgang as R | null)?.jahrgang)
  if (nr === null) return { lese: null, leseNr: null }
  return { lese: jahr === null ? String(nr) : leseTitel(jahr, { lfd_nr: nr, art: textOderNull(l?.art) ?? '', bezeichnung: null }), leseNr: nr }
}

/**
 * KAN-165: Gebiet einer Lese. Bundesland aus dem ersten erfassten Wert: Herkunft-Code des Grundstücks, des Rieds, der
 * Lese, zuletzt das Weinbaugebiet am Ried (Freitext). Das genaue Gebiet bevorzugt das Weinbaugebiet am Ried (geografisch –
 * der Code kann abgestuft sein), sonst den Code – nur wenn es im selben Bundesland liegt.
 */
export function gebietDerLese(p: R, wg: R | null, gst: R | null): { weinbaugebiet: string | null; gebietGenau: string | null } {
  const codes = [gst?.trauben_herkunft_code, wg?.trauben_herkunft_code, p.herkunft_code].map(textOderNull)
  const freitext = textOderNull(wg?.weinbaugebiet)
  const weinbaugebiet = [...codes, freitext].map(herkunftBundesland).find(Boolean) ?? null
  if (!weinbaugebiet) return { weinbaugebiet: null, gebietGenau: null }
  const gebietGenau = [freitext, ...codes].map(herkunftGebietTolerant)
    .find(g => !!g && herkunftBundesland(g) === weinbaugebiet) ?? weinbaugebiet
  return { weinbaugebiet, gebietGenau }
}

function zuLeseZeile(p: R): LeseZeile {
  const wg = (p.weingarten ?? null) as R | null
  const gst = (p.grundstueck ?? null) as R | null
  const weingartenRebsorte = textOderNull(wg?.rebsorte)
  const grundstueckRebsorte = textOderNull(gst?.rebsorte)
  const rebsorte = grundstueckRebsorte ?? weingartenRebsorte
  const kg = zahlOderNull(p.menge_kg)
  const { weinbaugebiet, gebietGenau } = gebietDerLese(p, wg, gst)
  return {
    id: p.id,
    leseId: textOderNull(p.lese_id),
    ...leseFelder(p.lese as R | null),
    weingartenId: p.weingarten_id ?? null,
    ried: textOderNull(wg?.name),
    weingartenRebsorte,
    weingartenFlaecheHa: zahlOderNull(wg?.flaeche_ha),
    grundstueckId: p.grundstueck_id ?? null,
    gstNr: textOderNull(gst?.gst_nr),
    kgNr: textOderNull(gst?.katastralgemeinde),
    grundstueckRebsorte,
    grundstueckFlaecheHa: zahlOderNull(gst?.flaeche_ha),
    rebsorte,
    weinbaugebiet,
    gebietGenau,
    kuerzel: bkiRebsorteKuerzel(rebsorte),
    datum: textOderNull(p.ernte_datum),
    mengeKg: kg === null ? null : runden(kg, STELLEN.kgGenau),
    mengeHl: zahlOderNull(p.menge_hl),
    oechsle: zahlOderNull(p.oechsle),
    kmw: zahlOderNull(p.klosterneuburger),
    mostgewichtEinheit: textOderNull(p.mostgewicht_einheit),
    mostgewicht: mostgewichtFuerExport({ kmw: p.klosterneuburger, oechsle: p.oechsle, einheit: p.mostgewicht_einheit }, 2),   // 2 = STELLEN.kmw (verlustfrei)
    qualitaetsstufe: textOderNull(p.qualitaetsstufe),
    herkunftCode: textOderNull(p.herkunft_code),
    leseArt: textOderNull((p.lese as R | null)?.art),
    lesemethode: textOderNull(p.lesemethode),
    notizen: textOderNull(p.notizen),
    storniertAm: textOderNull(p.storniert_am),
    stornoGrund: textOderNull(p.storno_grund),
    storniertVon: textOderNull(p.storniert_von_name),
  }
}

function vergleicheLese(a: LeseZeile, b: LeseZeile): number {
  const d = (a.datum ?? '9999').localeCompare(b.datum ?? '9999')
  if (d) return d
  const r = (a.ried ?? '').localeCompare(b.ried ?? '', 'de')
  if (r) return r
  const g = (a.gstNr ?? '').localeCompare(b.gstNr ?? '', 'de', { numeric: true })
  return g || a.id.localeCompare(b.id)
}

/**
 * Lesedaten eines Jahrgangs, chronologisch (Lesedatum, Ried, GST-Nr.).
 * ernte_parzellen hat keine tenant_id – nur mit einer Jahrgangs-id aufrufen, die per
 * .eq('tenant_id', …) geprüft ist (jahrgangFinden() bzw. die Jahrgangsabfrage der Seite).
 * KAN-148 C1b: stornierte Einträge nur mit `mitStornierten` (Lesedaten-Druck und -CSV, Liste der Lese-Seite
 * zeigen sie gekennzeichnet) – Summen, Erntemeldung, AMA und Hektarhöchstertrag laden ohne sie.
 */
export async function ladeLesedaten(
  supabase: Client, jahrgangId: string, opt: { mitStornierten?: boolean } = {},
): Promise<{ zeilen: LeseZeile[]; warnungen: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let abfrage = (supabase.from('ernte_parzellen') as any)
    .select('id, lese_id, lese:lesen!ernte_parzellen_lese_fkey(lfd_nr, art, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)), weingarten_id, grundstueck_id, ernte_datum, menge_kg, menge_hl, oechsle, klosterneuburger, mostgewicht_einheit, qualitaetsstufe, lesemethode, notizen, storniert_am, storno_grund, storniert_von_name, herkunft_code, weingarten:weingarten_id(name, rebsorte, flaeche_ha, weinbaugebiet, trauben_herkunft_code), grundstueck:grundstueck_id(gst_nr, katastralgemeinde, rebsorte, flaeche_ha, trauben_herkunft_code)')
    .eq('jahrgang_id', jahrgangId)
    // storno-sichtbar: stornierte nur mit opt.mitStornierten (gekennzeichnet in Druck, CSV und Liste)
  if (!opt.mitStornierten) abfrage = abfrage.is('storniert_am', null)
  const { data, error } = await alle<R>(abfrage.order('ernte_datum', { ascending: true }).order('id'))
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (ernte_parzellen): ${error.message}`)
  const zeilen = data.map(zuLeseZeile).sort(vergleicheLese)
  // X-Warnung nur, wenn die exportierte Rundung eines Messwerts die Stufe ändert (KAN-128, Absicherung)
  const mostgewicht = new Hinweise(['Lese', 'Lesen'])
  for (const z of zeilen) {
    if (z.storniertAm) continue
    if (z.mostgewicht.stufenHinweis) {
      mostgewicht.add(z.mostgewicht.stufenHinweis, [datumAT(z.datum), z.ried, z.gstNr ? `GST ${z.gstNr}` : null].filter(Boolean).join(' '))
    }
  }
  return { zeilen, warnungen: [...kuerzelWarnungen(zeilen.map(z => z.rebsorte)), ...mostgewicht.liste()] }
}

// Mostgewicht (KAN-128): °KMW vor °Oe, dazu die gemessene Einheit – der andere Wert ist umgerechnet.
// Notizen (KAN-144, z. B. Grund für 0 kg) bewusst als letzte Spalte – die bisherigen Spaltenpositionen
// bleiben gleich; Freitext mit Formelschutz, Umbrüche als Leerzeichen, „;“ in Anführungszeichen (csvText).
export const SPALTEN_LESEDATEN: CsvSpalte<LeseZeile>[] = [
  { kopf: 'Lesedatum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.kgNr },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: STELLEN.kgGenau, wert: z => z.mengeKg },
  { kopf: 'Mostgewicht (°KMW)', typ: 'dezimal', stellen: STELLEN.kmw, wert: z => z.mostgewicht.kmw },
  { kopf: 'Mostgewicht (°Oe)', typ: 'dezimal', stellen: STELLEN.oechsle, wert: z => z.mostgewicht.oechsle },
  { kopf: 'Mostgewicht gemessen in', typ: 'text', wert: z => gemessenInText(z.mostgewicht.einheit) },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => (z.qualitaetsstufe ? qualitaetLabel(z.qualitaetsstufe) : null) },
  { kopf: 'Lesemethode', typ: 'text', wert: z => (z.lesemethode ? LESEMETHODE_LABEL[z.lesemethode] ?? z.lesemethode : null) },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
  // KAN-129 (Frage 8): Lese als letzte Spalte – die bisherigen Spaltenpositionen bleiben
  { kopf: 'Lese', typ: 'text', wert: z => z.lese },
  // KAN-148 C1b: stornierte Einträge bleiben in der Liste, gekennzeichnet – wieder hinten angefügt
  { kopf: 'Storniert am', typ: 'zeitpunkt', wert: z => z.storniertAm },
  { kopf: 'Storno-Grund', typ: 'text', wert: z => z.stornoGrund },
]

/** KAN-148 C1b: nur nicht stornierte Lesedaten (Summen, Meldungen) */
export function ohneStornierteLese<Z extends { storniertAm: string | null }>(zeilen: readonly Z[]): Z[] {
  return zeilen.filter(z => !z.storniertAm)
}

// ── Stichtag 30.11. (KAN-129 Frage 7, Entscheidung Jörgen 29.09.2026) ─────────────────────────────────────
// Die Erntemeldung erfasst das Lesegut zum 30. November (§ 29 Abs. 1 WeinG). Später Gelesenes (z. B. Eiswein im
// Jänner) zählt bis zur Klärung (KAN-38) nicht in Erntemeldung und AMA-Meldung, sondern wird gesondert
// ausgewiesen. Hektarhöchstertrag und Lesedaten umfassen weiter den ganzen Jahrgang. Ohne Datum zählt mit.

export function erntemeldungStichtag(jahrgang: number): string {
  return erntemeldungRahmen(jahrgang).stichtag   // dieselbe Quelle wie die Anzeige (KAN-327)
}

export function teileNachStichtag<Z extends { datum: string | null }>(zeilen: readonly Z[], jahrgang: number): { bis: Z[]; danach: Z[] } {
  const stichtag = erntemeldungStichtag(jahrgang)
  const bis: Z[] = []
  const danach: Z[] = []
  for (const z of zeilen) (z.datum && z.datum.slice(0, 10) > stichtag ? danach : bis).push(z)
  return { bis, danach }
}

/** Hinweis auf Lesegut nach dem Stichtag (je Rebsorte) oder null */
export function stichtagHinweis(danach: readonly LeseZeile[], jahrgang: number): string | null {
  const summen = aggregiereJeRebsorte(danach.map(parzelleFuerMeldung)).filter(s => s.mengeKg > 0)
  if (summen.length === 0) return null
  const liste = summen.map(s => `${s.rebsorte} ${fmtKg(runden(s.mengeKg, STELLEN.kg))} kg`).join(', ')
  return `Nach dem Stichtag 30.11.${jahrgang} gelesen und in der Erntemeldung nicht enthalten (gesondert auszuweisen): ${liste}.`
}

// ── Aggregation je Rebsorte (Vorschau, Druck, „AMA-Meldung erstellen“) ───────

export type ParzelleFuerMeldung = {
  /** KAN-165: Bundesland-Gebiet – eigene Position je Gebiet und Rebsorte (fehlt = ohne Gebiet, wie bisher) */
  weinbaugebiet?: string | null
  weingartenId: string | null
  grundstueckId: string | null
  rebsorte: string | null
  /** Fläche des Grundstücks, ohne Grundstück die des Rieds */
  flaecheHa: number | null
  mengeKg: number | null
  mengeHl?: number | null
  qualitaetsstufe: string | null
}

export type RebsortenSumme = {
  rebsorte: string
  /** KAN-165: Bundesland-Gebiet der Position (null = ohne Gebiet) */
  weinbaugebiet: string | null
  flaecheHa: number
  mengeKg: number
  mengeHl: number
  /** mindestens ein Anteil ohne erfasste hl → aus kg ÷ KG_JE_HL */
  hlGeschaetzt: boolean
  qualitaetsstufen: string[]
}

/** Lesezeile → Eingabe der Aggregation (Rebsorte und Fläche vom Grundstück, sonst vom Ried) */
export function parzelleFuerMeldung(z: LeseZeile): ParzelleFuerMeldung {
  return {
    weinbaugebiet: z.weinbaugebiet,
    weingartenId: z.weingartenId,
    grundstueckId: z.grundstueckId,
    rebsorte: z.rebsorte,
    flaecheHa: z.grundstueckId ? z.grundstueckFlaecheHa : z.weingartenFlaecheHa,
    mengeKg: z.mengeKg,
    mengeHl: z.mengeHl,
    qualitaetsstufe: z.qualitaetsstufe,
  }
}

/** KAN-165: Schlüssel einer Position – Rebsorte, bei mehreren Gebieten zusätzlich das Gebiet (ohne Gebiet wie bisher) */
export function positionsKey(weinbaugebiet: string | null | undefined, rebsorte: string | null | undefined): string {
  const sorte = rebsorte?.trim() || REBSORTE_UNBEKANNT
  return weinbaugebiet ? `${weinbaugebiet}\u0000${sorte}` : sorte
}

/** Kopf der AMA-Meldung (KAN-165): je Bundesland-Gebiet das genaue Gebiet, wenn alle Lesen dort dasselbe haben
 *  („Thermenregion“), sonst das Bundesland („Niederösterreich“); sortiert. */
export function kopfGebiete(lese: readonly Pick<LeseZeile, 'weinbaugebiet' | 'gebietGenau'>[]): string[] {
  const je = new Map<string, Set<string>>()
  for (const z of lese) {
    if (!z.weinbaugebiet) continue
    const s = je.get(z.weinbaugebiet) ?? new Set<string>()
    s.add(z.gebietGenau ?? z.weinbaugebiet)
    je.set(z.weinbaugebiet, s)
  }
  return [...je].map(([land, genau]) => (genau.size === 1 ? [...genau][0] : land)).sort((a, b) => a.localeCompare(b, 'de'))
}

/** Lesbare Bezeichnung eines Positionsschlüssels: „Zweigelt (Burgenland)“ bzw. nur die Sorte */
export function positionsName(key: string): string {
  const i = key.indexOf('\u0000')
  return i < 0 ? key : `${key.slice(i + 1)} (${key.slice(0, i)})`
}

/**
 * Lesedaten je Weinbaugebiet und Rebsorte summieren (KAN-165: Gebiet = Bundesland, siehe gebietDerLese).
 * Die Fläche jedes Grundstücks (bzw. Rieds ohne
 * Grundstück) zählt je Rebsorte nur EINMAL – zwei Lesedurchgänge auf demselben
 * Grundstück verdoppeln die Ertragsfläche nicht mehr (vorher: Fläche je Lesezeile).
 */
export function aggregiereJeRebsorte(parzellen: readonly ParzelleFuerMeldung[]): RebsortenSumme[] {
  const summen = new Map<string, { s: RebsortenSumme; flaechen: Set<string> }>()
  for (const p of parzellen) {
    const sorte = p.rebsorte?.trim() || REBSORTE_UNBEKANNT
    const gebiet = p.weinbaugebiet ?? null
    const key = positionsKey(gebiet, sorte)
    const e = summen.get(key) ?? {
      s: { rebsorte: sorte, weinbaugebiet: gebiet, flaecheHa: 0, mengeKg: 0, mengeHl: 0, hlGeschaetzt: false, qualitaetsstufen: [] },
      flaechen: new Set<string>(),
    }
    const flaechenKey = p.grundstueckId ? `gst:${p.grundstueckId}` : `wg:${p.weingartenId ?? ''}`
    if (!e.flaechen.has(flaechenKey)) {
      e.flaechen.add(flaechenKey)
      e.s.flaecheHa += p.flaecheHa ?? 0
    }
    const kg = p.mengeKg ?? 0
    e.s.mengeKg += kg
    if (p.mengeHl !== null && p.mengeHl !== undefined) e.s.mengeHl += p.mengeHl
    else if (kg) { e.s.mengeHl += kg / KG_JE_HL; e.s.hlGeschaetzt = true }
    if (p.qualitaetsstufe && !e.s.qualitaetsstufen.includes(p.qualitaetsstufe)) e.s.qualitaetsstufen.push(p.qualitaetsstufe)
    summen.set(key, e)
  }
  return [...summen.values()].map(e => e.s).sort((a, b) =>
    (a.weinbaugebiet ?? '\uffff').localeCompare(b.weinbaugebiet ?? '\uffff', 'de') || a.rebsorte.localeCompare(b.rebsorte, 'de'))
}

// ── Hektarhöchstertrag (betriebsweit) ───────────────────────────────────────

export type HektarhoechstertragStatus = {
  gesamtFlaecheHaBetrieb: number
  /** kg aller Stufen, für die der Höchstertrag gilt (unterliegtHoechstertrag) */
  gesamtKg: number
  maxKg: number
  ueberschreitungKg: number
  ueberschritten: boolean
}

/** Betriebsweite Prüfung wie auf der Lese-Seite: kg aller Stufen ab Landwein gegen 10.000 kg/ha × Weingartenfläche (GST, Nutzart WI) */
export function berechneHektarhoechstertrag(
  parzellen: readonly { qualitaetsstufe: string | null; mengeKg: number | null }[],
  gesamtFlaecheHaBetrieb: number,
): HektarhoechstertragStatus {
  const gesamtKg = parzellen
    .filter(p => unterliegtHoechstertrag(p.qualitaetsstufe))
    .reduce((s, p) => s + (p.mengeKg ?? 0), 0)
  const maxKg = HEKTARHOECHSTERTRAG_KG_HA * gesamtFlaecheHaBetrieb
  return {
    gesamtFlaecheHaBetrieb,
    gesamtKg,
    maxKg,
    ueberschreitungKg: Math.max(0, gesamtKg - maxKg),
    ueberschritten: gesamtFlaecheHaBetrieb > 0 && gesamtKg > maxKg,
  }
}

/** Summe der Weingartenfläche (Grundstücke mit Nutzart WI) – Bezugsfläche des Hektarhöchstertrags */
export function weinbauflaecheHa(grundstuecke: readonly { flaeche_ha?: unknown }[]): number {
  return grundstuecke.reduce((s, g) => s + (zahlOderNull(g.flaeche_ha) ?? 0), 0)
}

// KAN-150 F1: deaktivierte Grundstücke nur, wenn sie am 1.1. des Jahrgangs noch bewirtschaftet wurden
async function ladeWeinbauflaecheHa(supabase: Client, tenantId: string, jahr: number): Promise<number> {
  const { data, error } = await alle<R>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('grundstuecke') as any)
      .select('id, flaeche_ha, aktiv, deaktiviert_am')
      .eq('tenant_id', tenantId)
      .eq('nutzart', 'WI')
      .order('id'),
  )
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (grundstuecke): ${error.message}`)
  return weinbauflaecheHa(data.filter(g => gstImJahr(g, jahr)))
}

// ── Weinerntemeldung je Rebsorte ────────────────────────────────────────────

export type ErnteZeile = {
  rebsorte: string
  /** KAN-165: Bundesland-Gebiet der Position (null = ohne Gebiet bzw. Meldung vor KAN-165) */
  weinbaugebiet: string | null
  kuerzel: string | null
  /** Ertragsfläche (ha), 4 Stellen */
  flaecheHa: number | null
  /** Erntemenge (kg), ganze kg */
  mengeKg: number | null
  /** davon als Trauben verkauft (eigene Ernte, Traubenverkauf dieses Jahrgangs), ganze kg */
  verkauftKg: number | null
  /** Menge (hl), 2 Stellen – erfasst oder kg ÷ 130 */
  mengeHl: number | null
  hlGeschaetzt: boolean
  /** Mostgewicht (°KMW): kg-gewichtetes Mittel der Lesen mit erfasstem °KMW, auf STELLEN.kmw
   *  abgerundet (Rechenregel 7, Entscheidung 8) */
  kmw: number | null
  /** Mostgewicht (°Oe) = f(Ø °KMW) mit STELLEN.oechsle – nie aus °Oe gemittelt (KAN-128) */
  oechsle: number | null
  qualitaetsstufe: string | null
  /** Ertrag (kg/ha), ganzzahlig */
  ertragKgHa: number | null
  /** Hektarhöchstertrag (kg/ha) – nur für die geprüften Qualitätsstufen */
  hoechstertragKgHa: number | null
  /** rechnerische Überschreitung dieser Sorte (kg) = Menge − Höchstertrag × Fläche, nie negativ */
  uebermengeKg: number | null
}

export type ErntemeldungDaten = {
  jahrgang: Jahrgang
  /** 'meldung' = gespeicherte AMA-Meldung (ama_meldepositionen), 'lesedaten' = Vorschau aus den Lesedaten */
  quelle: 'meldung' | 'lesedaten'
  status: string | null
  zeilen: ErnteZeile[]
  /** KAN-165: Gebiete der Zeilen (mehr als eines → Spalte „Weinbaugebiet“ im Ausdruck) */
  gebiete: string[]
  /** Summen der gerundeten Zeilenwerte (Ausdruck) */
  summe: { flaecheHa: number; mengeKg: number; verkauftKg: number; mengeHl: number }
  hektarhoechstertrag: HektarhoechstertragStatus
  warnungen: string[]
}

type ErnteRoh = { rebsorte: string; weinbaugebiet?: string | null; flaecheHa: number | null; mengeKg: number | null; mengeHl: number | null; qualitaetsstufe: string | null; kmw?: number | null; oechsle?: number | null }

/**
 * Mostgewicht je Rebsorte: kg-gewichtetes Mittel der °KMW aller Lesen mit erfasstem Mostgewicht
 * und Menge (mischen() aus lib/wein/mostgewicht, Rechenregel 7): auf 2 Stellen abgerundet
 * (Entscheidung 8), °Oe = f(Ø °KMW) – nie °Oe mitteln. Es zählt die führende °KMW-Spalte, bei
 * einer Lese nur mit °Oe (vor Migration A) der daraus ergänzte Wert. teilweise = mindestens eine
 * Lese der Sorte mit Menge, aber ohne Mostgewicht.
 */
export function kmwJeRebsorte(
  lese: readonly (Pick<LeseZeile, 'rebsorte' | 'mengeKg' | 'kmw'> & { weinbaugebiet?: string | null; mostgewicht?: Pick<MostgewichtExport, 'kmw'> })[],
): Map<string, { kmw: number; oechsle: number; teilweise: boolean }> {
  const teile = new Map<string, { menge: number; kmw: number }[]>()
  const teilweise = new Set<string>()
  for (const z of lese) {
    const kg = z.mengeKg ?? 0
    if (kg <= 0) continue
    const key = positionsKey(z.weinbaugebiet, z.rebsorte)   // KAN-165: je Gebiet und Rebsorte
    const kmw = z.mostgewicht ? z.mostgewicht.kmw : z.kmw
    const liste = teile.get(key) ?? []
    teile.set(key, liste)
    if (kmw === null || kmw === undefined) teilweise.add(key)
    else liste.push({ menge: kg, kmw })
  }
  const out = new Map<string, { kmw: number; oechsle: number; teilweise: boolean }>()
  for (const [key, t] of teile) {
    const m = mischen(t)
    if (m) out.set(key, { kmw: m.kmw, oechsle: m.oechsle, teilweise: teilweise.has(key) })
  }
  return out
}

/** Zeile aus Rohwerten: runden, hl (erfasst oder kg ÷ 130), Ertrag, Höchstertrag, Übermenge */
export function ernteZeile(roh: ErnteRoh, verkauftKg: number | null = null): ErnteZeile {
  const flaecheHa = roh.flaecheHa === null ? null : runden(roh.flaecheHa, STELLEN.ha)
  const mengeKg = roh.mengeKg === null ? null : runden(roh.mengeKg, STELLEN.kg)
  const hlGeschaetzt = roh.mengeHl === null && roh.mengeKg !== null
  const mengeHl = roh.mengeHl !== null
    ? runden(roh.mengeHl, STELLEN.hl)
    : roh.mengeKg !== null ? runden(roh.mengeKg / KG_JE_HL, STELLEN.hl) : null
  const ertragKgHa = flaecheHa !== null && flaecheHa > 0 && mengeKg !== null ? runden(mengeKg / flaecheHa, 0) : null
  const hoechstertragKgHa = unterliegtHoechstertrag(roh.qualitaetsstufe) ? HEKTARHOECHSTERTRAG_KG_HA : null
  const uebermengeKg = hoechstertragKgHa !== null && flaecheHa !== null && mengeKg !== null
    ? runden(Math.max(0, mengeKg - hoechstertragKgHa * flaecheHa), 0)
    : null
  return {
    rebsorte: roh.rebsorte,
    weinbaugebiet: roh.weinbaugebiet ?? null,
    kuerzel: bkiRebsorteKuerzel(roh.rebsorte),
    flaecheHa, mengeKg,
    verkauftKg: verkauftKg === null ? null : runden(verkauftKg, STELLEN.kg),
    mengeHl, hlGeschaetzt,
    kmw: roh.kmw === null || roh.kmw === undefined ? null : runden(roh.kmw, STELLEN.kmw),
    oechsle: roh.oechsle === null || roh.oechsle === undefined ? null : runden(roh.oechsle, STELLEN.oechsle),
    qualitaetsstufe: roh.qualitaetsstufe,
    ertragKgHa, hoechstertragKgHa, uebermengeKg,
  }
}

/** Summen der (gerundeten) Zeilenwerte – der Ausdruck zeigt genau diese */
export function summeErnte(zeilen: readonly ErnteZeile[]): ErntemeldungDaten['summe'] {
  const s = (f: (z: ErnteZeile) => number | null, st: number) => runden(zeilen.reduce((a, z) => a + (f(z) ?? 0), 0), st)
  return {
    flaecheHa: s(z => z.flaecheHa, STELLEN.ha),
    mengeKg: s(z => z.mengeKg, STELLEN.kg),
    verkauftKg: s(z => z.verkauftKg, STELLEN.kg),
    mengeHl: s(z => z.mengeHl, STELLEN.hl),
  }
}

/**
 * Traubenverkauf aus eigener Ernte je Rebsorte (Rebsorte vom Grundstück, sonst vom Ried).
 * Verkäufe mit stornierter Rechnung zählen nicht – dieselbe Regel wie im BKI-Datenblatt
 * (ohneStornierte() aus traubenverkauf.ts), sonst würde ein neu erfasster Ersatz doppelt gezählt.
 */
async function ladeVerkaufteTraubenJeRebsorte(supabase: Client, tenantId: string, jahrgangId: string): Promise<{ je: Map<string, number>; hinweis: string | null }> {
  const { data, error } = await alle<R>(
    // storno-sichtbar: stornierte Traubenverkäufe (KAN-148) und stornierte Rechnungen filtert ohneStornierte() mit Hinweis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('traubenverkauf') as any)
      .select('id, datum, liefernummer, menge_kg, weingarten_id, storniert_am, herkunft_code, weingarten:weingarten_id(rebsorte, weinbaugebiet, trauben_herkunft_code), grundstueck:grundstueck_id(rebsorte, trauben_herkunft_code), verkaufsposten:verkaufsposten_id(storniert, rechnungsnummer)')
      .eq('tenant_id', tenantId)
      .eq('jahrgang_id', jahrgangId)
      .order('id'),
  )
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (traubenverkauf): ${error.message}`)
  const eigene = data.filter(v => !!v.weingarten_id)   // Zukauf-Trauben sind keine eigene Ernte
  const { gueltig, hinweis } = ohneStornierte(eigene)
  const je = new Map<string, number>()
  for (const v of gueltig) {
    const sorte = textOderNull(v.grundstueck?.rebsorte) ?? textOderNull(v.weingarten?.rebsorte) ?? REBSORTE_UNBEKANNT
    const key = positionsKey(gebietDerLese(v, v.weingarten ?? null, v.grundstueck ?? null).weinbaugebiet, sorte)
    je.set(key, (je.get(key) ?? 0) + (zahlOderNull(v.menge_kg) ?? 0))
  }
  return { je, hinweis: hinweis ? `„davon als Trauben verkauft“: ${hinweis}` : null }
}

function fmtKg(n: number): string {
  return Math.round(n).toLocaleString('de-DE')
}

/**
 * Weinerntemeldung eines (mandantengeprüften) Jahrgangs: je Rebsorte aus der gespeicherten
 * AMA-Meldung, sonst als Vorschau direkt aus den Lesedaten – mit Hektarhöchstertrag und
 * Übermenge, Traubenverkauf und Hinweisen (X-Warnungen der CSV).
 */
export async function ladeErntemeldung(supabase: Client, tenantId: string, jg: Jahrgang): Promise<ErntemeldungDaten> {
  const [meldungRes, lese, flaecheBetrieb, verkaufRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ama_erntemeldungen') as any)
      .select('id, status, gesamtmenge_kg, gesamtmenge_hl, version')
      .eq('tenant_id', tenantId)
      .eq('jahrgang_id', jg.id)
      // KAN-148 C2: Korrekturmeldungen sind weitere Versionen – es gilt die neueste
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    ladeLesedaten(supabase, jg.id),
    ladeWeinbauflaecheHa(supabase, tenantId, jg.jahrgang),
    ladeVerkaufteTraubenJeRebsorte(supabase, tenantId, jg.id),
  ])
  if (meldungRes.error) throw new AktionsFehler(`Laden fehlgeschlagen (ama_erntemeldungen): ${meldungRes.error.message}`)
  const meldung = (meldungRes.data ?? null) as R | null
  const warnungen: string[] = []
  // KAN-148 C2: nach dem Einreichen hilft nur noch eine Korrekturmeldung (neue Version), vorher „Neu berechnen“
  const aktualisieren = amaAktualisierenText(meldung ? textOderNull(meldung.status) : null)
  const version = meldung ? Number(meldung.version ?? 1) || 1 : 1   // null-vorgabe-ok: Version 0 gibt es nicht – erste Version
  if (version > 1) {
    warnungen.push(`Korrekturmeldung: Version ${version} ersetzt die eingereichte Version ${version - 1}.`)
  }
  const verkauft = verkaufRes.je
  if (verkaufRes.hinweis) warnungen.push(verkaufRes.hinweis)

  // KAN-129: nur Lesegut bis zum Stichtag 30.11.; späteres gesondert (Hinweis)
  const stichtag = teileNachStichtag(lese.zeilen, jg.jahrgang)
  const nachStichtag = stichtagHinweis(stichtag.danach, jg.jahrgang)
  if (nachStichtag) warnungen.push(nachStichtag)

  // Vorschau je Rebsorte aus den Lesedaten – Grundlage ohne Meldung und Abgleich mit Meldung
  const summen = aggregiereJeRebsorte(stichtag.bis.map(parzelleFuerMeldung))
  const vorschau = new Map(summen.map(s => [positionsKey(s.weinbaugebiet, s.rebsorte), s]))
  // KAN-165: Meldungen vor KAN-165 haben kein Gebiet je Position – bei genau einem Gebiet in den Lesedaten gilt dieses
  const leseGebiete = [...new Set(summen.map(s => s.weinbaugebiet))]
  const einzigesGebiet = leseGebiete.length === 1 ? leseGebiete[0] : null
  const key = (r: { weinbaugebiet?: string | null; rebsorte: string }) => positionsKey(r.weinbaugebiet, r.rebsorte)
  const kmw = kmwJeRebsorte(stichtag.bis)
  const stufeAusLese = (s: RebsortenSumme) => (s.qualitaetsstufen.length === 1 ? s.qualitaetsstufen[0] : null)
  const hlAusLese = (s: RebsortenSumme) => (s.hlGeschaetzt ? null : s.mengeHl)

  let roh: ErnteRoh[]
  if (meldung) {
    const { data, error } = await alle<R>(
      // ama_meldepositionen hat keine tenant_id – die Meldung ist oben mandantengefiltert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('ama_meldepositionen') as any)
        .select('id, rebsorte_name, weinbaugebiet, flaeche_ha, menge_kg, menge_hl, qualitaetsstufe')
        .eq('meldung_id', meldung.id)
        .order('rebsorte_name')
        .order('id'),
    )
    if (error) throw new AktionsFehler(`Laden fehlgeschlagen (ama_meldepositionen): ${error.message}`)
    roh = data.map(p => {
      const rebsorte = textOderNull(p.rebsorte_name) ?? REBSORTE_UNBEKANNT
      const weinbaugebiet = textOderNull(p.weinbaugebiet) ?? einzigesGebiet
      const k = positionsKey(weinbaugebiet, rebsorte)
      return {
        rebsorte,
        weinbaugebiet,
        flaecheHa: zahlOderNull(p.flaeche_ha),
        mengeKg: zahlOderNull(p.menge_kg),
        mengeHl: zahlOderNull(p.menge_hl),
        qualitaetsstufe: textOderNull(p.qualitaetsstufe),
        kmw: kmw.get(k)?.kmw ?? null,
        oechsle: kmw.get(k)?.oechsle ?? null,
      }
    })
    const leseKg = runden(stichtag.bis.reduce((s, z) => s + (z.mengeKg ?? 0), 0), STELLEN.kg)
    const meldungKg = zahlOderNull(meldung.gesamtmenge_kg)
    if (meldungKg !== null && runden(meldungKg, STELLEN.kg) !== leseKg) {
      warnungen.push(`Die Lesedaten wurden nach dem Erstellen der AMA-Meldung geändert (Meldung ${fmtKg(meldungKg)} kg, Lesedaten ${fmtKg(leseKg)} kg) – auf der Lese-Seite ${aktualisieren} und die Datei neu erstellen.`)
    }
    // Abgleich Qualitätsstufe und hl je Sorte mit den Lesedaten: Meldungen, die vor dem
    // 25.09.2026 erstellt wurden, tragen fest „Qualitätswein“ und keine hl.
    const abweichend: string[] = []
    for (const r of roh) {
      const s = vorschau.get(key(r))
      if (!s) continue
      const stufe = stufeAusLese(s)
      const gruende: string[] = []
      if (s.qualitaetsstufen.length > 0 && stufe !== r.qualitaetsstufe) {
        gruende.push(`Qualitätsstufe „${r.qualitaetsstufe ? qualitaetLabel(r.qualitaetsstufe) : 'leer'}“, Lesedaten: ${s.qualitaetsstufen.map(qualitaetLabel).join(', ')}`)
      }
      const hl = hlAusLese(s)
      if (hl !== null && (r.mengeHl === null || runden(r.mengeHl, STELLEN.hl) !== runden(hl, STELLEN.hl))) {
        gruende.push(r.mengeHl === null ? `erfasste ${runden(hl, STELLEN.hl).toLocaleString('de-DE')} hl nicht übernommen (Meldung rechnet kg ÷ ${KG_JE_HL})` : 'Menge (hl) weicht ab')
      }
      if (gruende.length > 0) abweichend.push(`„${positionsName(key(r))}“ (${gruende.join('; ')})`)
    }
    if (abweichend.length > 0) {
      warnungen.push(`Die gespeicherte AMA-Meldung weicht von den Lesedaten ab: ${abweichend.join(', ')} – auf der Lese-Seite ${aktualisieren} und die Datei neu erstellen.`)
    }
  } else {
    roh = summen.map(s => ({
      rebsorte: s.rebsorte,
      weinbaugebiet: s.weinbaugebiet,
      flaecheHa: s.flaecheHa,
      mengeKg: s.mengeKg,
      mengeHl: hlAusLese(s),
      qualitaetsstufe: stufeAusLese(s),
      kmw: kmw.get(key(s))?.kmw ?? null,
      oechsle: kmw.get(key(s))?.oechsle ?? null,
    }))
    if (roh.length > 0) {
      warnungen.unshift(`Für den Jahrgang ${jg.jahrgang} ist noch keine AMA-Meldung erstellt – die Zeilen sind eine Vorschau aus den Lesedaten. Auf der Lese-Seite „AMA-Meldung erstellen“.`)
    }
  }
  for (const r of roh) {
    const s = vorschau.get(key(r))
    if (s && s.qualitaetsstufen.length > 1 && r.qualitaetsstufe === null) {
      warnungen.push(`Rebsorte „${positionsName(key(s))}“: Lesedaten mit mehreren Qualitätsstufen (${s.qualitaetsstufen.map(qualitaetLabel).join(', ')}) – Qualitätsstufe leer gelassen.`)
    }
  }
  const kmwTeilweise = [...kmw].filter(([, k]) => k.teilweise).map(([s]) => positionsName(s))
  if (kmwTeilweise.length > 0) {
    warnungen.push(`Mostgewicht bei ${kmwTeilweise.join(', ')} nur aus den Lesen mit erfasstem Mostgewicht gemittelt (mengengewichtet in °KMW, °Oe daraus umgerechnet).`)
  }

  const zeilen = roh.map(r => ernteZeile(r, verkauft.get(key(r)) ?? 0))
  const sorten = new Set(zeilen.map(z => key(z)))
  for (const [sorte, kg] of verkauft) {
    if (!sorten.has(sorte) && kg > 0) {
      warnungen.push(`Traubenverkauf „${positionsName(sorte)}“ (${fmtKg(kg)} kg) passt zu keiner Rebsorte der Erntemeldung – Rebsorte von Ried/Grundstück prüfen bzw. die AMA-Meldung neu berechnen.`)
    }
  }

  const geschaetzt = zeilen.filter(z => z.hlGeschaetzt).length
  if (geschaetzt > 0) {
    warnungen.push(`Menge (hl) bei ${geschaetzt} ${geschaetzt === 1 ? 'Rebsorte' : 'Rebsorten'} aus Menge (kg) ÷ ${KG_JE_HL} umgerechnet (keine bzw. nicht für alle Lesen hl erfasst${meldung ? ' oder nicht in die AMA-Meldung übernommen' : ''}).`)
  }
  const ohneFlaeche = zeilen.filter(z => z.mengeKg !== null && (z.flaecheHa === null || z.flaecheHa <= 0)).map(z => positionsName(key(z)))
  if (ohneFlaeche.length > 0) {
    warnungen.push(`Ohne Fläche (Ertrag, Übermenge leer): ${ohneFlaeche.join(', ')} – Fläche am Grundstück bzw. Ried ergänzen.`)
  }
  warnungen.push(...kuerzelWarnungen(zeilen.map(z => (z.rebsorte === REBSORTE_UNBEKANNT ? null : z.rebsorte))))

  const hektarhoechstertrag = berechneHektarhoechstertrag(lese.zeilen, flaecheBetrieb)
  if (hektarhoechstertrag.gesamtKg > 0) {
    const basis = `Hektarhöchstertrag betriebsweit (maßgeblich): ${fmtKg(hektarhoechstertrag.gesamtKg)} kg Lese (§ 23 WeinG) von max. ${fmtKg(hektarhoechstertrag.maxKg)} kg (${fmtKg(HEKTARHOECHSTERTRAG_KG_HA)} kg/ha × ${runden(flaecheBetrieb, STELLEN.ha).toLocaleString('de-DE', { minimumFractionDigits: 4 })} ha Weingartenfläche lt. AMA)`
    if (hektarhoechstertrag.ueberschritten) {
      warnungen.push(`${basis} – ÜBERSCHRITTEN um ${fmtKg(hektarhoechstertrag.ueberschreitungKg)} kg. ${HOECHSTERTRAG_RECHTSFOLGE}. Die Spalte „Übermenge (kg)“ zeigt die rechnerische Überschreitung je Sorte.`)
    } else if (zeilen.some(z => (z.uebermengeKg ?? 0) > 0)) {
      warnungen.push(`${basis} – eingehalten. Die Spalte „Übermenge (kg)“ zeigt nur die rechnerische Überschreitung je Sorte.`)
    }
  }

  return {
    jahrgang: jg,
    quelle: meldung ? 'meldung' : 'lesedaten',
    status: meldung ? textOderNull(meldung.status) : null,
    zeilen,
    gebiete: [...new Set(zeilen.map(z => z.weinbaugebiet).filter((g): g is string => !!g))],
    summe: summeErnte(zeilen),
    hektarhoechstertrag,
    warnungen,
  }
}

export const SPALTEN_ERNTEMELDUNG: CsvSpalte<ErnteZeile>[] = [
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.mengeKg },
  { kopf: 'davon als Trauben verkauft (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.verkauftKg },
  { kopf: 'Menge (hl)', typ: 'dezimal', stellen: STELLEN.hl, wert: z => z.mengeHl },
  { kopf: 'Mostgewicht (°KMW)', typ: 'dezimal', stellen: STELLEN.kmw, wert: z => z.kmw },
  { kopf: 'Mostgewicht (°Oe)', typ: 'dezimal', stellen: STELLEN.oechsle, wert: z => z.oechsle },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => (z.qualitaetsstufe ? qualitaetLabel(z.qualitaetsstufe) : null) },
  { kopf: 'Ertrag (kg/ha)', typ: 'ganzzahl', wert: z => z.ertragKgHa },
  { kopf: 'Höchstertrag (kg/ha)', typ: 'ganzzahl', wert: z => z.hoechstertragKgHa },
  { kopf: 'Übermenge (kg)', typ: 'ganzzahl', wert: z => z.uebermengeKg },
  // KAN-165: Bundesland-Gebiet der Position – hinten angefügt, die bisherigen Spaltenpositionen bleiben
  { kopf: 'Weinbaugebiet', typ: 'text', wert: z => z.weinbaugebiet },
]
