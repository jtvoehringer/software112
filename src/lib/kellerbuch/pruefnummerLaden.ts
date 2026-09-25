// ── Lader zum Prüfnummern-Helfer (KAN-72, 25.09.2026) ────────────────────────
//
// Lädt je Charge, was pruefnummerGueltig() (lib/kellerbuch/pruefnummer.ts) braucht: DAC-Anträge
// (alle, auch inaktive/abgelehnte – für Hinweise und chargeHatAntrag), Buchungen mit der Charge
// als ZIEL (Verschnitt, Zukauf, Umzug aus einer anderen Charge, Pressung), Füllungen und den
// aktuellen Bestand. Zugänge, Füllungen und Bestand nur für Chargen mit mindestens einem
// Antrag – ohne Antrag gibt es nichts zu prüfen. pruefnummerFuerFuellung ist die Prüfung der
// Server Action createFuellung (Prüfnummer nie ungeprüft aus dem Formular).
//
// Isomorph ohne Server-Importe (Supabase-Client wird übergeben); Mandant: jede Abfrage auf
// eine mandantenbezogene Tabelle mit .eq('tenant_id', …), pressung_behaelter (ohne tenant_id)
// über pressungen.tenant_id. Abfragefehler werden geworfen (nie still „keine Zugänge“).

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { wienDatum, wienHeute } from '@/lib/csv'
import { AktionsFehler } from '@/lib/fehler'
import { alle } from '@/lib/supabase/alle'
import {
  freiePruefnummerPruefen, fuellungAntragPruefen, pruefnummerGueltig, pnTag,
  type PnAbfuellung, type PnAntrag, type PnChargeDaten, type PnErgebnis, type PnZugang,
} from './pruefnummer'

type R = Record<string, any>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BLOCK = 100

/** Spalten von dac_antrag für antragAusZeile */
export const PN_ANTRAG_SELECT = 'id, weinausbau_id, bezeichnung, status, aktiv, pruefnummer, menge_liter, eingereicht_am, bescheid_am, created_at'

function bloecke<T>(liste: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < liste.length; i += BLOCK) out.push(liste.slice(i, i + BLOCK))
  return out
}

