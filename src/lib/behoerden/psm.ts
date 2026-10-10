// ── Pflanzenschutz-Aufzeichnungen und Mittelverbrauch (Behördenmeldungen, 24.09.2026) ──
//
// Gemeinsame Grundlage der Gruppe „Pflanzenschutz & Düngung“:
//   • ladeBehandlungen()      – EINE Abfrage auf behandlungen (Mandantenfilter, alle()) samt
//                               Grundstücken (behandlung_grundstuecke), Mittel, Düngemittel,
//                               Weingarten/Ried; normalisiert zu PsmBehandlung.
//   • psm-aufzeichnung        – eine Zeile je Maßnahme × Grundstück, Mittelmenge und Spritzbrühe
//                               anteilig nach Fläche (Druck: /reports/behandlungsprotokoll,
//                               /behandlungen/berichte Tab „Ried“).
//   • psm-mittelverbrauch     – eine Zeile je Jahr × Mittel × Einheit, Σ Mittelmenge der Spritzungen
//                               (Druck: /behandlungen/berichte Tab „Mittelverbrauch“).
//   • mittelmenge()           – Menge des Mittels bzw. Düngers je Maßnahme in kg oder l (KAN-133), die
//                               EINZIGE Stelle, die Aufwand, Spritzbrühe und Düngermenge auslegt;
//                               mittelmengeKg() darauf für Kupfer- und Nährstoffbilanz (cu.ts, naehrstoff.ts).
//   • betriebsflaecheWi()     – Betriebsfläche als Σ WI-GST-Fläche der aktiven Weingärten.
//
// „Menge gesamt“ (menge_gesamt, menge_einheit) ist seit KAN-133 (26.09.2026) bei Spritzungen die
// Spritzbrühe in l und NIE die Mittelmenge; bei Düngungen die Düngermenge (kg, l nur bei Düngemitteln
// in l). Die Mittelmenge einer Spritzung kommt nur aus dem Aufwand.
//
// Isomorph (Server und Client, keine server-only-Importe): BerichteClient rechnet mit denselben
// Funktionen wie die CSV-Route. Ladefunktionen liefern bereits gerundete Zeilenwerte (runden()),
// Druck-Summen addieren genau diese.
//
// Behandelte Fläche einer Maßnahme: Σ Fläche der Grundstücke (Snapshot in behandlung_grundstuecke,
// sonst aktuelle GST-Fläche), sonst behandlungen.behandelte_flaeche_ha, sonst die Fläche des
// Weingartens (behandlungen.weingarten_id). Bis 24.09.2026 teilten Cu- und Nährstoffbilanz durch die
// Fläche des EINEN Weingartens aus weingarten_id – bei Maßnahmen über mehrere Rieden viel zu hoch.

import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { MASSNAHMEN_ART_LABEL } from '@/lib/behandlungen/arten'
import type { LadeErgebnis } from './typen'
// KAN-132: zentrale Anteilsfunktion (Zyklus psm ↔ massnahmeAnteile ist unkritisch: nur Funktionen, keine Werte beim Laden)
import { verteileMassnahme, WARNUNG_GLEICH, type GstAnteil, type WiGst } from '@/lib/wein/massnahmeAnteile'
import { gstAktiv, gstImJahr } from '@/lib/wein/grundstueckAktiv'
import { anwenderText, ART_VERWENDUNG_LABEL, istArtVerwendung } from '@/lib/behandlungen/erfassungsfrist'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// ── Bezeichnungen ───────────────────────────────────────────────────────────

/**
 * Maßnahmenarten (alle Werte von behandlungen.art, lib/behandlungen/arten.ts – seit KAN-143 mit
 * Laubschneiden). Reihenfolge = Art-Filter in Behandlungsprotokoll und Berichten; artAus() lässt genau
 * diese Schlüssel zu.
 */
export const ART_LABEL: Readonly<Record<string, string>> = MASSNAHMEN_ART_LABEL

export const EINHEIT_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl', ml_hl: 'ml/hl', kg: 'kg', l: 'l', g: 'g', ml: 'ml',
}

const WITTERUNG_LABEL: Record<string, string> = { sonnig: 'sonnig', bewoelkt: 'bewölkt', regnerisch: 'regnerisch', wind: 'windig' }
const WIND_LABEL: Record<string, string> = { windstill: 'windstill', schwach: 'schwach', maessig: 'mäßig', stark: 'stark' }

/** Kultur aller Maßnahmen (Weinbau) und ihr EPPO-Code – Pflichtangabe nach DVO (EU) 2023/564 */
export const KULTUR_REBE = 'Weinrebe'
export const EPPO_REBE = 'VITVI'

/** Nachkommastellen: Mittelmengen wie in der Datenbank (numeric …,3) */
export const STELLEN_MENGE = 3

/** Ried-Filter „ohne Ried“ (wie im Tab „Ried“ der Maßnahmen-Berichte) */
export const OHNE_RIED = '_none'

export function einheitText(e: string | null | undefined): string {
  if (!e) return ''
  return EINHEIT_LABEL[e] ?? e
}

/**
 * Beschriftung der Aufwand-Einheit (Formulare, psm-aufzeichnung, cu-bilanz-behandlungen, Druck): kg bzw. l
 * sind Gesamtwerte der Maßnahme („kg (gesamt)“ – in einer GST-Zeile keine Menge je Grundstück), g/hl bzw.
 * ml/hl die tatsächliche Konzentration im Tank (KAN-133).
 */
export const AUFWAND_EINHEIT_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl (im Tank)', ml_hl: 'ml/hl (im Tank)', kg: 'kg (gesamt)', l: 'l (gesamt)',
}

/** Aufwand-Einheit als Text (AUFWAND_EINHEIT_LABEL); einheitText bleibt für Mengen-Einheiten (menge_einheit, Lager) */
export function aufwandEinheitText(e: string | null | undefined): string {
  if (!e) return ''
  return AUFWAND_EINHEIT_LABEL[e] ?? e
}

export function witterungText(w: string | null | undefined): string | null {
  if (!w) return null
  return WITTERUNG_LABEL[w] ?? w
}

export function windText(w: string | null | undefined): string | null {
  if (!w) return null
  return WIND_LABEL[w] ?? w
}

/** DATE 'JJJJ-MM-TT' → 'TT.MM.JJJJ' (stringbasiert, ohne Zeitzone) */
export function datumDe(d: string | null | undefined): string {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d
}

// ── Typen ───────────────────────────────────────────────────────────────────

export type WeingartenStamm = {
  id: string
  name: string
  ried: string | null
  lageId: string | null
  /** Stammdaten-Fläche (ha) */
  flaecheHa: number | null
  aktiv: boolean
  /** Σ Fläche der Grundstücke mit Nutzart WI (ha, 4 Stellen) – wie createBehandlung die WI-GST bestimmt */
  wiFlaecheHa: number
  /** aktuelle WI-GST (KAN-132 Regel 9: Maßnahmen nur am Weingarten werden in Bilanzen darauf verteilt) */
  wiGst?: WiGst[]
}

export type PsmGrundstueck = {
  /** null = Maßnahme ohne Grundstückszuordnung (Zeile je Weingarten aus behandlungen.weingarten_id) */
  grundstueckId: string | null
  gstNr: string | null
  /** Katastralgemeinde-Nummer (grundstuecke.katastralgemeinde) – Code, führende Nullen bleiben */
  kgNr: string | null
  kgName: string | null
  /** Fläche dieses Grundstücks bei der Maßnahme (ha, 4 Stellen) */
  flaecheHa: number | null
  /** KAN-132 Regel 1: Snapshot behandlung_grundstuecke.flaeche_ha bzw. (nur wenn leer) aktuelle grundstuecke.flaeche_ha */
  flaechenQuelle?: 'snapshot' | 'aktuell' | null
  weingartenId: string | null
  weingarten: string | null
  /** Ried (lagen.name, sonst weingarten.ried) */
  ried: string | null
  lageId: string | null
  /** KAN-87: AMA-Feldstücknummer (weingarten.ama_feldnummer) und AMA-Schlagnummer des GST (grundstuecke.ama_feldnummer) */
  amaFeldstueck?: string | null
  amaSchlag?: string | null
}

export type PsmMittel = {
  id: string | null
  /** Handelsname, sonst Name */
  name: string
  zulassungsnr: string | null
  wirkstoff: string | null
  wirkstoffgehaltPct: number | null
  /** KAN-86: EPPO-Code des Hauptschaderregers (z. B. PLASVI) – nicht der Kultur, die ist immer VITVI */
  eppoCode: string | null
  /** KAN-86: bienengefährlich laut Zulassung */
  bienengefaehrlich?: boolean | null
  cuGehaltPct: number | null
  wartezeitTage: number | null
  maxAufwandKgHa: number | null
  maxAnwendungen: number | null
  oeko: boolean | null
}

