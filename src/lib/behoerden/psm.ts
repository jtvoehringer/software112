// ── Pflanzenschutz-Aufzeichnungen und Mittelverbrauch (Behördenmeldungen, 24.09.2026) ──
//
// Gemeinsame Grundlage der Gruppe „Pflanzenschutz & Düngung“:
//   • ladeBehandlungen()      – EINE Abfrage auf behandlungen (Mandantenfilter, alle()) samt
//                               Grundstücken (behandlung_grundstuecke), Mittel, Düngemittel,
//                               Weingarten/Ried; normalisiert zu PsmBehandlung.
//   • psm-aufzeichnung        – eine Zeile je Maßnahme × Grundstück (Druck: /reports/behandlungsprotokoll,
//                               /behandlungen/berichte Tab „Ried“).
//   • psm-mittelverbrauch     – eine Zeile je Jahr × Mittel × Einheit (Druck: /behandlungen/berichte Tab
//                               „Mittelverbrauch“).
//   • mittelmengeKg()         – Mittelmenge in kg für Kupfer- und Nährstoffbilanz (cu.ts, naehrstoff.ts).
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
import type { LadeErgebnis } from './typen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// ── Bezeichnungen ───────────────────────────────────────────────────────────

export const ART_LABEL: Record<string, string> = {
  spritzung: 'Spritzung', duengung: 'Düngung', bodenbearbeitung: 'Bodenbearbeitung',
  schnitt: 'Schnitt', laubarbeit: 'Laubarbeit', lese: 'Lese', sonstiges: 'Sonstiges',
}

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
  weingartenId: string | null
  weingarten: string | null
  /** Ried (lagen.name, sonst weingarten.ried) */
  ried: string | null
  lageId: string | null
}

export type PsmMittel = {
  id: string | null
  /** Handelsname, sonst Name */
  name: string
  zulassungsnr: string | null
  wirkstoff: string | null
  wirkstoffgehaltPct: number | null
  eppoCode: string | null
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
  anwender: string | null
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
      weingartenId: textOderNull(wg?.id),
      weingarten: textOderNull(wg?.name),
      ried: riedAus(wg),
      lageId: textOderNull(wg?.lage_id),
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
    })
  }

  const psm: PsmMittel | null = psmRoh ? {
    id: textOderNull(psmRoh.id) ?? textOderNull(roh.psm_id),
    name: textOderNull(psmRoh.handelsname) ?? textOderNull(psmRoh.name) ?? '–',
    zulassungsnr: textOderNull(psmRoh.zulassungsnr),
    wirkstoff: textOderNull(psmRoh.wirkstoff),
    wirkstoffgehaltPct: zahl(psmRoh.wirkstoffgehalt_pct),
    eppoCode: textOderNull(psmRoh.eppo_code),
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
    nPct: zahl(dmRoh.naehrstoff_n_pct),
    pPct: zahl(dmRoh.naehrstoff_p_pct),
    oeko: bool(dmRoh.oeko_zugelassen),
  } : null

  const anwenderId = textOderNull(roh.durchgefuehrt_von)
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
    anwender: anwenderId ? (anwenderNamen?.get(anwenderId) ?? null) : null,
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

/** Anzahl zugeordneter Grundstücke (ohne die Ersatzzeile je Weingarten) */
export function gstAnzahl(b: PsmBehandlung): number {
  return b.grundstuecke.filter(g => g.grundstueckId !== null).length
}

export type Mittelmenge = { kg: number; basis: string; dichteAngenommen: boolean }

/**
 * Menge des Mittels in kg (3 Stellen) für Kupfer- und Nährstoffbilanz. Reihenfolge:
 *  1. Gesamtmenge in kg bzw. g
 *  2. Aufwand kg/ha × behandelte Fläche, Aufwand kg (gesamt)
 *  3. Konzentration g/hl × Wasseraufwand (l/ha) × Fläche
 *  4. nur mit literAlsKg (Kupfer, wie bisher): Aufwand l/ha × Fläche, Gesamtmenge l bzw. ml,
 *     Konzentration ml/hl – Dichte 1 kg/l angenommen (dichteAngenommen)
 * Die Gesamtmenge in Litern kann auch die Spritzbrühe sein (Formular „aus Wasseraufwand berechnet“),
 * deshalb geht bei Flüssigkeiten der Aufwand je ha vor. null = nicht umrechenbar.
 */
