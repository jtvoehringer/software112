// ── Blend-Protokoll: Verschnitt- und Umzugsschritte (KAN-77, 03.10.2026) ──────────────────────────────────────
//
// BKI-Termin (R2): „Verschnitt-Protokoll: Menge wäre gut“. Neben den enthaltenen Litern je Herkunft (Haupttabelle,
// Mischungsrechnung KAN-76) zeigt das Blend-Protokoll die Zuflussmengen: jeden Umzug, jede Filtration und jeden
// Verschnitt in eine Charge des Bewegungsgraphen (ladeBewegungsgraph – die Charge bzw. Füllungs-Chargen samt aller
// Vorgänger), mit Datum, von Charge + Gebinde → nach Charge + Gebinde, brutto / Schwund / netto.
//
// Mengen wie im Bewegungsbuch und im Bewegungsgraphen:
//   • Einzelzeile: brutto = brutto_liter, sonst menge_liter; netto = menge_liter, wenn brutto_liter gesetzt ist
//     (dann ist menge_liter schon netto), sonst menge_liter − schwund_liter.
//   • n:m-Umzug (umzug_batch_id): brutto = Σ Quellzeilen, netto = Σ Zielzeilen, Schwund = Differenz.
//   • Verschnitt: netto = Σ Quellen, Schwund = Σ Schwundbuchungen der Quellen beim Verschnitt (KAN-112, schwund_umzug_id),
//     brutto = netto + Schwund; Gebinde aus der Momentaufnahme am Verschnitt (KAN-112: quell_behaelter_id bzw.
//     ziel_behaelter_id, nachbefüllte mit Hinweis „Gebinde rekonstruiert“), sonst am Tag des Verschnitts (gebindeAmTag).
// Charge mit ?stichtag nur Schritte bis zum Stichtag, Füllung nur bis zum Abfülldatum. Stornierte Buchungen
// zählen nicht (KAN-145).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle } from '@/lib/supabase/alle'
import {
  gebindeAmTag, GEBINDE_REKONSTRUIERT, type UmzugGebinde, type VerschnittGebinde,
} from '../kellerbuch/quellGebindeKern'
import { ladeBehaelterNamen, UMZUG_GEBINDE_SELECT } from '../kellerbuch/quellGebinde'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'
type R = Record<string, any>

export type SchrittVorgang = 'Umzug' | 'Filtration' | 'Verschnitt'

/** Eine Seite eines Schritts: Charge und Gebinde (Name), bei mehreren Verschnitt-Quellen mit Litern; rekonstruiert: KAN-112 */
export type SchrittStelle = { charge: string | null; gebinde: string | null; liter?: number; rekonstruiert?: true }

export type BlendSchritt = {
  id: string
  /** 'JJJJ-MM-TT' */
  datum: string
  vorgang: SchrittVorgang
  von: SchrittStelle[]
  nach: SchrittStelle[]
  bruttoLiter: number
  schwundLiter: number
  nettoLiter: number
}

export type UmzugMenge = UmzugGebinde & { menge_liter?: unknown; brutto_liter?: unknown; schwund_liter?: unknown }
export type VerschnittMenge = Omit<VerschnittGebinde, 'quellen'> & {
  created_at?: string | null
  storniert_am?: string | null
  /** KAN-112: Momentaufnahme des Ziel-Gebindes */
  ziel_behaelter_id?: string | null
  gebinde_rekonstruiert?: boolean | null
  quellen: {
    quell_weinausbau_id: string | null; menge_liter?: unknown
    /** KAN-112: Gebinde der Quelle am Verschnitt, Schwundbuchung der Quelle */
    quell_behaelter_id?: string | null; gebinde_rekonstruiert?: boolean | null; schwund_umzug_id?: string | null
  }[]
}

export type SchrittDaten = {
  /** Chargen des Bewegungsgraphen – Schritte IN diese Chargen */
  chargen: ReadonlySet<string>
  umzuege: readonly UmzugMenge[]
  verschneidungen: readonly VerschnittMenge[]
  chargeNamen: ReadonlyMap<string, string>
  /** heutiges Gebinde je Charge */
  gebindeJeCharge: ReadonlyMap<string, string | null>
  behaelterNamen: ReadonlyMap<string, string>
  /** letzter Tag (Stichtag bzw. Abfülldatum), null = alle */
  bis: string | null
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => rund(n, 2)
const tagVon = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '')