export type PsmDuengemittel = {
  id: string | null
  name: string
  typ: string | null
  /** Einheit laut Stammdaten ('kg' | 'l') – Düngermenge in l nur bei 'l' (KAN-133) */
  einheit: string | null
  nPct: number | null
  pPct: number | null
  oeko: boolean | null
}

export type PsmBehandlung = {
  id: string
  /** DATE 'JJJJ-MM-TT' */
  datum: string
  datumBis: string | null
  jahr: number
  art: string
  psm: PsmMittel | null
  duengemittel: PsmDuengemittel | null
  /** Aufwandmenge (je ha bzw. je hl, siehe aufwandEinheit) */
  aufwand: number | null
  aufwandEinheit: string | null
  /** „Menge gesamt“: Spritzung = Spritzbrühe (l bzw. ml), Düngung = Düngermenge – nie direkt als Mittelmenge lesen, sondern mittelmenge() */
  mengeGesamt: number | null
  mengeEinheit: string | null
  konzentrationPct: number | null
  wasserLHa: number | null
  bbch: string | null
  schaderreger: string | null
  witterung: string | null
  temperaturC: number | null
  wind: string | null
  fruehesterLesetermin: string | null
  wartezeitEingehalten: boolean | null
  anwenderId: string | null
  /** Mitglied (Name aus profiles) bzw. Fremdanwender (anwender_name) */
  anwender: string | null
  /** KAN-87: Start-/Enduhrzeit (HH:MM, Wiener Zeit), Art der Verwendung (Text), erfasst am (ISO) / von (Name) */
  uhrzeitVon?: string | null
  uhrzeitBis?: string | null
  artVerwendung?: string | null
  erfasstAm?: string | null
  erfasstVon?: string | null
  notiz: string | null
  /** Grundstücke der Maßnahme; ohne Zuordnung höchstens ein Eintrag je Weingarten (grundstueckId null) */
  grundstuecke: PsmGrundstueck[]
  /** Behandelte Fläche (ha, 4 Stellen) */
  flaecheHa: number | null
  flaecheQuelle: 'grundstuecke' | 'behandlung' | 'weingarten' | null
}

// ── Normalisieren ───────────────────────────────────────────────────────────

function zahl(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN
  return Number.isFinite(n) ? n : null
}

function textOderNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return t ? t : null
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function rund(n: number | null, stellen: number): number | null {
  return n === null ? null : runden(n, stellen)
}

const SORTIERUNG = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

function vergleiche(a: string | null, b: string | null): number {
  return SORTIERUNG.compare(a ?? '', b ?? '')
}

function riedAus(wg: R | null | undefined): string | null {
  if (!wg) return null
  return textOderNull((wg.lagen as R | null)?.name) ?? textOderNull(wg.ried)
}

/** Eine Zeile aus der Abfrage in ladeBehandlungen() (PostgREST-Form) → PsmBehandlung. Exportiert für Tests. */
export function normalisiereBehandlung(roh: R, anwenderNamen?: ReadonlyMap<string, string>): PsmBehandlung {
  const datum = String(roh.datum ?? '').slice(0, 10)
  const wgDirekt = (roh.weingarten ?? null) as R | null
  const psmRoh = (roh.psm ?? null) as R | null
  const dmRoh = (roh.duengemittel ?? null) as R | null

  const grundstuecke: PsmGrundstueck[] = []
  for (const bg of ((roh.behandlung_grundstuecke ?? []) as R[])) {
    const g = (bg.grundstueck ?? null) as R | null
    const wg = (g?.weingarten ?? null) as R | null
    grundstuecke.push({
      grundstueckId: textOderNull(bg.grundstueck_id ?? g?.id),
      gstNr: textOderNull(g?.gst_nr),
      kgNr: textOderNull(g?.katastralgemeinde),
      kgName: textOderNull(g?.kg_bezeichnung),
      flaecheHa: rund(zahl(bg.flaeche_ha) ?? zahl(g?.flaeche_ha), STELLEN.ha),
      flaechenQuelle: zahl(bg.flaeche_ha) !== null ? 'snapshot' : zahl(g?.flaeche_ha) !== null ? 'aktuell' : null,
      weingartenId: textOderNull(wg?.id),
      weingarten: textOderNull(wg?.name),
      ried: riedAus(wg),
      lageId: textOderNull(wg?.lage_id),
      amaFeldstueck: textOderNull(wg?.ama_feldnummer),
      amaSchlag: textOderNull(g?.ama_feldnummer),
    })
  }
  grundstuecke.sort((a, b) =>
    vergleiche(a.ried, b.ried) || vergleiche(a.weingarten, b.weingarten) || vergleiche(a.kgNr, b.kgNr) || vergleiche(a.gstNr, b.gstNr))

  // Behandelte Fläche: Σ Grundstücke → behandelte_flaeche_ha → Weingarten
  const summeGst = grundstuecke.reduce((s, g) => s + (g.flaecheHa ?? 0), 0)
  let flaecheHa: number | null = null
  let flaecheQuelle: PsmBehandlung['flaecheQuelle'] = null
  if (summeGst > 0) { flaecheHa = runden(summeGst, STELLEN.ha); flaecheQuelle = 'grundstuecke' }
  else if ((zahl(roh.behandelte_flaeche_ha) ?? 0) > 0) { flaecheHa = runden(zahl(roh.behandelte_flaeche_ha) as number, STELLEN.ha); flaecheQuelle = 'behandlung' }
  else if ((zahl(wgDirekt?.flaeche_ha) ?? 0) > 0) { flaecheHa = runden(zahl(wgDirekt?.flaeche_ha) as number, STELLEN.ha); flaecheQuelle = 'weingarten' }

  // Ohne Grundstücke: Weingarten aus weingarten_id als einzige „Fläche“ der Maßnahme
  if (grundstuecke.length === 0 && wgDirekt) {
    grundstuecke.push({
      grundstueckId: null, gstNr: null, kgNr: null, kgName: null,
      flaecheHa,
      weingartenId: textOderNull(wgDirekt.id) ?? textOderNull(roh.weingarten_id),
      weingarten: textOderNull(wgDirekt.name),
      ried: riedAus(wgDirekt),
      lageId: textOderNull(wgDirekt.lage_id),
      amaFeldstueck: textOderNull(wgDirekt.ama_feldnummer),
      amaSchlag: null,
    })
  }

  const psm: PsmMittel | null = psmRoh ? {
    id: textOderNull(psmRoh.id) ?? textOderNull(roh.psm_id),
    name: textOderNull(psmRoh.handelsname) ?? textOderNull(psmRoh.name) ?? '–',
    zulassungsnr: textOderNull(psmRoh.zulassungsnr),
    wirkstoff: textOderNull(psmRoh.wirkstoff),
    wirkstoffgehaltPct: zahl(psmRoh.wirkstoffgehalt_pct),
    eppoCode: textOderNull(psmRoh.eppo_code),
    bienengefaehrlich: bool(psmRoh.bienengefaehrlich),
    cuGehaltPct: zahl(psmRoh.cu_gehalt_pct),
    wartezeitTage: zahl(psmRoh.wartezeit_tage),
    maxAufwandKgHa: zahl(psmRoh.max_aufwand_kg_ha),
    maxAnwendungen: zahl(psmRoh.max_anwendungen),
    oeko: bool(psmRoh.oeko_zugelassen),
  } : null

  const duengemittel: PsmDuengemittel | null = dmRoh ? {
    id: textOderNull(dmRoh.id) ?? textOderNull(roh.duengemittel_id),
    name: textOderNull(dmRoh.handelsname) ?? textOderNull(dmRoh.name) ?? '–',
    typ: textOderNull(dmRoh.typ),
    einheit: textOderNull(dmRoh.einheit),
    nPct: zahl(dmRoh.naehrstoff_n_pct),
    pPct: zahl(dmRoh.naehrstoff_p_pct),
    oeko: bool(dmRoh.oeko_zugelassen),
  } : null

  const anwenderId = textOderNull(roh.durchgefuehrt_von)
  const erfasstVonId = textOderNull(roh.erfasst_von)
  const artVerwendung = textOderNull(roh.art_verwendung)
  return {
    id: String(roh.id),
    datum,
    datumBis: textOderNull(roh.datum_bis)?.slice(0, 10) ?? null,
    jahr: Number(datum.slice(0, 4)) || 0,
    art: textOderNull(roh.art) ?? 'spritzung',
    psm,
    duengemittel,
    aufwand: zahl(roh.aufwandmenge),
    aufwandEinheit: textOderNull(roh.aufwandmenge_einheit),
    mengeGesamt: zahl(roh.menge_gesamt),
    mengeEinheit: textOderNull(roh.menge_einheit),
    konzentrationPct: zahl(roh.konzentration),
    wasserLHa: zahl(roh.wasseraufwand_l_ha),
    bbch: textOderNull(roh.bbch_stadium),
    schaderreger: textOderNull(roh.schaderreger),
    witterung: textOderNull(roh.witterung),
    temperaturC: zahl(roh.temperatur_c),
    wind: textOderNull(roh.windstaerke),
    fruehesterLesetermin: textOderNull(roh.ernte_fruehesteins)?.slice(0, 10) ?? null,
    wartezeitEingehalten: bool(roh.wartezeit_eingehalten),
    anwenderId,
    anwender: anwenderText(anwenderId, textOderNull(roh.anwender_name), anwenderNamen),
    uhrzeitVon: textOderNull(roh.uhrzeit_von)?.slice(0, 5) ?? null,
    uhrzeitBis: textOderNull(roh.uhrzeit_bis)?.slice(0, 5) ?? null,
    artVerwendung: artVerwendung ? (istArtVerwendung(artVerwendung) ? ART_VERWENDUNG_LABEL[artVerwendung] : artVerwendung) : null,
    erfasstAm: textOderNull(roh.created_at),
    erfasstVon: erfasstVonId ? (anwenderNamen?.get(erfasstVonId) ?? null) : null,
    notiz: textOderNull(roh.notizen),
    grundstuecke,
    flaecheHa,
    flaecheQuelle,
  }
}