export function mittelmengeKg(b: PsmBehandlung, opt: { literAlsKg: boolean }): Mittelmenge | null {
  const ha = b.flaecheHa && b.flaecheHa > 0 ? b.flaecheHa : null
  const m = b.mengeGesamt, me = b.mengeEinheit
  const a = b.aufwand, ae = b.aufwandEinheit
  const w = b.wasserLHa && b.wasserLHa > 0 ? b.wasserLHa : null
  const ergebnis = (kg: number, basis: string, dichteAngenommen = false): Mittelmenge | null =>
    Number.isFinite(kg) && kg >= 0 ? { kg: runden(kg, STELLEN_MENGE), basis, dichteAngenommen } : null

  if (m !== null && me === 'kg') return ergebnis(m, 'Gesamtmenge')
  if (m !== null && me === 'g') return ergebnis(m / 1000, 'Gesamtmenge (g)')
  if (a !== null && ae === 'kg_ha' && ha) return ergebnis(a * ha, 'Aufwand × Fläche')
  if (a !== null && ae === 'kg') return ergebnis(a, 'Aufwand (gesamt)')
  if (a !== null && ae === 'g_hl' && w && ha) return ergebnis(a * (w * ha / 100) / 1000, 'Konzentration × Wasseraufwand × Fläche')
  if (!opt.literAlsKg) return null
  if (a !== null && ae === 'l_ha' && ha) return ergebnis(a * ha, 'Aufwand × Fläche (1 kg/l)', true)
  if (m !== null && me === 'l') return ergebnis(m, 'Gesamtmenge (1 kg/l)', true)
  if (m !== null && me === 'ml') return ergebnis(m / 1000, 'Gesamtmenge (ml, 1 kg/l)', true)
  if (a !== null && ae === 'l') return ergebnis(a, 'Aufwand (gesamt, 1 kg/l)', true)
  if (a !== null && ae === 'ml_hl' && w && ha) return ergebnis(a * (w * ha / 100) / 1000, 'Konzentration × Wasseraufwand × Fläche (1 kg/l)', true)
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
}