/** Schritte aus den Rohdaten – reine Umformung, testbar */
export function blendSchritte(d: SchrittDaten): BlendSchritt[] {
  const umzuege = d.umzuege.filter(u => !u.storniert_am)
  const gebindeName = (id: string | null) => (id ? d.behaelterNamen.get(id) ?? null : null)
  const chargeName = (id: string | null) => (id ? d.chargeNamen.get(id) ?? null : null)
  const stelle = (chargeId: string | null, behaelterId: string | null, datum: string): SchrittStelle => ({
    charge: chargeName(chargeId),
    gebinde: gebindeName(behaelterId ?? (chargeId ? gebindeAmTag(chargeId, datum, umzuege, d.gebindeJeCharge.get(chargeId) ?? null) : null)),
  })
  // Sortierschlüssel neben dem Schritt: Erfassungszeit, am selben Zeitpunkt Umzug vor Verschnitt
  const eintraege: { s: BlendSchritt; erfasst: string; rang: number }[] = []
  const neu = (s: BlendSchritt, erfasst: string | null | undefined, rang: number) => { eintraege.push({ s, erfasst: erfasst ?? '', rang }) }

  // Umzüge und Filtrationen: Einzelzeilen direkt, n:m-Buchungen je Batch
  const batches = new Map<string, UmzugMenge[]>()
  for (const u of umzuege) {
    if (u.umzug_batch_id) { (batches.get(u.umzug_batch_id) ?? batches.set(u.umzug_batch_id, []).get(u.umzug_batch_id)!).push(u); continue }
    if (u.umzug_typ === 'schwund' || !u.nach_weinausbau_id || !d.chargen.has(u.nach_weinausbau_id)) continue
    const datum = tagVon(u.datum)
    const menge = num(u.menge_liter), schwund = num(u.schwund_liter)
    const mitBrutto = u.brutto_liter != null && u.brutto_liter !== ''
    const brutto = mitBrutto ? num(u.brutto_liter) : menge
    const netto = mitBrutto ? menge : Math.max(0, menge - schwund)
    neu({
      id: `ku:${u.id}`, datum,
      vorgang: u.umzug_typ === 'filtration' ? 'Filtration' : 'Umzug',
      von: [stelle(u.von_weinausbau_id, u.von_behaelter_id, datum)],
      nach: [stelle(u.nach_weinausbau_id, u.nach_behaelter_id, datum)],
      bruttoLiter: r2(brutto), schwundLiter: r2(Math.max(0, brutto - netto)), nettoLiter: r2(netto),
    }, u.erstellt_am, 0)
  }
  for (const [batch, zeilen] of batches) {
    const ziele = zeilen.filter(z => z.zeilen_typ === 'ziel' && z.nach_weinausbau_id)
    if (!ziele.some(z => d.chargen.has(z.nach_weinausbau_id as string))) continue
    const quellen = zeilen.filter(z => z.zeilen_typ === 'quelle')
    const erste = [...zeilen].sort((a, b) => String(a.erstellt_am ?? '').localeCompare(String(b.erstellt_am ?? '')))[0]
    const datum = tagVon(erste?.datum)
    const brutto = quellen.reduce((s, q) => s + num(q.menge_liter), 0)
    const netto = ziele.reduce((s, z) => s + num(z.menge_liter), 0)
    neu({
      id: `ub:${batch}`, datum,
      vorgang: zeilen.some(z => z.umzug_typ === 'filtration') ? 'Filtration' : 'Umzug',
      von: quellen.map(q => stelle(q.von_weinausbau_id, q.von_behaelter_id, datum)),
      nach: ziele.map(z => stelle(z.nach_weinausbau_id, z.nach_behaelter_id, datum)),
      bruttoLiter: r2(brutto), schwundLiter: r2(Math.max(0, brutto - netto)), nettoLiter: r2(netto),
    }, erste?.erstellt_am, 0)
  }

  // Verschnitte in Chargen des Graphen – Gebinde am Tag des Verschnitts. Hier das tatsächliche Gebinde der Quelle
  // (eine Zwischencharge im Ziel-Tank steht so da; woher ihr Wein kam, zeigt der Umzugsschritt davor) – die
  // übrigen Anzeigen nennen das Quellgebinde (quellGebindeKern)
  // KAN-112: Gebinde aus der Momentaufnahme am Verschnitt, sofern vorhanden (nachbefüllte Altdaten mit Hinweis)
  const verschnitte = d.verschneidungen.filter(v => !v.storniert_am && v.ziel_weinausbau_id && d.chargen.has(v.ziel_weinausbau_id))
  // KAN-112: Schwundbuchungen beim Verschnitt (keller_umzuege 'schwund', nicht storniert) je id
  const schwundJeId = new Map(umzuege.filter(u => u.umzug_typ === 'schwund').map(u => [u.id, num(u.schwund_liter) || num(u.brutto_liter)]))
  const mitHinweis = (st: SchrittStelle, rekonstruiert: boolean | null | undefined): SchrittStelle =>
    (rekonstruiert && st.gebinde ? { ...st, rekonstruiert: true } : st)
  for (const v of verschnitte) {
    const datum = tagVon(v.datum)
    const quellen = (v.quellen ?? []).filter(q => q.quell_weinausbau_id && num(q.menge_liter) > 0)
    if (quellen.length === 0) continue
    const summe = quellen.reduce((s, q) => s + num(q.menge_liter), 0)
    const schwund = quellen.reduce((s, q) => s + (q.schwund_umzug_id ? schwundJeId.get(q.schwund_umzug_id) ?? 0 : 0), 0)
    neu({
      id: `vs:${v.id}`, datum,
      vorgang: 'Verschnitt',
      von: quellen.map(q => ({
        ...mitHinweis(stelle(q.quell_weinausbau_id, q.quell_behaelter_id ?? null, datum), q.quell_behaelter_id ? q.gebinde_rekonstruiert : false),
        ...(quellen.length > 1 ? { liter: r2(num(q.menge_liter)) } : {}),
      })),
      nach: [mitHinweis(stelle(v.ziel_weinausbau_id, v.ziel_behaelter_id ?? null, datum), v.ziel_behaelter_id ? v.gebinde_rekonstruiert : false)],
      bruttoLiter: r2(summe + schwund), schwundLiter: r2(schwund), nettoLiter: r2(summe),
    }, v.created_at, 1)
  }

  return eintraege
    .filter(x => !d.bis || x.s.datum <= d.bis)
    .sort((a, b) => (a.s.datum !== b.s.datum ? (a.s.datum < b.s.datum ? -1 : 1)
      : a.erfasst !== b.erfasst ? (a.erfasst < b.erfasst ? -1 : 1)
      : a.rang !== b.rang ? a.rang - b.rang
      : a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0))
    .map(x => x.s)
}