// ── Hilfen je Maßnahme ──────────────────────────────────────────────────────

/** Mittel der Maßnahme (Pflanzenschutzmittel, sonst Düngemittel) */
export function mittelName(b: PsmBehandlung): string | null {
  return b.psm?.name ?? b.duengemittel?.name ?? null
}

function eindeutig(werte: (string | null)[]): string[] {
  return [...new Set(werte.filter((w): w is string => !!w))]
}

/** Weingärten der Maßnahme, z. B. „Pfaffenberg Riesling, Sandgrube Grüner Veltliner“ */
export function weingartenText(b: PsmBehandlung): string | null {
  const w = eindeutig(b.grundstuecke.map(g => g.weingarten))
  return w.length ? w.join(', ') : null
}

/** Rieden der Maßnahme */
export function riedText(b: PsmBehandlung): string | null {
  const r = eindeutig(b.grundstuecke.map(g => g.ried))
  return r.length ? r.join(', ') : null
}

const KOLLATOR = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

/**
 * Rieden der Maßnahme für Druckseiten (Rückmeldung 30.09.2026): je Ried einmal, alphabetisch; die Lage in Klammern
 * nur, wenn sie anders heißt als die Ried – ohne Lage fällt riedAus auf weingarten.ried zurück, das oft denselben
 * Namen trägt (bei Gebeshuber stand so jede Ried doppelt im Behandlungsprotokoll).
 */
export function riedenMitLage(b: PsmBehandlung): string[] {
  const je = new Map<string, string | null>()
  for (const g of b.grundstuecke) {
    if (!g.weingarten || je.has(g.weingarten)) continue
    const lage = g.ried && g.ried.trim().toLocaleLowerCase('de') !== g.weingarten.trim().toLocaleLowerCase('de') ? g.ried : null
    je.set(g.weingarten, lage)
  }
  return [...je.entries()]
    .sort(([a], [b2]) => KOLLATOR.compare(a, b2))
    .map(([ried, lage]) => lage ? `${ried} (${lage})` : ried)
}

/** Anzahl zugeordneter Grundstücke (ohne die Ersatzzeile je Weingarten) */
export function gstAnzahl(b: PsmBehandlung): number {
  return b.grundstuecke.filter(g => g.grundstueckId !== null).length
}

// ── Mittelmenge und Spritzbrühe (KAN-133, 26.09.2026) ───────────────────────
//
// Spritzung: „Menge gesamt“ ist die Spritzbrühe (l; ml → l) und wird NIE als Mittelmenge gelesen.
// Mittelmenge nur aus dem Aufwand:
//   kg/ha bzw. l/ha × behandelte Fläche · kg bzw. l (gesamt; g/ml → kg/l) ·
//   g/hl bzw. ml/hl (Konzentration im Tank) × Spritzbrühe (l) ÷ 100 ÷ 1000
//   (Spritzbrühe = „Menge gesamt“, sonst Wasseraufwand (l/ha) × Fläche).
// Kein Rückfall auf konzentration × Brühe (numeric(5,2) rundet: 0,025 % → 0,03 = +20 %).
// Düngung: Düngermenge („Menge gesamt“ in kg; g → kg; l bzw. ml nur bei Düngemitteln in l), sonst
// Aufwand kg/ha × Fläche bzw. kg (gesamt) – l/ha und l wieder nur bei Düngemitteln in l.
// Sonstiges (KAN-154, z. B. Pheromon-Dispenser als Pflanzenschutzmittel): Mittelmenge aus dem Aufwand wie bei
// der Spritzung, aber ohne Spritzbrühe (kein g/hl, ml/hl); ohne Aufwand keine Mittelmenge (Grund 'art').
// Mengen in l und kg werden nie ineinander umgerechnet (keine Dichte-Annahme); einzige Ausnahme ist
// mittelmengeKg(…, { literAlsKg: true }) für die Kupfer-Bilanz (wie bisher, als Hinweis gemeldet).

/** Einheit einer Mittelmenge: Masse in kg, Volumen in l */
export type MittelEinheit = 'kg' | 'l'

/**
 * Warum keine Mittelmenge bestimmbar ist:
 *  'aufwand'   Spritzung ohne Aufwand (bzw. ohne Aufwand-Einheit)
 *  'flaeche'   Aufwand je ha bzw. Wasseraufwand, aber keine behandelte Fläche
 *  'bruehe'    g/hl bzw. ml/hl ohne Spritzbrühe und ohne Wasseraufwand
 *  'einheit'   Einheit nicht umrechenbar bzw. nicht zulässig (z. B. Düngermenge in l bei Düngemittel in kg)
 *  'menge'     Düngung ohne Düngermenge und ohne Aufwand
 *  'ungueltig' negative oder ungültige Zahl
 *  'art'       weder Spritzung noch Düngung (bzw. Sonstiges ohne Aufwand)
 */
export type MittelmengeGrund = 'aufwand' | 'flaeche' | 'bruehe' | 'einheit' | 'menge' | 'ungueltig' | 'art'

export type MittelmengeErgebnis = {
  /** Menge des Mittels bzw. Düngers in `einheit` (3 Stellen); null = nicht bestimmbar */
  menge: number | null
  einheit: MittelEinheit | null
  /** Rechenweg, z. B. „Aufwand × Fläche“; null ohne Menge */
  basis: string | null
  /** nur ohne Menge: kurzer Grund („ohne Aufwand“) – zum Anhängen an behandlungKurz() */
  warnung: string | null
  grund: MittelmengeGrund | null
}

/** Felder, die mittelmenge() liest – PsmBehandlung erfüllt sie, Formulare und Actions bauen sie selbst */
export type MittelmengeEingabe = Pick<PsmBehandlung, 'art' | 'aufwand' | 'aufwandEinheit' | 'mengeGesamt' | 'mengeEinheit' | 'wasserLHa' | 'flaecheHa'> & {
  /** nur Düngung: Einheit des Düngemittels ('kg' | 'l'); ohne Angabe gilt kg */
  duengemittel?: Pick<PsmDuengemittel, 'einheit'> | null
}

/** kg, g, l, ml → Grundeinheit kg bzw. l */
const ZU_GRUNDEINHEIT: Readonly<Record<string, { einheit: MittelEinheit; faktor: number }>> = {
  kg: { einheit: 'kg', faktor: 1 }, g: { einheit: 'kg', faktor: 0.001 },
  l: { einheit: 'l', faktor: 1 }, ml: { einheit: 'l', faktor: 0.001 },
}