/**
 * Alle Maßnahmen des Betriebs im Zeitraum samt Grundstücken, Mittel und Düngemittel.
 * behandlung_grundstuecke hat keine tenant_id – die Grundstücke kommen deshalb eingebettet
 * über die mandantengefilterte Maßnahme (nicht als eigene, ungefilterte Abfrage).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeBehandlungen(supabase: any, tenantId: string, f: BehandlungenFilter = {}): Promise<{ behandlungen: PsmBehandlung[]; warnungen: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('behandlungen') as any)
    .select(`
      id, datum, datum_bis, art, weingarten_id, psm_id, duengemittel_id, durchgefuehrt_von,
      aufwandmenge, aufwandmenge_einheit, menge_gesamt, menge_einheit, konzentration,
      wasseraufwand_l_ha, behandelte_flaeche_ha, bbch_stadium, schaderreger, witterung,
      temperatur_c, windstaerke, ernte_fruehesteins, wartezeit_eingehalten, notizen,
      weingarten:weingarten_id(id, name, ried, flaeche_ha, lage_id, lagen:lage_id(name)),
      psm:psm_id(id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, zulassungsnr, eppo_code, cu_gehalt_pct, wartezeit_tage, max_aufwand_kg_ha, max_anwendungen, oeko_zugelassen),
      duengemittel:duengemittel_id(id, name, handelsname, typ, naehrstoff_n_pct, naehrstoff_p_pct, oeko_zugelassen),
      behandlung_grundstuecke(grundstueck_id, flaeche_ha, grundstueck:grundstueck_id(id, gst_nr, katastralgemeinde, kg_bezeichnung, flaeche_ha, weingarten:weingarten_id(id, name, ried, flaeche_ha, lage_id, lagen:lage_id(name))))
    `)
    .eq('tenant_id', tenantId)
  if (f.von) q = q.gte('datum', f.von)
  if (f.bis) q = q.lte('datum', f.bis)
  if (f.art) q = q.eq('art', f.art)
  const { data, error } = await alle<R>(q.order('datum').order('id'))
  if (error) throw new Error(`Maßnahmen konnten nicht geladen werden: ${error.message}`)

  // Anwender (durchgefuehrt_von → auth.users): Namen aus profiles, nur wenn überhaupt gesetzt
  const warnungen: string[] = []
  const ids = [...new Set(data.map(b => textOderNull(b.durchgefuehrt_von)).filter((x): x is string => !!x))]
  const namen = new Map<string, string>()
  if (ids.length > 0) {
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

/** Weingärten des Betriebs (auch inaktive – frühere Maßnahmen verweisen darauf) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeWeingaerten(supabase: any, tenantId: string): Promise<WeingartenStamm[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle<R>((supabase.from('weingarten') as any)
    .select('id, name, ried, flaeche_ha, aktiv, lage_id, lagen:lage_id(name)')
    .eq('tenant_id', tenantId)
    .order('name').order('id'))
  if (error) throw new Error(`Weingärten konnten nicht geladen werden: ${error.message}`)
  return data.map(w => ({
    id: String(w.id),
    name: textOderNull(w.name) ?? '–',
    ried: riedAus(w),
    lageId: textOderNull(w.lage_id),
    flaecheHa: rund(zahl(w.flaeche_ha), STELLEN.ha),
    aktiv: w.aktiv !== false,
  }))
}

/** Betriebsfläche: Σ Fläche der aktiven Weingärten (ha, 4 Stellen) – wie bisher auf Cu-/Nährstoffbilanz */
export function betriebsflaecheHa(weingaerten: readonly WeingartenStamm[]): number {
  return runden(weingaerten.filter(w => w.aktiv).reduce((s, w) => s + (w.flaecheHa ?? 0), 0), STELLEN.ha)
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

/** Ried-Filter aus ?ried=…: Lage-id oder OHNE_RIED; null = alle Rieden (leer oder „all“), undefined = ungültig */
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
  ried: string | null
  weingarten: string | null
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
  bbch: string | null
  aufwand: number | null
  aufwandEinheit: string
  mengeGesamt: number | null
  mengeEinheit: string
  /** Anteil der Gesamtmenge auf diesem Grundstück (nach Fläche) */
  mengeAnteil: number | null
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
}

export type PsmAufzeichnungFilter = { ried?: string | null }