function zahl(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function fehler(tabelle: string, e: R): never {
  throw new Error(`Prüfnummer: ${tabelle} konnte nicht geladen werden (${e?.message ?? 'unbekannter Fehler'})`)
}

/** DB-Zeile (dac_antrag) → PnAntrag */
export function antragAusZeile(r: R): PnAntrag {
  return {
    id: String(r.id),
    weinausbauId: r.weinausbau_id ? String(r.weinausbau_id) : null,
    status: String(r.status ?? ''),
    aktiv: r.aktiv !== false,
    pruefnummer: typeof r.pruefnummer === 'string' && r.pruefnummer.trim() ? r.pruefnummer.trim() : null,
    mengeLiter: zahl(r.menge_liter),
    eingereichtAm: pnTag(r.eingereicht_am),
    bescheidAm: pnTag(r.bescheid_am),
    angelegtAm: pnTag(r.created_at) ? (wienDatum(r.created_at) ?? pnTag(r.created_at)) : null,
    bezeichnung: typeof r.bezeichnung === 'string' ? r.bezeichnung : null,
  }
}

/**
 * Daten für pruefnummerGueltig je Charge (Schlüssel = Charge-ID; jede angefragte gültige ID
 * ist enthalten, Chargen ohne Antrag mit leeren Listen). `heute` = Tag des Bestands.
 */
export async function ladePruefnummerDaten(
  supabase: any,
  tenantId: string,
  chargeIds: readonly (string | null | undefined)[],
  opts: { heute?: string } = {},
): Promise<Map<string, PnChargeDaten>> {
  const heute = opts.heute ?? wienHeute()
  const ids = [...new Set(chargeIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))]
  const daten = new Map<string, PnChargeDaten>()
  for (const id of ids) daten.set(id, { chargeId: id, bestandLiter: null, bestandAm: null, antraege: [], zugaenge: [], abfuellungen: [] })
  if (ids.length === 0) return daten

  // 1. Anträge
  for (const block of bloecke(ids)) {
    const { data, error } = await alle<R>((supabase.from('dac_antrag') as any)
      .select(PN_ANTRAG_SELECT)
      .eq('tenant_id', tenantId)
      .in('weinausbau_id', block)
      .order('created_at', { ascending: true })
      .order('id'))
    if (error) fehler('DAC-Anträge', error)
    for (const r of data) daten.get(String(r.weinausbau_id))?.antraege.push(antragAusZeile(r))
  }
  const mitAntrag = ids.filter(id => (daten.get(id)?.antraege.length ?? 0) > 0)
  if (mitAntrag.length === 0) return daten

  const zugang = (id: unknown, z: PnZugang) => { daten.get(String(id))?.zugaenge.push(z) }

  for (const block of bloecke(mitAntrag)) {
    const [waRes, vRes, zkRes, umRes, pbRes, fRes, fcRes] = await Promise.all([
      alle<R>((supabase.from('weinausbau') as any)
        .select('id, menge_liter')
        .eq('tenant_id', tenantId)
        .in('id', block)
        .order('id')),
      alle<R>((supabase.from('verschneidungen') as any)
        .select('id, datum, ziel_weinausbau_id')
        .eq('tenant_id', tenantId)
        .in('ziel_weinausbau_id', block)
        .order('id')),
      alle<R>((supabase.from('zukauf_posten') as any)
        .select('id, datum, ziel_weinausbau_id')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .in('ziel_weinausbau_id', block)
        .order('id')),
      alle<R>((supabase.from('keller_umzuege') as any)
        .select('id, datum, von_weinausbau_id, nach_weinausbau_id, umzug_batch_id, zeilen_typ')
        .eq('tenant_id', tenantId)
        .in('nach_weinausbau_id', block)
        .order('id')),
      // pressung_behaelter hat keine tenant_id – Mandant über die Pressung
      alle<R>((supabase.from('pressung_behaelter') as any)
        .select('id, weinausbau_id, pressung:pressung_id(datum, tenant_id)')
        .in('weinausbau_id', block)
        .order('id')),
      alle<R>((supabase.from('fuellungen') as any)
        .select('id, datum, weinausbau_id, menge_liter_gefuellt, anzahl_flaschen, flaschengroesse_ml, dac_antrag_id')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .in('weinausbau_id', block)
        .order('id')),
      alle<R>((supabase.from('fuellung_chargen') as any)
        .select('fuellung_id, weinausbau_id, anteil_liter, fuellung:fuellung_id(datum, aktiv, dac_antrag_id)')
        .eq('tenant_id', tenantId)
        .in('weinausbau_id', block)
        .order('id')),
    ])
    if (waRes.error) fehler('Chargen', waRes.error)
    if (vRes.error) fehler('Verschnitte', vRes.error)
    if (zkRes.error) fehler('Zukäufe', zkRes.error)
    if (umRes.error) fehler('Umzüge', umRes.error)
    if (pbRes.error) fehler('Pressungen', pbRes.error)
    if (fRes.error) fehler('Füllungen', fRes.error)
    if (fcRes.error) fehler('Füllungs-Chargen', fcRes.error)

    for (const w of waRes.data) {
      const d = daten.get(String(w.id))
      if (d) { d.bestandLiter = zahl(w.menge_liter) ?? 0; d.bestandAm = heute }
    }
    for (const v of vRes.data) zugang(v.ziel_weinausbau_id, { art: 'verschnitt', datum: pnTag(v.datum), id: String(v.id) })
    for (const z of zkRes.data) zugang(z.ziel_weinausbau_id, { art: 'zukauf', datum: pnTag(z.datum), id: String(z.id) })
    for (const p of pbRes.data) {
      const pr = p.pressung as R | null
      if (pr && pr.tenant_id === tenantId) zugang(p.weinausbau_id, { art: 'zugang', datum: pnTag(pr.datum), id: String(p.id) })
    }

    // Umzug: Zugang, wenn Wein aus einer ANDEREN Charge in die Charge kommt. Zielzeilen tragen
    // nach_weinausbau_id, die Quellen stehen in den quelle-Zeilen desselben Batches; ältere
    // Zeilen ohne Batch tragen von_ und nach_ in einer Zeile. Unklare Herkunft zählt als Zugang.
    const umzuege = umRes.data.filter(u => u.zeilen_typ !== 'quelle')
    const batchIds = [...new Set(umzuege.filter(u => !u.von_weinausbau_id && u.umzug_batch_id).map(u => String(u.umzug_batch_id)))]
    const quellenJeBatch = new Map<string, string[]>()
    for (const b of bloecke(batchIds)) {
      const { data, error } = await alle<R>((supabase.from('keller_umzuege') as any)
        .select('id, umzug_batch_id, von_weinausbau_id')
        .eq('tenant_id', tenantId)
        .eq('zeilen_typ', 'quelle')
        .in('umzug_batch_id', b)
        .order('id'))
      if (error) fehler('Umzugsquellen', error)
      for (const q of data) {
        const liste = quellenJeBatch.get(String(q.umzug_batch_id)) ?? []
        liste.push(q.von_weinausbau_id ? String(q.von_weinausbau_id) : '')
        quellenJeBatch.set(String(q.umzug_batch_id), liste)
      }
    }
    for (const u of umzuege) {
      const ziel = String(u.nach_weinausbau_id)
      let fremd: boolean
      if (u.von_weinausbau_id) fremd = String(u.von_weinausbau_id) !== ziel
      else {
        const quellen = u.umzug_batch_id ? (quellenJeBatch.get(String(u.umzug_batch_id)) ?? []) : []
        fremd = quellen.length === 0 || quellen.some(q => q !== ziel)
      }
      if (fremd) zugang(ziel, { art: 'zugang', datum: pnTag(u.datum), id: String(u.id) })
    }

    // Füllungen: fuellung_chargen (Anteil je Charge) hat Vorrang, ältere Füllungen nur über
    // fuellungen.weinausbau_id (wie das Weinbuch). Nur aktive – das Löschen bucht zurück.
    const jeCharge = new Map<string, Map<string, PnAbfuellung>>()
    const merken = (charge: unknown, fid: unknown, f: PnAbfuellung) => {
      const m = jeCharge.get(String(charge)) ?? new Map<string, PnAbfuellung>()
      m.set(String(fid), f)
      jeCharge.set(String(charge), m)
    }
    for (const f of fRes.data) {
      const liter = zahl(f.menge_liter_gefuellt)
        ?? ((zahl(f.anzahl_flaschen) ?? 0) * (zahl(f.flaschengroesse_ml) ?? 0)) / 1000
      merken(f.weinausbau_id, f.id, { id: String(f.id), datum: pnTag(f.datum), liter, dacAntragId: f.dac_antrag_id ? String(f.dac_antrag_id) : null })
    }
    for (const fc of fcRes.data) {
      const f = fc.fuellung as R | null
      if (!f || f.aktiv === false) continue
      merken(fc.weinausbau_id, fc.fuellung_id, { id: String(fc.fuellung_id), datum: pnTag(f.datum), liter: zahl(fc.anteil_liter) ?? 0, dacAntragId: f.dac_antrag_id ? String(f.dac_antrag_id) : null })
    }
    for (const [charge, m] of jeCharge) daten.get(charge)?.abfuellungen.push(...m.values())
  }
  return daten
}