function positiv(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Spritzbrühe (l, ungerundet) samt Herkunft; null bei anderen Arten und ohne Angabe. Ein Altwert in kg/g
 * (bruehenAltwert) ist keine Brühe – dann nur Wasseraufwand × Fläche, sonst null.
 */
function brueheLiter(b: MittelmengeEingabe): { liter: number; quelle: 'erfasst' | 'wasser' } | null {
  if (b.art !== 'spritzung') return null
  const m = positiv(b.mengeGesamt)
  // ohne Einheit gilt l: bei Spritzungen gibt es keine andere Brühen-Einheit
  if (m !== null && (!b.mengeEinheit || b.mengeEinheit === 'l' || b.mengeEinheit === 'ml')) {
    return { liter: b.mengeEinheit === 'ml' ? m / 1000 : m, quelle: 'erfasst' }
  }
  const w = positiv(b.wasserLHa), ha = positiv(b.flaecheHa)
  return w !== null && ha !== null ? { liter: w * ha, quelle: 'wasser' } : null
}

/**
 * Spritzbrühe einer Spritzung in l (3 Stellen): „Menge gesamt“ in l bzw. ml, sonst Wasseraufwand
 * (l/ha) × behandelte Fläche – auch bei Altwerten in kg/g (bruehenAltwert), die nie als Brühe gelten.
 * null bei anderen Arten und ohne Angabe. Nur für Anzeige und CSV – NIE über Maßnahmen summieren:
 * eine Tankmischung sind mehrere Maßnahmen mit derselben Brühe.
 */
export function spritzbruehe(b: MittelmengeEingabe): number | null {
  const br = brueheLiter(b)
  return br ? runden(br.liter, STELLEN_MENGE) : null
}

/**
 * Spritzung, deren „Menge gesamt“ noch in kg bzw. g erfasst ist (vor KAN-133 als Mittelmenge gedacht):
 * weder Spritzbrühe noch Mittelmenge – zählt nirgends; Bearbeiten-Formular warnt.
 */
export function bruehenAltwert(b: Pick<PsmBehandlung, 'art' | 'mengeGesamt' | 'mengeEinheit'>): boolean {
  return b.art === 'spritzung' && b.mengeGesamt !== null && (b.mengeEinheit === 'kg' || b.mengeEinheit === 'g')
}

/**
 * Menge des Mittels (Spritzung) bzw. Düngers (Düngung) einer Maßnahme in kg oder l, 3 Stellen
 * (Regeln siehe Abschnittskopf). Je Maßnahme gerechnet – Summen addieren diese gerundeten Werte.
 * Ohne Menge: warnung und grund sagen, warum (z. B. „ohne Aufwand“).
 */
export function mittelmenge(b: MittelmengeEingabe): MittelmengeErgebnis {
  const ohne = (grund: MittelmengeGrund, warnung: string): MittelmengeErgebnis => ({ menge: null, einheit: null, basis: null, warnung, grund })
  const ergebnis = (menge: number, einheit: MittelEinheit, basis: string): MittelmengeErgebnis =>
    Number.isFinite(menge) && menge >= 0
      ? { menge: runden(menge, STELLEN_MENGE), einheit, basis, warnung: null, grund: null }
      : ohne('ungueltig', 'Menge negativ oder ungültig')
  const ha = positiv(b.flaecheHa)
  const a = typeof b.aufwand === 'number' && Number.isFinite(b.aufwand) ? b.aufwand : null
  const ae = b.aufwandEinheit

  if (b.art === 'duengung') {
    const inLiter = b.duengemittel?.einheit === 'l'
    const nichtInLiter = 'Düngemittel nicht in l geführt'
    // 1. Düngermenge
    let hinweis: string | null = null
    const m = typeof b.mengeGesamt === 'number' && Number.isFinite(b.mengeGesamt) ? b.mengeGesamt : null
    if (m !== null) {
      const e = b.mengeEinheit ? ZU_GRUNDEINHEIT[b.mengeEinheit] : undefined
      if (e && (e.einheit === 'kg' || inLiter)) {
        return ergebnis(m * e.faktor, e.einheit, e.faktor === 1 ? 'Düngermenge' : `Düngermenge (${b.mengeEinheit})`)
      }
      hinweis = e ? `Düngermenge in ${b.mengeEinheit}, ${nichtInLiter}`
        : b.mengeEinheit ? `Mengeneinheit „${b.mengeEinheit}“ nicht umrechenbar` : 'Düngermenge ohne Einheit'
    }
    // 2. Aufwand
    if (a !== null && ae) {
      if (ae === 'kg_ha' || (ae === 'l_ha' && inLiter)) {
        return ha !== null ? ergebnis(a * ha, ae === 'kg_ha' ? 'kg' : 'l', 'Aufwand × Fläche') : ohne('flaeche', 'ohne behandelte Fläche')
      }
      const e = ZU_GRUNDEINHEIT[ae]
      if (e && (e.einheit === 'kg' || inLiter)) return ergebnis(a * e.faktor, e.einheit, e.faktor === 1 ? 'Aufwand (gesamt)' : `Aufwand (gesamt, ${ae})`)
      let text: string
      if (ae === 'g_hl' || ae === 'ml_hl') text = 'Konzentration (g/hl, ml/hl) bei Düngung nicht zulässig'
      else if (ae === 'l_ha' || e) text = `Aufwand in ${einheitText(ae)}, ${nichtInLiter}`
      else text = `Aufwand-Einheit „${ae}“ nicht umrechenbar`
      return ohne('einheit', hinweis ?? text)
    }
    return hinweis ? ohne('einheit', hinweis) : ohne('menge', 'ohne Düngermenge und Aufwand')
  }

  if (b.art === 'sonstiges') {
    if (a === null || !ae) return ohne('art', 'bei Sonstiges ohne Aufwand keine Mittelmenge')
    if (ae === 'g_hl' || ae === 'ml_hl') return ohne('einheit', 'Konzentration (g/hl, ml/hl) nur bei Spritzung')
  } else if (b.art !== 'spritzung') return ohne('art', `bei ${ART_LABEL[b.art] ?? b.art} keine Mittelmenge`)
  if (a === null || !ae) return ohne('aufwand', 'ohne Aufwand')
  if (ae === 'kg_ha' || ae === 'l_ha') {
    return ha !== null ? ergebnis(a * ha, ae === 'kg_ha' ? 'kg' : 'l', 'Aufwand × Fläche') : ohne('flaeche', 'ohne behandelte Fläche')
  }
  if (ae === 'g_hl' || ae === 'ml_hl') {
    const br = brueheLiter(b)
    if (!br) return positiv(b.wasserLHa) !== null ? ohne('flaeche', 'ohne behandelte Fläche') : ohne('bruehe', 'ohne Spritzbrühe und Wasseraufwand')
    return ergebnis(a * br.liter / 100 / 1000, ae === 'g_hl' ? 'kg' : 'l',
      br.quelle === 'erfasst' ? 'Konzentration × Spritzbrühe' : 'Konzentration × Wasseraufwand × Fläche')
  }
  const e = ZU_GRUNDEINHEIT[ae]
  if (e) return ergebnis(a * e.faktor, e.einheit, e.faktor === 1 ? 'Aufwand (gesamt)' : `Aufwand (gesamt, ${ae})`)
  return ohne('einheit', `Aufwand-Einheit „${ae}“ nicht umrechenbar`)
}

/**
 * Menge von einer Einheit in eine andere (kg ↔ g, l ↔ ml; 3 Stellen), z. B. die Mittelmenge in die
 * Einheit des Lagers. Masse ↔ Volumen (kg ↔ l) ist ohne Dichte nicht umrechenbar → null
 * (Lager: kein Abzug, nur Hinweis).
 */
export function mengeInEinheit(menge: number, von: string | null | undefined, nach: string | null | undefined): number | null {
  const v = von ? ZU_GRUNDEINHEIT[von] : undefined
  const n = nach ? ZU_GRUNDEINHEIT[nach] : undefined
  if (!v || !n || v.einheit !== n.einheit || !Number.isFinite(menge)) return null
  return runden(menge * v.faktor / n.faktor, STELLEN_MENGE)
}

export type Mittelmenge = { kg: number; basis: string; dichteAngenommen: boolean }

/**
 * Mittelmenge in kg (3 Stellen) für Kupfer- und Nährstoffbilanz, aus mittelmenge(): Spritzung nur
 * aus dem Aufwand, Düngung aus der Düngermenge, sonst dem Aufwand. Mengen in l nur mit literAlsKg
 * (Kupfer, wie bisher: Dichte 1 kg/l angenommen → dichteAngenommen, Basis „… (1 kg/l)“).
 * null = keine Mittelmenge in kg; den Grund liefert mittelmenge(b).warnung.
 */
export function mittelmengeKg(b: MittelmengeEingabe, opt: { literAlsKg: boolean }): Mittelmenge | null {
  const mm = mittelmenge(b)
  if (mm.menge === null || mm.basis === null) return null
  if (mm.einheit === 'kg') return { kg: mm.menge, basis: mm.basis, dichteAngenommen: false }
  if (mm.einheit === 'l' && opt.literAlsKg) return { kg: mm.menge, basis: `${mm.basis} (1 kg/l)`, dichteAngenommen: true }
  return null
}

/** Kurzbeschreibung einer Maßnahme für Hinweise: „Spritzung am 10.07.2026 (Pfaffenberg Riesling)“ */
export function behandlungKurz(b: PsmBehandlung): string {
  const wo = weingartenText(b)
  return `${ART_LABEL[b.art] ?? b.art} am ${datumDe(b.datum)}${wo ? ` (${wo})` : ''}`
}

// ── Laden ───────────────────────────────────────────────────────────────────

export type BehandlungenFilter = {
  /** 'JJJJ-MM-TT' inklusive; null = ohne Grenze */
  von?: string | null
  bis?: string | null
  /** Maßnahmenart (ART_LABEL-Schlüssel); null = alle */
  art?: string | null
  /** nur diese Maßnahmen (KAN-132: Weingarten-Detail); in Blöcken zu 100 abgefragt (URL-Länge) */
  ids?: readonly string[] | null
}

/**
 * Alle Maßnahmen des Betriebs im Zeitraum samt Grundstücken, Mittel und Düngemittel.
 * behandlung_grundstuecke hat keine tenant_id – die Grundstücke kommen deshalb eingebettet
 * über die mandantengefilterte Maßnahme (nicht als eigene, ungefilterte Abfrage).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeBehandlungen(supabase: any, tenantId: string, f: BehandlungenFilter = {}): Promise<{ behandlungen: PsmBehandlung[]; warnungen: string[] }> {
  if (f.ids) {
    const ids = [...new Set(f.ids)]
    const teile: { behandlungen: PsmBehandlung[]; warnungen: string[] }[] = []
    for (let i = 0; i < ids.length; i += 100) teile.push(await ladeBehandlungen(supabase, tenantId, { ...f, ids: null, nurIds: ids.slice(i, i + 100) } as BehandlungenFilter))
    return {
      behandlungen: teile.flatMap(t => t.behandlungen).sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id)),
      warnungen: [...new Set(teile.flatMap(t => t.warnungen))],
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('behandlungen') as any)
    .select(`
      id, datum, datum_bis, art, weingarten_id, psm_id, duengemittel_id, durchgefuehrt_von,
      aufwandmenge, aufwandmenge_einheit, menge_gesamt, menge_einheit, konzentration,
      wasseraufwand_l_ha, behandelte_flaeche_ha, bbch_stadium, schaderreger, witterung,
      temperatur_c, windstaerke, ernte_fruehesteins, wartezeit_eingehalten, notizen,
      uhrzeit_von, uhrzeit_bis, art_verwendung, anwender_name, erfasst_von, created_at,
      weingarten:weingarten_id(id, name, ried, flaeche_ha, lage_id, ama_feldnummer, lagen:lage_id(name)),
      psm:psm_id(id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, zulassungsnr, eppo_code, bienengefaehrlich, cu_gehalt_pct, wartezeit_tage, max_aufwand_kg_ha, max_anwendungen, oeko_zugelassen),
      duengemittel:duengemittel_id(id, name, handelsname, typ, einheit, naehrstoff_n_pct, naehrstoff_p_pct, oeko_zugelassen),
      behandlung_grundstuecke(grundstueck_id, flaeche_ha, grundstueck:grundstueck_id(id, gst_nr, katastralgemeinde, kg_bezeichnung, flaeche_ha, ama_feldnummer, weingarten:weingarten_id(id, name, ried, flaeche_ha, lage_id, ama_feldnummer, lagen:lage_id(name))))
    `)
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)   // KAN-88: stornierte Maßnahmen zählen in keinem Bericht, keiner Bilanz, keinem Lager
  if (f.von) q = q.gte('datum', f.von)
  if (f.bis) q = q.lte('datum', f.bis)
  if (f.art) q = q.eq('art', f.art)
  const nurIds = (f as { nurIds?: string[] }).nurIds
  if (nurIds) q = q.in('id', nurIds.length > 0 ? nurIds : ['00000000-0000-0000-0000-000000000000'])
  const { data, error } = await alle<R>(q.order('datum').order('id'))
  if (error) throw new AktionsFehler(`Maßnahmen konnten nicht geladen werden: ${error.message}`)

  // Anwender und erfassender Benutzer (→ auth.users): Namen aus profiles, nur wenn überhaupt gesetzt
  const warnungen: string[] = []
  const ids = [...new Set(data.flatMap(b => [textOderNull(b.durchgefuehrt_von), textOderNull(b.erfasst_von)]).filter((x): x is string => !!x))]
  const namen = new Map<string, string>()
  if (ids.length > 0) {
    // alle-ausnahme: Benutzer des Betriebs (Anwender der Maßnahmen), wenige
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prof, error: pErr } = await (supabase.from('profiles') as any)
      .select('id, full_name, display_name')
      .in('id', ids)
    if (pErr) warnungen.push(`Anwender-Namen konnten nicht geladen werden (${pErr.message}) – Spalte „Anwender“ bleibt leer.`)
    for (const p of ((prof ?? []) as R[])) {
      const name = textOderNull(p.full_name) ?? textOderNull(p.display_name)
      if (name && p.id) namen.set(String(p.id), name)
    }
  }
  return { behandlungen: data.map(b => normalisiereBehandlung(b, namen)), warnungen }
}

/**
 * Weingärten des Betriebs (auch inaktive – frühere Maßnahmen verweisen darauf) samt Σ WI-GST-Fläche.
 * Die Grundstücke kommen eingebettet über den mandantengefilterten Weingarten; Nutzart WI wie in
 * createBehandlung (Brache, Gerodet usw. zählen nicht).
 */
// KAN-150 F1: opt.jahr – deaktivierte Grundstücke zählen in der WI-Fläche nur, wenn sie am 1.1. des Jahres noch
// bewirtschaftet wurden; ohne Jahr nur heute aktive. Die GST-Liste (wiGst) bleibt vollständig (frühere Maßnahmen).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeWeingaerten(supabase: any, tenantId: string, opt: { jahr?: number | null } = {}): Promise<WeingartenStamm[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle<R>((supabase.from('weingarten') as any)
    .select('id, name, ried, flaeche_ha, aktiv, lage_id, lagen:lage_id(name), grundstuecke(id, gst_nr, katastralgemeinde, kg_bezeichnung, flaeche_ha, nutzart, aktiv, deaktiviert_am)')
    .eq('tenant_id', tenantId)
    .order('name').order('id'))
  if (error) throw new AktionsFehler(`Weingärten konnten nicht geladen werden: ${error.message}`)
  return data.map(w => {
    const wi = ((w.grundstuecke ?? []) as R[]).filter(g => g.nutzart === 'WI')
    return {
      id: String(w.id),
      name: textOderNull(w.name) ?? '–',
      ried: riedAus(w),
      lageId: textOderNull(w.lage_id),
      flaecheHa: rund(zahl(w.flaeche_ha), STELLEN.ha),
      aktiv: w.aktiv !== false,
      wiFlaecheHa: runden(wi.filter(g => (opt.jahr ? gstImJahr(g, opt.jahr) : gstAktiv(g))).reduce((s, g) => s + (zahl(g.flaeche_ha) ?? 0), 0), STELLEN.ha),
      wiGst: wi.filter(g => g.id).map(g => ({
        grundstueckId: String(g.id), gstNr: textOderNull(g.gst_nr), kgNr: textOderNull(g.katastralgemeinde), kgName: textOderNull(g.kg_bezeichnung),
        weingartenId: String(w.id), weingarten: textOderNull(w.name), ried: riedAus(w), lageId: textOderNull(w.lage_id),
        flaecheHa: rund(zahl(g.flaeche_ha), STELLEN.ha),
      })),
    }
  })
}