/** Zeilen je Maßnahme × Grundstück (bereits gerundet) plus Hinweise */
export function psmAufzeichnungZeilen(behandlungen: readonly PsmBehandlung[], filter: PsmAufzeichnungFilter = {}): { zeilen: PsmAufzeichnungZeile[]; warnungen: string[] } {
  const zeilen: PsmAufzeichnungZeile[] = []
  const ohneGst: string[] = []
  const ohneOrt: string[] = []
  for (const b of behandlungen) {
    let orte: (PsmGrundstueck | null)[] = b.grundstuecke
    if (filter.ried) orte = b.grundstuecke.filter(g => (g.lageId ?? OHNE_RIED) === filter.ried)
    if (filter.ried && orte.length === 0) continue
    if (b.grundstuecke.length === 0) { ohneOrt.push(behandlungKurz(b)); orte = [null] }
    else if (gstAnzahl(b) === 0) ohneGst.push(behandlungKurz(b))

    const summeHa = b.grundstuecke.reduce((s, g) => s + (g.flaecheHa ?? 0), 0)
    const istPsm = b.psm !== null
    for (const g of orte) {
      let mengeAnteil: number | null = null
      if (b.mengeGesamt !== null) {
        if (b.grundstuecke.length <= 1) mengeAnteil = b.mengeGesamt
        else if (summeHa > 0 && g?.flaecheHa != null) mengeAnteil = b.mengeGesamt * g.flaecheHa / summeHa
      }
      zeilen.push({
        behandlungId: b.id,
        datum: b.datum,
        datumBis: b.datumBis,
        art: ART_LABEL[b.art] ?? b.art,
        ried: g?.ried ?? null,
        weingarten: g?.weingarten ?? null,
        kgNr: g?.kgNr ?? null,
        kgName: g?.kgName ?? null,
        gstNr: g?.gstNr ?? null,
        flaecheHa: g?.flaecheHa ?? null,
        kultur: KULTUR_REBE,
        eppoKultur: istPsm ? (b.psm?.eppoCode ?? EPPO_REBE) : null,
        mittel: mittelName(b),
        zulassungsnr: b.psm?.zulassungsnr ?? null,
        wirkstoff: b.psm?.wirkstoff ?? null,
        schaderreger: b.schaderreger,
        bbch: b.bbch,
        aufwand: rund(b.aufwand, STELLEN_MENGE),
        aufwandEinheit: einheitText(b.aufwandEinheit),
        mengeGesamt: rund(b.mengeGesamt, STELLEN_MENGE),
        mengeEinheit: einheitText(b.mengeEinheit),
        mengeAnteil: rund(mengeAnteil, STELLEN_MENGE),
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
      })
    }
  }
  const warnungen: string[] = []
  if (ohneGst.length > 0) warnungen.push(`${ohneGst.length} ${ohneGst.length === 1 ? 'Maßnahme ist' : 'Maßnahmen sind'} keinem Grundstück zugeordnet – je eine Zeile für den Weingarten ohne GST-Nr.: ${liste(ohneGst)}`)
  if (ohneOrt.length > 0) warnungen.push(`${ohneOrt.length} ${ohneOrt.length === 1 ? 'Maßnahme hat' : 'Maßnahmen haben'} weder Grundstück noch Weingarten – Ried, GST-Nr. und Fläche bleiben leer: ${liste(ohneOrt)}`)
  return { zeilen, warnungen }
}

/** Höchstens fünf Einträge nennen */
export function liste(eintraege: readonly string[]): string {
  return eintraege.slice(0, 5).join('; ') + (eintraege.length > 5 ? ` … (+${eintraege.length - 5})` : '')
}

export const SPALTEN_PSM_AUFZEICHNUNG: CsvSpalte<PsmAufzeichnungZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Datum bis', typ: 'datum', wert: z => z.datumBis },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Weingarten', typ: 'text', wert: z => z.weingarten },
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
  { kopf: 'BBCH', typ: 'code', wert: z => z.bbch },
  { kopf: 'Aufwand', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.aufwand },
  { kopf: 'Aufwand-Einheit', typ: 'text', wert: z => z.aufwandEinheit },
  { kopf: 'Gesamtmenge', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.mengeGesamt },
  { kopf: 'Mengeneinheit', typ: 'text', wert: z => z.mengeEinheit },
  { kopf: 'Menge anteilig (GST)', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.mengeAnteil },
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
]

export type PsmAufzeichnungParameter = { jahr: number | null; art: string | null; ried: string | null }