/** Ergebnis von pruefnummerGueltig je Charge am Stichtag (Standard: heute) */
export async function ladePruefnummerStatus(
  supabase: any,
  tenantId: string,
  chargeIds: readonly (string | null | undefined)[],
  stichtag?: string,
): Promise<Map<string, PnErgebnis>> {
  const heute = wienHeute()
  const daten = await ladePruefnummerDaten(supabase, tenantId, chargeIds, { heute })
  const out = new Map<string, PnErgebnis>()
  for (const [id, d] of daten) out.set(id, pruefnummerGueltig(d, stichtag ?? heute))
  return out
}

/** Alle DAC-Anträge des Betriebs mit Nummer (Prüfung freier Eingaben, freiePruefnummerPruefen) */
export async function ladeAntraegeMitNummer(supabase: any, tenantId: string): Promise<PnAntrag[]> {
  const { data, error } = await alle<R>((supabase.from('dac_antrag') as any)
    .select(PN_ANTRAG_SELECT)
    .eq('tenant_id', tenantId)
    .not('pruefnummer', 'is', null)
    .order('id'))
  if (error) fehler('DAC-Anträge', error)
  return data.map(antragAusZeile).filter(a => a.pruefnummer !== null)
}

/**
 * Prüfnummer und DAC-Antrag einer neuen Füllung (Server Action createFuellung) – nie
 * ungeprüft aus dem Formular. Wirft AktionsFehler (Meldung kommt beim Client an), bevor
 * irgendetwas gespeichert ist.
 *   * Mit dac_antrag_id: der Antrag muss im aktiven Betrieb zur gewählten Charge gehören
 *     (fremder oder nicht passender Antrag → Fehler); die Nummer kommt aus dem Antrag und
 *     nur, wenn sie am Abfülldatum für die Charge gilt (fuellungAntragPruefen – dieselbe
 *     Regel wie das Angebot im Formular). Ein offener Antrag wird ohne Nummer verknüpft.
 *   * Ohne Antrag: freie Eingabe bleibt für Füllungen ohne Charge (Altbestand) und Chargen
 *     ohne DAC-Antrag (z. B. Zukauf mit Prüfnummer des Lieferanten) – nicht für Chargen mit
 *     Antrag und nie mit der Nummer eines Antrags einer anderen Charge (freiePruefnummerPruefen).
 */