/** Betriebsfläche: Σ Stammdaten-Fläche der aktiven Weingärten (ha, 4 Stellen) – bisheriger Nenner der Cu-/Nährstoffbilanz */
export function betriebsflaecheHa(weingaerten: readonly WeingartenStamm[]): number {
  return runden(weingaerten.filter(w => w.aktiv).reduce((s, w) => s + (w.flaecheHa ?? 0), 0), STELLEN.ha)
}

/**
 * Betriebsfläche nach KAN-132 Regel 8 (vorgezogen in KAN-133): Σ WI-GST-Fläche der aktiven Weingärten
 * (ha, 4 Stellen) – Nenner für Cu je ha des Betriebs. Unabhängig von weingarten.flaeche_ha, das bei
 * vielen Betrieben leer ist. 0 = keine WI-Fläche (Anzeige „–“, nicht „0,00“).
 */
export function betriebsflaecheWi(weingaerten: readonly Pick<WeingartenStamm, 'aktiv' | 'wiFlaecheHa'>[]): number {
  return runden(weingaerten.filter(w => w.aktiv).reduce((s, w) => s + (w.wiFlaecheHa ?? 0), 0), STELLEN.ha)
}

// ── Parameter (CSV-Route und Druckseiten) ───────────────────────────────────

/** Jahr aus ?jahr=…: null = alle Jahre (leer oder „all“), undefined = ungültig */
export function jahrAus(wert: string | null | undefined): number | null | undefined {
  const s = (wert ?? '').trim()
  if (s === '' || s === 'all') return null
  if (!/^\d{4}$/.test(s)) return undefined
  const j = Number(s)
  return j >= 1900 && j <= 2200 ? j : undefined
}