/** „Grüner Veltliner Sandgrube (Stahltank 03)“ – eine Seite eines Schritts als Text; KAN-112: „(Stahltank 03, Gebinde rekonstruiert)“ */
export function schrittStelleText(s: SchrittStelle): string {
  return `${s.charge ?? '?'}${s.gebinde ? ` (${s.gebinde}${s.rekonstruiert ? `, ${GEBINDE_REKONSTRUIERT}` : ''})` : ''}`
}

async function liste(query: any, was: string): Promise<R[]> {
  const { data, error } = await alle<R>(query)
  if (error) throw new AktionsFehler(`Blend-Protokoll: ${was} konnte nicht geladen werden (${error.message ?? 'unbekannter Fehler'})`)
  return data
}

const UMZUG_MENGE_SELECT = `${UMZUG_GEBINDE_SELECT}, menge_liter, brutto_liter, schwund_liter`

/** Verschnitt- und Umzugsschritte in die Chargen `chargeIds` (Bewegungsgraph) bis `bis` */
export async function ladeBlendSchritte(
  supabase: any, tenantId: string, chargeIds: readonly string[], bis: string | null,
): Promise<BlendSchritt[]> {
  const ids = [...new Set(chargeIds)]
  if (ids.length === 0) return []
  const [ein, aus, vs, chargen] = await Promise.all([
    liste((supabase.from('keller_umzuege') as any).select(UMZUG_MENGE_SELECT)
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .in('nach_weinausbau_id', ids).order('id'), 'Umzüge'),
    liste((supabase.from('keller_umzuege') as any).select(UMZUG_MENGE_SELECT)
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145
      .in('von_weinausbau_id', ids).order('id'), 'Umzüge'),
    liste((supabase.from('verschneidungen') as any)
      .select('id, datum, created_at, storniert_am, ziel_weinausbau_id, ziel_behaelter_id, gebinde_rekonstruiert, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter, quell_behaelter_id, gebinde_rekonstruiert, schwund_umzug_id)')
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145
      .in('ziel_weinausbau_id', ids).order('id'), 'Verschnitte'),
    liste((supabase.from('weinausbau') as any).select('id, name, behaelter_id')
      .eq('tenant_id', tenantId).in('id', ids).order('id'), 'Chargen'),
  ])
  const umzuege = new Map<string, UmzugMenge>()
  for (const u of [...ein, ...aus]) umzuege.set(u.id, u as UmzugMenge)
  // KAN-112: Schwundbuchungen beim Verschnitt, deren Quelle außerhalb des Graphen liegt
  const schwundIds = [...new Set((vs as VerschnittMenge[]).flatMap(v => (v.quellen ?? []).map(q => q.schwund_umzug_id))
    .filter((x): x is string => !!x && !umzuege.has(x)))]
  if (schwundIds.length > 0) {
    // alle-ausnahme: Schwundbuchungen im Herkunftsgraph einer Charge, wenige
    for (const u of await liste((supabase.from('keller_umzuege') as any).select(UMZUG_MENGE_SELECT)
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145
      .in('id', schwundIds).order('id'), 'Umzüge')) umzuege.set(u.id, u as UmzugMenge)
  }
  const batchIds = [...new Set(ein.filter(u => u.umzug_batch_id).map(u => u.umzug_batch_id as string))]
  if (batchIds.length > 0) {
    // alle-ausnahme: Umzüge im Herkunftsgraph einer Charge, wenige
    const zeilen = await liste((supabase.from('keller_umzuege') as any).select(UMZUG_MENGE_SELECT)
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145
      .in('umzug_batch_id', batchIds).order('id'), 'Umzüge')
    for (const u of zeilen) umzuege.set(u.id, u as UmzugMenge)
  }

  const chargeNamen = new Map<string, string>()
  const gebindeJeCharge = new Map<string, string | null>()
  const merke = (c: R) => { if (c.name) chargeNamen.set(c.id, c.name); gebindeJeCharge.set(c.id, c.behaelter_id ?? null) }
  for (const c of chargen) merke(c)
  // Quell-Chargen außerhalb des Graphen (z. B. n:m-Quellen) – nur Name und Gebinde
  const fehlend = [...new Set([...umzuege.values()].flatMap(u => [u.von_weinausbau_id, u.nach_weinausbau_id])
    .filter((x): x is string => !!x && !gebindeJeCharge.has(x)))]
  if (fehlend.length > 0) {
    for (const c of await liste((supabase.from('weinausbau') as any).select('id, name, behaelter_id')
      .eq('tenant_id', tenantId).in('id', fehlend).order('id'), 'Chargen')) merke(c)
  }
  const umzugListe = [...umzuege.values()]
  const behaelterNamen = await ladeBehaelterNamen(supabase, tenantId, [
    ...gebindeJeCharge.values(), ...umzugListe.flatMap(u => [u.von_behaelter_id, u.nach_behaelter_id]),
    ...(vs as VerschnittMenge[]).flatMap(v => [v.ziel_behaelter_id, ...(v.quellen ?? []).map(q => q.quell_behaelter_id)]),   // KAN-112
  ])
  return blendSchritte({
    chargen: new Set(ids), umzuege: umzugListe, verschneidungen: vs as VerschnittMenge[],
    chargeNamen, gebindeJeCharge, behaelterNamen, bis,
  })
}