export async function pruefnummerFuerFuellung(
  supabase: any,
  tenantId: string,
  eingabe: { dacAntragId: string | null; pruefnummer: string | null },
  p: { weinausbauId: string | null; chargeName: string | null; abfuelldatum: string },
): Promise<{ pruefnummer: string | null; dacAntragId: string | null }> {
  const dacAntragId = eingabe.dacAntragId?.trim() || null
  const freieNummer = eingabe.pruefnummer?.trim() || null
  const mitFehlertext = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f() } catch (e) {
      if (e instanceof AktionsFehler) throw e
      throw new AktionsFehler(e instanceof Error ? e.message : 'Die Prüfnummer konnte nicht geprüft werden.')
    }
  }
  const chargeDaten = () => mitFehlertext(async () => (p.weinausbauId
    ? (await ladePruefnummerDaten(supabase, tenantId, [p.weinausbauId])).get(p.weinausbauId) ?? null
    : null))

  if (dacAntragId) {
    if (!UUID_RE.test(dacAntragId)) throw new AktionsFehler('Der gewählte DAC-Antrag ist ungültig – bitte die Seite neu laden.')
    if (!p.weinausbauId) {
      throw new AktionsFehler('Ein DAC-Antrag kann nur zusammen mit seiner Kellerbuch-Charge verknüpft werden – bitte die Charge wählen.')
    }
    const r = fuellungAntragPruefen(await chargeDaten(), dacAntragId, p.abfuelldatum)
    if (!r.ok) throw new AktionsFehler(r.fehler)
    return { pruefnummer: r.pruefnummer, dacAntragId }
  }

  if (!freieNummer) return { pruefnummer: null, dacAntragId: null }
  const antraegeMitNummer = await mitFehlertext(() => ladeAntraegeMitNummer(supabase, tenantId))
  const fehlerText = freiePruefnummerPruefen(freieNummer, {
    chargeId: p.weinausbauId, chargeName: p.chargeName, charge: await chargeDaten(), antraegeMitNummer,
  })
  if (fehlerText) throw new AktionsFehler(fehlerText)
  return { pruefnummer: freieNummer, dacAntragId: null }
}