/** Zeitraum eines Jahres (null = ohne Grenze) */
export function jahrZeitraum(jahr: number | null, vorjahre = 0): { von: string | null; bis: string | null } {
  if (jahr === null) return { von: null, bis: null }
  return { von: `${jahr - vorjahre}-01-01`, bis: `${jahr}-12-31` }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Ried-Filter aus ?ried=…: Ried-id (Ried = Entität weingarten, KAN-132) oder OHNE_RIED;
 * null = alle Rieden (leer oder „all“), undefined = ungültig. Bis 30.09.2026 war es die Lage-id.
 */
export function riedFilterAus(wert: string | null | undefined): string | null | undefined {
  const s = (wert ?? '').trim()
  if (s === '' || s === 'all') return null
  return s === OHNE_RIED || UUID_RE.test(s) ? s : undefined
}

/** Maßnahmenart aus ?art=…: null = alle Arten, undefined = unbekannt */
export function artAus(wert: string | null | undefined): string | null | undefined {
  const s = (wert ?? '').trim()
  if (s === '' || s === 'all') return null
  return Object.prototype.hasOwnProperty.call(ART_LABEL, s) ? s : undefined
}

// ── Meldung „psm-aufzeichnung“: eine Zeile je Maßnahme × Grundstück ─────────

export type PsmAufzeichnungZeile = {
  behandlungId: string
  datum: string
  datumBis: string | null
  art: string
  /** Ried = Weingarten (KAN-132) */
  ried: string | null
  /** Lage (lagen.name, sonst weingarten.ried) – Ebene über der Ried */
  lage: string | null
  kgNr: string | null
  kgName: string | null
  gstNr: string | null
  /** Fläche des Grundstücks (ha) */
  flaecheHa: number | null
  kultur: string
  eppoKultur: string | null
  mittel: string | null
  zulassungsnr: string | null
  wirkstoff: string | null
  schaderreger: string | null
  /** KAN-86: EPPO-Code des Hauptschaderregers aus den Stammdaten des Mittels */
  eppoSchaderreger: string | null
  /** KAN-86: Mittel bienengefährlich (nur Pflanzenschutz) */
  bienengefaehrlich: boolean | null
  bbch: string | null
  aufwand: number | null
  aufwandEinheit: string
  /** Mittelmenge (mittelmenge(): Mittel bzw. Dünger) anteilig nach Fläche des Grundstücks – verteileMassnahme() (KAN-132, Restausgleich) */
  mittelmengeAnteil: number | null
  /** kg oder l; leer ohne Mittelmenge */
  mittelmengeEinheit: string
  /** Rechenweg der Mittelmenge der Maßnahme, z. B. „Aufwand × Fläche“ */
  mittelmengeBasis: string | null
  /** Spritzbrühe (l) anteilig nach Fläche des Grundstücks – nur Spritzungen */
  spritzbruehAnteil: number | null
  wasserLHa: number | null
  konzentrationPct: number | null
  wartezeitTage: number | null
  fruehesterLesetermin: string | null
  wartezeitEingehalten: boolean | null
  oeko: boolean | null
  anwender: string | null
  witterung: string | null
  temperaturC: number | null
  wind: string | null
  notiz: string | null
  /** KAN-87 */
  uhrzeitVon: string | null
  uhrzeitBis: string | null
  artVerwendung: string | null
  amaFeldstueck: string | null
  amaSchlag: string | null
  erfasstAm: string | null
  erfasstVon: string | null
}

export type PsmAufzeichnungFilter = { ried?: string | null }

/**
 * Zeilen je Maßnahme × Grundstück (bereits gerundet) plus Hinweise. Mittelmenge und Spritzbrühe der
 * Maßnahme stehen nur anteilig nach Grundstücksfläche in der Zeile (KAN-133 Nr. 7) – nie die
 * Gesamtwerte der Maßnahme, sonst ergäbe die Spaltensumme in Excel ein Vielfaches. Seit KAN-132 über
 * verteileMassnahme() (lib/wein/massnahmeAnteile.ts): Methode des größten Rests, Σ der Zeilen = Wert der
 * Maßnahme; Maßnahmen nur am Weingarten bleiben eine Zeile ohne GST (keine GST-Zeilen erfinden).
 */
export function psmAufzeichnungZeilen(behandlungen: readonly PsmBehandlung[], filter: PsmAufzeichnungFilter = {}): { zeilen: PsmAufzeichnungZeile[]; warnungen: string[] } {
  const zeilen: PsmAufzeichnungZeile[] = []
  const ohneGst: string[] = []
  const ohneOrt: string[] = []
  const ohneMittelmenge: string[] = []
  const altwerte: string[] = []
  const nichtVerteilt: string[] = []
  // KAN-86: Registernummer ist Pflichtangabe (DVO (EU) 2023/564) – fehlt sie am Mittel, X-Warnung je Mittel
  const ohneZulassung = new Set<string>()
  for (const b of behandlungen) {
    const v = verteileMassnahme(b)
    let orte: (GstAnteil | null)[] = v.anteile
    if (filter.ried) orte = v.anteile.filter(a => (a.weingartenId ?? OHNE_RIED) === filter.ried)
    if (filter.ried && orte.length === 0) continue
    if (v.ohneOrt) { ohneOrt.push(behandlungKurz(b)); orte = [null] }
    else if (gstAnzahl(b) === 0) ohneGst.push(behandlungKurz(b))

    const mm = mittelmenge(b)
    const bruehe = spritzbruehe(b)
    if (mm.menge === null && mm.grund !== 'art') ohneMittelmenge.push(`${behandlungKurz(b)} – ${mm.warnung}`)
    if (bruehenAltwert(b)) altwerte.push(behandlungKurz(b))

    const istPsm = b.psm !== null
    if (istPsm && !b.psm?.zulassungsnr) ohneZulassung.add(b.psm?.name ?? '–')
    for (const g of orte) {
      zeilen.push({
        behandlungId: b.id,
        datum: b.datum,
        datumBis: b.datumBis,
        art: ART_LABEL[b.art] ?? b.art,
        ried: g?.weingarten ?? null,
        lage: g?.lage ?? null,
        kgNr: g?.kgNr ?? null,
        kgName: g?.kgName ?? null,
        gstNr: g?.gstNr ?? null,
        flaecheHa: g?.flaecheHa ?? null,
        kultur: KULTUR_REBE,
        // KAN-86: Kultur ist immer die Weinrebe (VITVI) – der EPPO-Code am Mittel bezeichnet den Schaderreger
        eppoKultur: EPPO_REBE,
        mittel: mittelName(b),
        zulassungsnr: b.psm?.zulassungsnr ?? null,
        wirkstoff: b.psm?.wirkstoff ?? null,
        schaderreger: b.schaderreger,
        eppoSchaderreger: b.psm?.eppoCode ?? null,
        bienengefaehrlich: istPsm ? (b.psm?.bienengefaehrlich ?? null) : null,
        bbch: b.bbch,
        aufwand: rund(b.aufwand, STELLEN_MENGE),
        // „kg (gesamt)“ bzw. „l (gesamt)“: Wert der Maßnahme, keine Menge je Grundstück (die steht in „Mittelmenge anteilig“)
        aufwandEinheit: aufwandEinheitText(b.aufwandEinheit),
        mittelmengeAnteil: g ? g.mittel : mm.menge,
        mittelmengeEinheit: mm.einheit ?? '',
        mittelmengeBasis: mm.basis,
        spritzbruehAnteil: g ? g.bruehe : bruehe,
        wasserLHa: rund(b.wasserLHa, 1),
        konzentrationPct: rund(b.konzentrationPct, STELLEN.prozent),
        wartezeitTage: b.psm?.wartezeitTage ?? null,
        fruehesterLesetermin: b.fruehesterLesetermin,
        wartezeitEingehalten: b.wartezeitEingehalten,
        oeko: b.psm?.oeko ?? b.duengemittel?.oeko ?? null,
        anwender: b.anwender,
        witterung: witterungText(b.witterung),
        temperaturC: rund(b.temperaturC, 1),
        wind: windText(b.wind),
        notiz: b.notiz,
        uhrzeitVon: b.uhrzeitVon ?? null,
        uhrzeitBis: b.uhrzeitBis ?? null,
        artVerwendung: istPsm ? (b.artVerwendung ?? null) : null,
        ...amaNummern(b, g?.grundstueckId ?? null, g?.weingartenId ?? null),
        erfasstAm: b.erfasstAm ?? null,
        erfasstVon: b.erfasstVon ?? null,
      })
    }
    // KAN-132 Regel 2: GST ohne Fläche bekommen keinen Anteil; ganz ohne Fläche gleichmäßig verteilt
    if ((mm.menge !== null || bruehe !== null) && v.warnungen.length > 0) {
      nichtVerteilt.push(`${behandlungKurz(b)} – ${v.warnungen.includes(WARNUNG_GLEICH) ? 'ohne Fläche gleichmäßig verteilt' : 'nur auf GST mit Fläche verteilt'}`)
    }
  }
  const warnungen: string[] = []
  if (ohneGst.length > 0) warnungen.push(`${ohneGst.length} ${ohneGst.length === 1 ? 'Maßnahme ist' : 'Maßnahmen sind'} keinem Grundstück zugeordnet – je eine Zeile für den Weingarten ohne GST-Nr.: ${liste(ohneGst)}`)
  if (ohneOrt.length > 0) warnungen.push(`${ohneOrt.length} ${ohneOrt.length === 1 ? 'Maßnahme hat' : 'Maßnahmen haben'} weder Grundstück noch Weingarten – Ried, GST-Nr. und Fläche bleiben leer: ${liste(ohneOrt)}`)
  if (ohneMittelmenge.length > 0) warnungen.push(`${ohneMittelmenge.length} ${ohneMittelmenge.length === 1 ? 'Maßnahme' : 'Maßnahmen'} ohne berechenbare Mittelmenge – „Mittelmenge anteilig (GST)“ bleibt leer: ${liste(ohneMittelmenge)}`)
  if (altwerte.length > 0) warnungen.push(`${altwerte.length} ${altwerte.length === 1 ? 'Spritzung hat' : 'Spritzungen haben'} „Menge gesamt“ noch in kg bzw. g (früher als Mittelmenge erfasst) – zählt weder als Spritzbrühe noch als Mittelmenge; Spritzbrühe nur aus Wasseraufwand × Fläche, Mittelmenge aus dem Aufwand: ${liste(altwerte)}`)
  if (nichtVerteilt.length > 0) warnungen.push(`${nichtVerteilt.length} ${nichtVerteilt.length === 1 ? 'Maßnahme hat' : 'Maßnahmen haben'} Grundstücke ohne Fläche – dort kein Anteil an „Mittelmenge anteilig (GST)“ und „Spritzbrühe anteilig (GST, l)“ (ganz ohne Fläche gleichmäßig verteilt): ${liste(nichtVerteilt)}`)
  if (ohneZulassung.size > 0) warnungen.push(`${ohneZulassung.size} ${ohneZulassung.size === 1 ? 'Mittel hat' : 'Mittel haben'} keine Registernummer (Zulassungsnr., Pflichtangabe nach DVO (EU) 2023/564) – bitte unter Pflanzenschutz › Lager › Stammdaten ergänzen: ${liste([...ohneZulassung].sort((a, c) => a.localeCompare(c, 'de')))}`)
  return { zeilen, warnungen }
}

/** KAN-87: AMA-Feldstück/-Schlag zum Ort einer Zeile (GST bzw. Weingarten ohne GST) */
export function amaNummern(b: PsmBehandlung, grundstueckId: string | null, weingartenId: string | null): { amaFeldstueck: string | null; amaSchlag: string | null } {
  const g = (grundstueckId ? b.grundstuecke.find(x => x.grundstueckId === grundstueckId) : null)
    ?? b.grundstuecke.find(x => x.grundstueckId === null && x.weingartenId === weingartenId) ?? null
  return { amaFeldstueck: g?.amaFeldstueck ?? null, amaSchlag: g?.amaSchlag ?? null }
}

/** Höchstens fünf Einträge nennen */
export function liste(eintraege: readonly string[]): string {
  return eintraege.slice(0, 5).join('; ') + (eintraege.length > 5 ? ` … (+${eintraege.length - 5})` : '')
}

export const SPALTEN_PSM_AUFZEICHNUNG: CsvSpalte<PsmAufzeichnungZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Datum bis', typ: 'datum', wert: z => z.datumBis },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  // KAN-132: Ried = Weingarten, darüber die Lage
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Lage', typ: 'text', wert: z => z.lage },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.kgNr },
  { kopf: 'Katastralgemeinde', typ: 'text', wert: z => z.kgName },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Kultur', typ: 'text', wert: z => z.kultur },
  { kopf: 'EPPO-Code Kultur', typ: 'code', wert: z => z.eppoKultur },
  { kopf: 'Mittel', typ: 'text', wert: z => z.mittel },
  { kopf: 'Zulassungsnr.', typ: 'code', wert: z => z.zulassungsnr },
  { kopf: 'Wirkstoff', typ: 'text', wert: z => z.wirkstoff },
  { kopf: 'Schaderreger', typ: 'text', wert: z => z.schaderreger },
  // KAN-86: EPPO-Code des Hauptschaderregers (Stammdaten des Mittels) und Bienengefährlichkeit
  { kopf: 'EPPO-Code Schaderreger', typ: 'code', wert: z => z.eppoSchaderreger },
  { kopf: 'Bienengefährlich', typ: 'janein', wert: z => z.bienengefaehrlich },
  { kopf: 'BBCH', typ: 'code', wert: z => z.bbch },
  { kopf: 'Aufwand', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.aufwand },
  { kopf: 'Aufwand-Einheit', typ: 'text', wert: z => z.aufwandEinheit },
  { kopf: 'Mittelmenge anteilig (GST)', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.mittelmengeAnteil },
  { kopf: 'Mittelmenge Einheit', typ: 'text', wert: z => z.mittelmengeEinheit },
  { kopf: 'Mittelmenge Basis', typ: 'text', wert: z => z.mittelmengeBasis },
  { kopf: 'Spritzbrühe anteilig (GST, l)', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.spritzbruehAnteil },
  { kopf: 'Wasseraufwand (l/ha)', typ: 'dezimal', stellen: 1, wert: z => z.wasserLHa },
  { kopf: 'Konzentration (%)', typ: 'prozent', wert: z => z.konzentrationPct },
  { kopf: 'Wartezeit (Tage)', typ: 'ganzzahl', wert: z => z.wartezeitTage },
  { kopf: 'Frühester Lesetermin', typ: 'datum', wert: z => z.fruehesterLesetermin },
  { kopf: 'Wartezeit eingehalten', typ: 'janein', wert: z => z.wartezeitEingehalten },
  { kopf: 'Öko-zugelassen', typ: 'janein', wert: z => z.oeko },
  { kopf: 'Anwender', typ: 'text', wert: z => z.anwender },
  { kopf: 'Witterung', typ: 'text', wert: z => z.witterung },
  { kopf: 'Temperatur (°C)', typ: 'dezimal', stellen: 1, wert: z => z.temperaturC },
  { kopf: 'Wind', typ: 'text', wert: z => z.wind },
  { kopf: 'Notiz', typ: 'text', wert: z => z.notiz },
  // KAN-87: Startzeit, Art der Verwendung, Feldstück/Schlag, erfasst am/von, Datensatz-ID (wie psm-uebermittlung)
  { kopf: 'Startzeit', typ: 'text', wert: z => z.uhrzeitVon },
  { kopf: 'Endzeit', typ: 'text', wert: z => z.uhrzeitBis },
  { kopf: 'Art der Verwendung', typ: 'text', wert: z => z.artVerwendung },
  { kopf: 'AMA-Feldstück', typ: 'code', wert: z => z.amaFeldstueck },
  { kopf: 'AMA-Schlag', typ: 'code', wert: z => z.amaSchlag },
  { kopf: 'Erfasst am', typ: 'zeitpunkt', wert: z => z.erfasstAm },
  { kopf: 'Erfasst von', typ: 'text', wert: z => z.erfasstVon },
  { kopf: 'Datensatz-ID', typ: 'code', wert: z => z.behandlungId },
]