/** Ladefunktion der Druckseite /reports/behandlungsprotokoll UND der CSV „psm-aufzeichnung“ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladePsmAufzeichnung(supabase: any, tenantId: string, p: PsmAufzeichnungParameter): Promise<LadeErgebnis<PsmAufzeichnungZeile> & { behandlungen: PsmBehandlung[]; warnungen: string[] }> {
  const { behandlungen, warnungen } = await ladeBehandlungen(supabase, tenantId, { ...jahrZeitraum(p.jahr), art: p.art })
  const auswahl = p.ried
    ? behandlungen.filter(b => b.grundstuecke.some(g => (g.lageId ?? OHNE_RIED) === p.ried))
    : behandlungen
  const e = psmAufzeichnungZeilen(auswahl, { ried: p.ried })
  return { zeilen: e.zeilen, behandlungen: auswahl, warnungen: [...warnungen, ...e.warnungen] }
}

// ── Meldung „psm-mittelverbrauch“: je Jahr × Mittel × Einheit ───────────────

export type MittelverbrauchZeile = {
  jahr: number
  mittel: string
  zulassungsnr: string | null
  wirkstoff: string | null
  anwendungen: number
  maxAnwendungen: number | null
  /** Σ Gesamtmenge (Einheit siehe einheit) */
  mengeGesamt: number
  einheit: string
  /** Σ behandelte Fläche der Anwendungen (ha) */
  flaecheHa: number
  /** Ø Aufwand je Anwendung und ha = Gesamtmenge / Fläche (in der Einheit der Gesamtmenge je ha) */
  aufwandJeHa: number | null
  /** Ø Aufwand umgerechnet in kg/ha – nur für Masseneinheiten (kg, g), sonst null */
  aufwandKgHa: number | null
  maxAufwandKgHa: number | null
  anwendungenUeber: boolean
  aufwandUeber: boolean
  /** Grenzwert (kg/ha) vorhanden, Menge aber in l/ml – kein Vergleich möglich */
  aufwandNichtVergleichbar: boolean
  status: string
}

/** Umrechnung der Mengeneinheit in kg – nur Massen; l/ml sind ohne Dichte nicht mit kg/ha vergleichbar */
const ZU_KG: Readonly<Record<string, number>> = { kg: 1, g: 0.001 }

/** Ø Aufwand je ha hat 3 Stellen */
export const STELLEN_AUFWAND_HA = 3

/**
 * Mittelverbrauch je Saison: Maßnahmen mit Pflanzenschutzmittel und Gesamtmenge, gruppiert nach
 * Jahr × Mittel × Mengeneinheit (kg und l werden nicht addiert). Grenzwerte: max. Anwendungen je
 * Saison und max. Aufwand je ha (Stammdaten). Sortiert nach Jahr (neueste zuerst), dann Menge.
 */
export function mittelverbrauch(behandlungen: readonly PsmBehandlung[]): MittelverbrauchZeile[] {
  type Summe = { jahr: number; psm: PsmMittel; einheit: string; menge: number; anwendungen: number; ha: number }
  const gruppen = new Map<string, Summe>()
  for (const b of behandlungen) {
    if (!b.psm || b.mengeGesamt === null) continue
    const einheit = einheitText(b.mengeEinheit)
    const key = `${b.jahr}|${b.psm.id ?? b.psm.name}|${einheit}`
    const s = gruppen.get(key) ?? { jahr: b.jahr, psm: b.psm, einheit, menge: 0, anwendungen: 0, ha: 0 }
    s.menge += b.mengeGesamt
    s.anwendungen += 1
    s.ha += b.flaecheHa ?? 0
    gruppen.set(key, s)
  }
  const zeilen = [...gruppen.values()].map((s): MittelverbrauchZeile => {
    const mengeGesamt = runden(s.menge, STELLEN_MENGE)
    const flaecheHa = runden(s.ha, STELLEN.ha)
    const aufwandJeHa = flaecheHa > 0 ? runden(mengeGesamt / flaecheHa, STELLEN_AUFWAND_HA) : null
    // Grenzwert der Stammdaten ist kg/ha: nur Masseneinheiten vergleichen (g → /1000), l/ml nicht
    const faktor = ZU_KG[s.einheit]
    const aufwandKgHa = aufwandJeHa !== null && faktor !== undefined ? runden(aufwandJeHa * faktor, STELLEN_AUFWAND_HA) : null
    const maxAufwand = s.psm.maxAufwandKgHa && s.psm.maxAufwandKgHa > 0 ? s.psm.maxAufwandKgHa : null
    const maxAnw = s.psm.maxAnwendungen && s.psm.maxAnwendungen > 0 ? s.psm.maxAnwendungen : null
    const aufwandUeber = maxAufwand !== null && aufwandKgHa !== null && aufwandKgHa > maxAufwand
    const aufwandNichtVergleichbar = maxAufwand !== null && aufwandJeHa !== null && faktor === undefined
    const anwendungenUeber = maxAnw !== null && s.anwendungen > maxAnw
    const teile: string[] = []
    if (aufwandUeber && anwendungenUeber) teile.push('Aufwand und Anwendungen über Grenzwert')
    else if (aufwandUeber) teile.push('Aufwand über Grenzwert')
    else if (anwendungenUeber) teile.push('Anwendungen über Grenzwert')
    if (aufwandNichtVergleichbar) teile.push(`Aufwand-Grenzwert nicht vergleichbar (Einheit ${s.einheit || 'unbekannt'}, Grenzwert in kg/ha)`)
    const status = teile.length > 0 ? teile.join('; ') : 'OK'
    return {
      jahr: s.jahr, mittel: s.psm.name, zulassungsnr: s.psm.zulassungsnr, wirkstoff: s.psm.wirkstoff,
      anwendungen: s.anwendungen, maxAnwendungen: maxAnw,
      mengeGesamt, einheit: s.einheit, flaecheHa, aufwandJeHa, aufwandKgHa, maxAufwandKgHa: maxAufwand,
      anwendungenUeber, aufwandUeber, aufwandNichtVergleichbar, status,
    }
  })
  return zeilen.sort((a, b) => b.jahr - a.jahr || b.mengeGesamt - a.mengeGesamt || vergleiche(a.mittel, b.mittel))
}