export type PsmAufzeichnungParameter = { jahr: number | null; art: string | null; ried: string | null }

/** Ladefunktion der Druckseite /reports/behandlungsprotokoll UND der CSV „psm-aufzeichnung“ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladePsmAufzeichnung(supabase: any, tenantId: string, p: PsmAufzeichnungParameter): Promise<LadeErgebnis<PsmAufzeichnungZeile> & { behandlungen: PsmBehandlung[]; warnungen: string[] }> {
  const { behandlungen, warnungen } = await ladeBehandlungen(supabase, tenantId, { ...jahrZeitraum(p.jahr), art: p.art })
  const auswahl = p.ried
    ? behandlungen.filter(b => b.grundstuecke.some(g => (g.weingartenId ?? OHNE_RIED) === p.ried))
    : behandlungen
  const e = psmAufzeichnungZeilen(auswahl, { ried: p.ried })
  return { zeilen: e.zeilen, behandlungen: auswahl, warnungen: [...warnungen, ...e.warnungen] }
}

// ── Meldung „psm-mittelverbrauch“: je Jahr × Mittel × Einheit ───────────────
//
// Seit KAN-133 (26.09.2026) Σ Mittelmenge aus mittelmenge() – nicht mehr Σ „Menge gesamt“, das bei
// Spritzungen die Spritzbrühe ist. Es zählen nur Spritzungen und seit KAN-154 Sonstiges mit Pflanzenschutzmittel
// (wie der Abzug im PSM-Lager).

export type MittelverbrauchZeile = {
  jahr: number
  mittel: string
  zulassungsnr: string | null
  wirkstoff: string | null
  anwendungen: number
  maxAnwendungen: number | null
  /** Σ Mittelmenge der Anwendungen (Summe der je Maßnahme gerundeten Werte), Einheit siehe einheit */
  mittelmenge: number
  /** kg oder l (g bzw. ml rechnet mittelmenge() um); kg und l werden nicht addiert */
  einheit: string
  /** Σ behandelte Fläche der Anwendungen (ha) */
  flaecheHa: number
  /** Ø Aufwand je Anwendung und ha = Σ Mittelmenge ÷ Σ Fläche (Anwendungen mit Fläche), in Einheit je ha */
  aufwandJeHa: number | null
  /** Ø Aufwand in kg/ha – nur bei Mitteln in kg, sonst null */
  aufwandKgHa: number | null
  maxAufwandKgHa: number | null
  anwendungenUeber: boolean
  aufwandUeber: boolean
  /** Grenzwert (kg/ha) vorhanden, Mittel aber in l – ohne Dichte kein Vergleich (Entscheidung 7 in KAN-133) */
  aufwandNichtVergleichbar: boolean
  status: string
}

/** Ø Aufwand je ha hat 3 Stellen */
export const STELLEN_AUFWAND_HA = 3

/** Mittelmenge eines Pflanzenschutzmittels im Mittelverbrauch: nur bei Spritzungen und Sonstiges (KAN-154) */
function psmMittelmenge(b: PsmBehandlung): MittelmengeErgebnis {
  if (b.art === 'spritzung' || b.art === 'sonstiges') return mittelmenge(b)
  return { menge: null, einheit: null, basis: null, warnung: `${ART_LABEL[b.art] ?? b.art} mit Pflanzenschutzmittel – es zählen nur Spritzungen und Sonstiges`, grund: 'art' }
}

/**
 * Mittelverbrauch je Saison: Spritzungen und Sonstiges mit Pflanzenschutzmittel und Mittelmenge (mittelmenge()),
 * gruppiert nach Jahr × Mittel × Einheit (kg und l werden nicht addiert). Grenzwerte: max.
 * Anwendungen je Saison und max. Aufwand je ha (Stammdaten, kg/ha – nur für Mittel in kg).
 * Sortiert nach Jahr (neueste zuerst), dann Menge. Hinweise: mittelverbrauchHinweise().
 */
export function mittelverbrauch(behandlungen: readonly PsmBehandlung[]): MittelverbrauchZeile[] {
  type Summe = { jahr: number; psm: PsmMittel; einheit: MittelEinheit; menge: number; mengeMitFlaeche: number; anwendungen: number; ha: number }
  const gruppen = new Map<string, Summe>()
  for (const b of behandlungen) {
    if (!b.psm) continue
    const mm = psmMittelmenge(b)
    if (mm.menge === null || mm.einheit === null) continue
    const key = `${b.jahr}|${b.psm.id ?? b.psm.name}|${mm.einheit}`
    const s = gruppen.get(key) ?? { jahr: b.jahr, psm: b.psm, einheit: mm.einheit, menge: 0, mengeMitFlaeche: 0, anwendungen: 0, ha: 0 }
    s.menge += mm.menge
    s.anwendungen += 1
    // Ø je ha nur über Anwendungen mit Fläche – sonst stünde deren Menge ohne Fläche im Zähler
    if (b.flaecheHa !== null && b.flaecheHa > 0) { s.ha += b.flaecheHa; s.mengeMitFlaeche += mm.menge }
    gruppen.set(key, s)
  }
  const zeilen = [...gruppen.values()].map((s): MittelverbrauchZeile => {
    const menge = runden(s.menge, STELLEN_MENGE)
    const flaecheHa = runden(s.ha, STELLEN.ha)
    const aufwandJeHa = flaecheHa > 0 ? runden(runden(s.mengeMitFlaeche, STELLEN_MENGE) / flaecheHa, STELLEN_AUFWAND_HA) : null
    // Grenzwert der Stammdaten ist kg/ha: nur Mittel in kg vergleichen, l ohne Dichte nicht
    const inKg = s.einheit === 'kg'
    const aufwandKgHa = inKg ? aufwandJeHa : null
    const maxAufwand = s.psm.maxAufwandKgHa && s.psm.maxAufwandKgHa > 0 ? s.psm.maxAufwandKgHa : null
    const maxAnw = s.psm.maxAnwendungen && s.psm.maxAnwendungen > 0 ? s.psm.maxAnwendungen : null
    const aufwandUeber = maxAufwand !== null && aufwandKgHa !== null && aufwandKgHa > maxAufwand
    const aufwandNichtVergleichbar = maxAufwand !== null && aufwandJeHa !== null && !inKg
    const anwendungenUeber = maxAnw !== null && s.anwendungen > maxAnw
    const teile: string[] = []
    if (aufwandUeber && anwendungenUeber) teile.push('Aufwand und Anwendungen über Grenzwert')
    else if (aufwandUeber) teile.push('Aufwand über Grenzwert')
    else if (anwendungenUeber) teile.push('Anwendungen über Grenzwert')
    if (aufwandNichtVergleichbar) teile.push(`Aufwand-Grenzwert nicht vergleichbar (Einheit ${s.einheit}, Grenzwert in kg/ha)`)
    const status = teile.length > 0 ? teile.join('; ') : 'OK'
    return {
      jahr: s.jahr, mittel: s.psm.name, zulassungsnr: s.psm.zulassungsnr, wirkstoff: s.psm.wirkstoff,
      anwendungen: s.anwendungen, maxAnwendungen: maxAnw,
      mittelmenge: menge, einheit: s.einheit, flaecheHa, aufwandJeHa, aufwandKgHa, maxAufwandKgHa: maxAufwand,
      anwendungenUeber, aufwandUeber, aufwandNichtVergleichbar, status,
    }
  })
  return zeilen.sort((a, b) => b.jahr - a.jahr || b.mittelmenge - a.mittelmenge || vergleiche(a.mittel, b.mittel))
}

/**
 * Hinweise zum Mittelverbrauch (CSV „psm-mittelverbrauch“ und Tab „Mittelverbrauch“): Anwendungen
 * eines Pflanzenschutzmittels ohne Mittelmenge (z. B. „ohne Aufwand“) bzw. ohne behandelte Fläche.
 */
export function mittelverbrauchHinweise(behandlungen: readonly PsmBehandlung[]): string[] {
  const ohneMenge: string[] = []
  const ohneFlaeche: string[] = []
  for (const b of behandlungen) {
    if (!b.psm) continue
    const mm = psmMittelmenge(b)
    if (mm.menge === null) ohneMenge.push(`${behandlungKurz(b)} – ${b.psm.name}: ${mm.warnung}`)
    else if (b.flaecheHa === null || b.flaecheHa <= 0) ohneFlaeche.push(`${behandlungKurz(b)} – ${b.psm.name}`)
  }
  const w: string[] = []
  if (ohneMenge.length > 0) w.push(`${ohneMenge.length} ${ohneMenge.length === 1 ? 'Anwendung' : 'Anwendungen'} ohne berechenbare Mittelmenge – im Mittelverbrauch nicht enthalten: ${liste(ohneMenge)}`)
  if (ohneFlaeche.length > 0) w.push(`${ohneFlaeche.length} ${ohneFlaeche.length === 1 ? 'Anwendung' : 'Anwendungen'} ohne behandelte Fläche – in der Mittelmenge enthalten, im Ø Aufwand je ha nicht: ${liste(ohneFlaeche)}`)
  return w
}

export const SPALTEN_PSM_MITTELVERBRAUCH: CsvSpalte<MittelverbrauchZeile>[] = [
  { kopf: 'Jahr', typ: 'ganzzahl', wert: z => z.jahr },
  { kopf: 'Mittel', typ: 'text', wert: z => z.mittel },
  { kopf: 'Zulassungsnr.', typ: 'code', wert: z => z.zulassungsnr },
  { kopf: 'Wirkstoff', typ: 'text', wert: z => z.wirkstoff },
  { kopf: 'Anwendungen', typ: 'ganzzahl', wert: z => z.anwendungen },
  { kopf: 'Max. Anwendungen', typ: 'ganzzahl', wert: z => z.maxAnwendungen },
  { kopf: 'Mittelmenge', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.mittelmenge },
  { kopf: 'Einheit', typ: 'text', wert: z => z.einheit },
  { kopf: 'Behandelte Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Ø Aufwand (Einheit/ha)', typ: 'dezimal', stellen: STELLEN_AUFWAND_HA, wert: z => z.aufwandJeHa },
  { kopf: 'Ø Aufwand (kg/ha)', typ: 'dezimal', stellen: STELLEN_AUFWAND_HA, wert: z => z.aufwandKgHa },
  { kopf: 'Grenzwert Aufwand (kg/ha)', typ: 'dezimal', stellen: STELLEN_AUFWAND_HA, wert: z => z.maxAufwandKgHa },
  { kopf: 'Status', typ: 'text', wert: z => z.status },
]

/** Ladefunktion der CSV „psm-mittelverbrauch“ – der Tab „Mittelverbrauch“ rechnet mit mittelverbrauch() und mittelverbrauchHinweise() gleich */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladePsmMittelverbrauch(supabase: any, tenantId: string, p: { jahr: number | null }): Promise<LadeErgebnis<MittelverbrauchZeile>> {
  const { behandlungen, warnungen } = await ladeBehandlungen(supabase, tenantId, jahrZeitraum(p.jahr))
  return { zeilen: mittelverbrauch(behandlungen), warnungen: [...warnungen, ...mittelverbrauchHinweise(behandlungen)] }
}