export const SPALTEN_PSM_MITTELVERBRAUCH: CsvSpalte<MittelverbrauchZeile>[] = [
  { kopf: 'Jahr', typ: 'ganzzahl', wert: z => z.jahr },
  { kopf: 'Mittel', typ: 'text', wert: z => z.mittel },
  { kopf: 'Zulassungsnr.', typ: 'code', wert: z => z.zulassungsnr },
  { kopf: 'Wirkstoff', typ: 'text', wert: z => z.wirkstoff },
  { kopf: 'Anwendungen', typ: 'ganzzahl', wert: z => z.anwendungen },
  { kopf: 'Max. Anwendungen', typ: 'ganzzahl', wert: z => z.maxAnwendungen },
  { kopf: 'Gesamtmenge', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.mengeGesamt },
  { kopf: 'Einheit', typ: 'text', wert: z => z.einheit },
  { kopf: 'Behandelte Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Ø Aufwand (Einheit/ha)', typ: 'dezimal', stellen: STELLEN_AUFWAND_HA, wert: z => z.aufwandJeHa },
  { kopf: 'Ø Aufwand (kg/ha)', typ: 'dezimal', stellen: STELLEN_AUFWAND_HA, wert: z => z.aufwandKgHa },
  { kopf: 'Grenzwert Aufwand (kg/ha)', typ: 'dezimal', stellen: STELLEN_AUFWAND_HA, wert: z => z.maxAufwandKgHa },
  { kopf: 'Status', typ: 'text', wert: z => z.status },
]

/** Ladefunktion der CSV „psm-mittelverbrauch“ – der Tab „Mittelverbrauch“ rechnet mit mittelverbrauch() gleich */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladePsmMittelverbrauch(supabase: any, tenantId: string, p: { jahr: number | null }): Promise<LadeErgebnis<MittelverbrauchZeile>> {
  const { behandlungen, warnungen } = await ladeBehandlungen(supabase, tenantId, jahrZeitraum(p.jahr))
  const ohneMenge = behandlungen.filter(b => b.psm && b.mengeGesamt === null).map(behandlungKurz)
  const w = [...warnungen]
  if (ohneMenge.length > 0) w.push(`${ohneMenge.length} ${ohneMenge.length === 1 ? 'Anwendung' : 'Anwendungen'} ohne Gesamtmenge – im Mittelverbrauch nicht enthalten: ${liste(ohneMenge)}`)
  return { zeilen: mittelverbrauch(behandlungen), warnungen: w }
}
