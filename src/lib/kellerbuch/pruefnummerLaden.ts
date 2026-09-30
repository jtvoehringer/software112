// ── Lader zum Prüfnummern-Helfer (KAN-72, 25.09.2026) ────────────────────────
//
// Lädt je Charge, was pruefnummerGueltig() (lib/kellerbuch/pruefnummer.ts) braucht: DAC-Anträge
// (alle, auch inaktive/abgelehnte – für Hinweise und chargeHatAntrag), Buchungen mit der Charge
// als ZIEL (Verschnitt, Zukauf, Umzug aus einer anderen Charge, Pressung), Füllungen, Tankverkäufe
// und den aktuellen Bestand. Zugänge, Füllungen, Verkäufe und Bestand nur für Chargen mit
// mindestens einem Antrag – ohne Antrag gibt es nichts zu prüfen. pruefnummerFuerFuellung ist
// die Prüfung der Server Action createFuellung (Prüfnummer nie ungeprüft aus dem Formular),
// pruefnummerBeiChargenzuordnung und pruefnummerBeiDatumsaenderung die von updateFuellung
// (Charge nachträglich zugeordnet bzw. Abfülldatum geändert); ladeUmzugsherkunft verfolgt eine
// Charge ohne Antrag über Umzüge zur Antrags-Charge zurück.
//
// Isomorph ohne Server-Importe (Supabase-Client wird übergeben); Mandant: jede Abfrage auf
// eine mandantenbezogene Tabelle mit .eq('tenant_id', …), pressung_behaelter (ohne tenant_id)
// über pressungen.tenant_id. Abfragefehler werden geworfen (nie still „keine Zugänge“).

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { wienDatum, wienHeute } from '@/lib/csv'
import { AktionsFehler } from '@/lib/fehler'
import { alle } from '@/lib/supabase/alle'
import {
  antragGenehmigt, chargeHatAntrag, freiePruefnummerPruefen, fuellungAntragPruefen, fuellungDatumText, fuellungDatumVerletzung,
  pnDatumDe, pnNormiert, pruefnummerAusAntrag, pruefnummerGueltig, pnTag,
  type PnAbfuellung, type PnAntrag, type PnChargeDaten, type PnErgebnis, type PnUmzugAbgang, type PnUmzugsherkunft, type PnZugang,
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

/**
 * Quellen je Umzugs-Batch für Zielzeilen ohne von_weinausbau_id (neues Format: Quellen in den
 * quelle-Zeilen desselben Batches). Eine Quelle ohne Charge steht als '' in der Liste.
 */
async function umzugsquellenJeBatch(supabase: any, tenantId: string, zielzeilen: readonly R[]): Promise<Map<string, string[]>> {
  const batchIds = [...new Set(zielzeilen.filter(u => !u.von_weinausbau_id && u.umzug_batch_id).map(u => String(u.umzug_batch_id)))]
  const quellenJeBatch = new Map<string, string[]>()
  for (const b of bloecke(batchIds)) {
    const { data, error } = await alle<R>((supabase.from('keller_umzuege') as any)
      .select('id, umzug_batch_id, von_weinausbau_id')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
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
  return quellenJeBatch
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
  for (const id of ids) daten.set(id, { chargeId: id, bestandLiter: null, bestandAm: null, antraege: [], zugaenge: [], abfuellungen: [], tankverkaeufe: [] })
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
    const [waRes, vRes, zkRes, umRes, pbRes, fRes, fcRes, tvRes] = await Promise.all([
      alle<R>((supabase.from('weinausbau') as any)
        .select('id, menge_liter')
        .eq('tenant_id', tenantId)
        .in('id', block)
        .order('id')),
      alle<R>((supabase.from('verschneidungen') as any)
        .select('id, datum, ziel_weinausbau_id')
        .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
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
        .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
        .eq('tenant_id', tenantId)
        .in('nach_weinausbau_id', block)
        .order('id')),
      // pressung_behaelter hat keine tenant_id – Mandant über die Pressung
      alle<R>((supabase.from('pressung_behaelter') as any)
        .select('id, weinausbau_id, pressung:pressung_id(datum, tenant_id, storniert_am)')
        .in('weinausbau_id', block)
        .is('storniert_am', null)
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
      alle<R>((supabase.from('verkauf_positionen') as any)
        .select('id, menge, weinausbau_id, verkaufsposten:verkaufsposten_id(datum, storniert)')
        .eq('tenant_id', tenantId)
        .eq('typ', 'tank')
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
    if (tvRes.error) fehler('Tankverkäufe', tvRes.error)

    for (const w of waRes.data) {
      const d = daten.get(String(w.id))
      if (d) { d.bestandLiter = zahl(w.menge_liter) ?? 0; d.bestandAm = heute }
    }
    for (const v of vRes.data) zugang(v.ziel_weinausbau_id, { art: 'verschnitt', datum: pnTag(v.datum), id: String(v.id) })
    for (const z of zkRes.data) zugang(z.ziel_weinausbau_id, { art: 'zukauf', datum: pnTag(z.datum), id: String(z.id) })
    for (const p of pbRes.data) {
      const pr = p.pressung as R | null
      if (pr && pr.tenant_id === tenantId) zugang(p.weinausbau_id, { art: 'pressung', datum: pnTag(pr.datum), id: String(p.id) })
    }

    // Umzug: Zugang, wenn Wein aus einer ANDEREN Charge in die Charge kommt. Zielzeilen tragen
    // nach_weinausbau_id, die Quellen stehen in den quelle-Zeilen desselben Batches; ältere
    // Zeilen ohne Batch tragen von_ und nach_ in einer Zeile. Unklare Herkunft zählt als Zugang.
    const umzuege = umRes.data.filter(u => u.zeilen_typ !== 'quelle')
    const quellenJeBatch = await umzugsquellenJeBatch(supabase, tenantId, umzuege)
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

    // Tankverkäufe: der Storno bucht die Liter zurück – stornierte Posten zählen nicht
    for (const v of tvRes.data) {
      const vp = v.verkaufsposten as R | null
      if (vp?.storniert === true) continue
      daten.get(String(v.weinausbau_id))?.tankverkaeufe?.push({ datum: pnTag(vp?.datum), liter: zahl(v.menge) ?? 0 })
    }
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

// ── Herkunft über Umzüge ─────────────────────────────────────────────────────

type Umzugsquelle = { chargeId: string; ersterUmzug: string; letzterUmzug: string }

/**
 * Einzige Herkunft der Charge über Umzüge – null, wenn sie eigenen Wein hat (Eröffnungs- oder
 * Anfangsbestand, Pressung, Verschnitt, Zukauf), aus mehreren Chargen befüllt wurde oder eine
 * Umzugszeile ohne Quelle bzw. Datum hat. Umzüge innerhalb der Charge (anderes Gebinde) zählen
 * nicht als Herkunft. `bis` (Zwischenglied einer Kette): nur Umzüge bis zum letzten Umzug ins
 * nächste Glied – was danach kam, ist nicht im Wein der Charge, um die es geht.
 */
async function einzigeUmzugsquelle(supabase: any, tenantId: string, chargeId: string, bis: string | null = null): Promise<Umzugsquelle | null> {
  const [waRes, vRes, zkRes, pbRes, umRes] = await Promise.all([
    (supabase.from('weinausbau') as any)
      .select('id, anfangsbestand_liter, ist_eroeffnungsbestand')
      .eq('tenant_id', tenantId)
      .eq('id', chargeId)
      .maybeSingle(),
    (supabase.from('verschneidungen') as any)
      .select('id')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('tenant_id', tenantId)
      .eq('ziel_weinausbau_id', chargeId)
      .limit(1),
    (supabase.from('zukauf_posten') as any)
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .eq('ziel_weinausbau_id', chargeId)
      .limit(1),
    // pressung_behaelter hat keine tenant_id – Mandant über die Pressung
    alle<R>((supabase.from('pressung_behaelter') as any)
      .select('id, pressung:pressung_id(tenant_id, storniert_am)')
      .eq('weinausbau_id', chargeId)
      .is('storniert_am', null)
      .order('id')),
    alle<R>((supabase.from('keller_umzuege') as any)
      .select('id, datum, von_weinausbau_id, nach_weinausbau_id, umzug_batch_id, zeilen_typ')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('tenant_id', tenantId)
      .eq('nach_weinausbau_id', chargeId)
      .order('id')),
  ])
  if (waRes.error) fehler('Charge', waRes.error)
  if (vRes.error) fehler('Verschnitte', vRes.error)
  if (zkRes.error) fehler('Zukäufe', zkRes.error)
  if (pbRes.error) fehler('Pressungen', pbRes.error)
  if (umRes.error) fehler('Umzüge', umRes.error)

  const wa = waRes.data as R | null
  if (!wa || wa.ist_eroeffnungsbestand === true || (zahl(wa.anfangsbestand_liter) ?? 0) > 0) return null
  if (((vRes.data ?? []) as R[]).length > 0 || ((zkRes.data ?? []) as R[]).length > 0) return null
  if (pbRes.data.some(p => (p.pressung as R | null)?.tenant_id === tenantId)) return null

  const umzuege = umRes.data.filter(u => u.zeilen_typ !== 'quelle')
  if (umzuege.length === 0) return null
  const quellenJeBatch = await umzugsquellenJeBatch(supabase, tenantId, umzuege)
  const quellen = new Set<string>()
  let erster = ''
  let letzter = ''
  for (const u of umzuege) {
    const d = pnTag(u.datum)
    if (d === null) return null
    if (bis !== null && d > bis) continue                  // erst nach dem Umzug ins nächste Glied
    const q = u.von_weinausbau_id ? [String(u.von_weinausbau_id)] : (u.umzug_batch_id ? quellenJeBatch.get(String(u.umzug_batch_id)) ?? [] : [])
    if (q.length === 0 || q.some(x => !x)) return null
    const fremd = q.filter(x => x !== chargeId)
    if (fremd.length === 0) continue                       // Umzug innerhalb der Charge
    for (const x of fremd) quellen.add(x)
    if (!erster || d < erster) erster = d
    if (d > letzter) letzter = d
  }
  if (quellen.size !== 1 || !letzter) return null
  return { chargeId: [...quellen][0], ersterUmzug: erster, letzterUmzug: letzter }
}

/**
 * Umzüge aus der Charge in andere Chargen (Mengenregel der Umzugsherkunft): quelle-Zeilen je
 * Batch, abzüglich eines Anteils zurück in dieselbe Charge; ältere Zeilen mit von_ und nach_.
 * Ohne Ziel-Charge (Schwund) kein Umzug. Liter brutto = um so viel sank der Bestand.
 */
async function umzuegeAusCharge(supabase: any, tenantId: string, chargeId: string): Promise<PnUmzugAbgang[]> {
  const { data, error } = await alle<R>((supabase.from('keller_umzuege') as any)
    .select('id, datum, menge_liter, von_weinausbau_id, nach_weinausbau_id, umzug_batch_id, zeilen_typ')
    .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
    .eq('tenant_id', tenantId)
    .eq('von_weinausbau_id', chargeId)
    .order('id'))
  if (error) fehler('Umzüge aus der Charge', error)
  const out: PnUmzugAbgang[] = []
  const jeBatch = new Map<string, PnUmzugAbgang>()
  for (const u of data) {
    const liter = zahl(u.menge_liter) ?? 0
    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id) {
      const b = String(u.umzug_batch_id)
      const bisher = jeBatch.get(b)
      jeBatch.set(b, { datum: bisher?.datum ?? pnTag(u.datum), liter: (bisher?.liter ?? 0) + liter })
    } else if (u.zeilen_typ === 'quelle' || (u.nach_weinausbau_id && String(u.nach_weinausbau_id) !== chargeId)) {
      out.push({ datum: pnTag(u.datum), liter })           // Ziel unbekannt bzw. andere Charge
    }
  }
  const zurueck = new Map<string, number>()
  for (const b of bloecke([...jeBatch.keys()])) {
    const { data: ziele, error: e } = await alle<R>((supabase.from('keller_umzuege') as any)
      .select('id, umzug_batch_id, nach_weinausbau_id, menge_liter')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('tenant_id', tenantId)
      .eq('zeilen_typ', 'ziel')
      .in('umzug_batch_id', b)
      .order('id'))
    if (e) fehler('Umzugsziele', e)
    for (const z of ziele) {
      if (String(z.nach_weinausbau_id) === chargeId) zurueck.set(String(z.umzug_batch_id), (zurueck.get(String(z.umzug_batch_id)) ?? 0) + (zahl(z.menge_liter) ?? 0))
    }
  }
  for (const [b, u] of jeBatch) {
    const netto = u.liter - (zurueck.get(b) ?? 0)
    if (netto > 0.005) out.push({ datum: u.datum, liter: netto })
  }
  return out
}

/**
 * Stammt eine Charge ohne eigenen DAC-Antrag ausschließlich über Umzüge (Abstich, Filtration
 * in ein anderes Gebinde – jeder Umzug in ein leeres Gebinde legt eine neue Charge an) aus
 * einer Charge mit Antrag? Folgt der Kette bis `maxTiefe` Umzüge zurück; jedes Glied darf nur
 * Wein aus genau einer Charge bekommen haben (kein Verschnitt, Zukauf, Pressung, Eröffnungs-
 * bestand). `ersterUmzugAm`/`umzugAm` sind der erste und letzte Umzug aus der Antrags-Charge in
 * die Kette – in einem Zwischenglied nur Umzüge bis zum letzten Umzug ins nächste Glied. An
 * beiden Tagen muss die Nummer gegolten haben, `umzuegeAus` (alle Umzüge aus der Antrags-Charge)
 * dient mit den Tankverkäufen in `daten` der Mengenregel (freiePruefnummerPruefen). Bis KAN-99
 * der einzige Weg, die Nummer nach einem Umzug auf eine Füllung zu bringen.
 */
export async function ladeUmzugsherkunft(
  supabase: any,
  tenantId: string,
  chargeId: string,
  opts: { heute?: string; maxTiefe?: number } = {},
): Promise<PnUmzugsherkunft | null> {
  if (!UUID_RE.test(chargeId)) return null
  const gesehen = new Set<string>([chargeId])
  let aktuell = chargeId
  let bis: string | null = null
  for (let tiefe = 0; tiefe < (opts.maxTiefe ?? 5); tiefe++) {
    const quelle = await einzigeUmzugsquelle(supabase, tenantId, aktuell, bis)
    if (!quelle || gesehen.has(quelle.chargeId) || !UUID_RE.test(quelle.chargeId)) return null
    gesehen.add(quelle.chargeId)
    const daten = (await ladePruefnummerDaten(supabase, tenantId, [quelle.chargeId], { heute: opts.heute })).get(quelle.chargeId)
    if (daten && daten.antraege.length > 0) {
      const [{ data, error }, umzuegeAus] = await Promise.all([
        (supabase.from('weinausbau') as any)
          .select('id, name')
          .eq('tenant_id', tenantId)
          .eq('id', quelle.chargeId)
          .maybeSingle(),
        umzuegeAusCharge(supabase, tenantId, quelle.chargeId),
      ])
      if (error) fehler('Charge', error)
      return {
        daten, name: typeof (data as R | null)?.name === 'string' ? (data as R).name : null,
        umzugAm: quelle.letzterUmzug, ersterUmzugAm: quelle.ersterUmzug, umzuegeAus,
      }
    }
    bis = quelle.letzterUmzug
    aktuell = quelle.chargeId
  }
  return null
}

// ── Server-Prüfungen der Füllung ─────────────────────────────────────────────

const mitFehlertext = async <T>(f: () => Promise<T>): Promise<T> => {
  try { return await f() } catch (e) {
    if (e instanceof AktionsFehler) throw e
    throw new AktionsFehler(e instanceof Error ? e.message : 'Die Prüfnummer konnte nicht geprüft werden.')
  }
}

/** Freie Nummer prüfen; die Umzugsherkunft nur laden, wenn die Nummer zum Antrag einer anderen Charge gehört */
async function freieNummerFehler(
  supabase: any,
  tenantId: string,
  nummer: string,
  p: { weinausbauId: string | null; chargeName: string | null; charge: PnChargeDaten | null; antraegeMitNummer: PnAntrag[]; heute?: string; nachtraeglich?: boolean },
): Promise<string | null> {
  const n = pnNormiert(nummer)
  const brauchtHerkunft = !!p.weinausbauId && !chargeHatAntrag(p.charge)
    && p.antraegeMitNummer.some(a => pnNormiert(a.pruefnummer) === n && a.weinausbauId !== p.weinausbauId)
  const herkunft = brauchtHerkunft
    ? await mitFehlertext(() => ladeUmzugsherkunft(supabase, tenantId, p.weinausbauId as string, { heute: p.heute }))
    : null
  return freiePruefnummerPruefen(nummer, {
    chargeId: p.weinausbauId, chargeName: p.chargeName, charge: p.charge, antraegeMitNummer: p.antraegeMitNummer, herkunft,
    nachtraeglich: p.nachtraeglich,
  })
}

/**
 * Prüfnummer und DAC-Antrag einer neuen Füllung (Server Action createFuellung) – nie
 * ungeprüft aus dem Formular. Wirft AktionsFehler (Meldung kommt beim Client an), bevor
 * irgendetwas gespeichert ist.
 *   * Mit dac_antrag_id: der Antrag muss im aktiven Betrieb zur gewählten Charge gehören
 *     (fremder oder nicht passender Antrag → Fehler); die Nummer kommt aus dem Antrag und
 *     nur, wenn sie für den Bestand gilt, von dem die Füllung abgebucht wird
 *     (fuellungAntragPruefen – dieselbe Regel wie das Angebot im Formular; ein rückdatiertes
 *     Abfülldatum umgeht sie nicht). Ein offener Antrag wird ohne Nummer verknüpft.
 *   * Ohne Antrag: ist die Nummer die eines genehmigten Antrags der Charge (Bot-Tool ohne
 *     Antragsauswahl, veralteter Tab), gilt dieselbe Prüfung wie über die Auswahl und der Antrag
 *     wird verknüpft. Sonst bleibt die freie Eingabe für Füllungen ohne Charge (Altbestand),
 *     Chargen ohne DAC-Antrag (z. B. Zukauf mit Prüfnummer des Lieferanten) und Umzugs-Chargen
 *     (Nummer der Antrags-Charge, wenn sie beim Umzug galt) – nicht für Chargen mit Antrag und
 *     nie mit der Nummer eines anderen Antrags des Betriebs (freiePruefnummerPruefen).
 * `heute` nur für Tests (Tag des Bestands, Standard wienHeute()).
 */
export async function pruefnummerFuerFuellung(
  supabase: any,
  tenantId: string,
  eingabe: { dacAntragId: string | null; pruefnummer: string | null },
  p: { weinausbauId: string | null; chargeName: string | null; abfuelldatum: string; heute?: string },
): Promise<{ pruefnummer: string | null; dacAntragId: string | null }> {
  const dacAntragId = eingabe.dacAntragId?.trim() || null
  const freieNummer = eingabe.pruefnummer?.trim() || null
  const chargeDaten = () => mitFehlertext(async () => (p.weinausbauId
    ? (await ladePruefnummerDaten(supabase, tenantId, [p.weinausbauId], { heute: p.heute })).get(p.weinausbauId) ?? null
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
  const charge = await chargeDaten()
  // Nummer des genehmigten Antrags der Charge frei eingegeben: dieselbe Prüfung wie die Auswahl
  const n = pnNormiert(freieNummer)
  const passend = charge?.antraege.find(a => a.weinausbauId === charge.chargeId && antragGenehmigt(a) && pnNormiert(a.pruefnummer) === n)
  if (charge && passend) {
    const r = fuellungAntragPruefen(charge, passend.id, p.abfuelldatum)
    if (!r.ok) throw new AktionsFehler(r.fehler)
    return { pruefnummer: r.pruefnummer, dacAntragId: passend.id }
  }
  const antraegeMitNummer = await mitFehlertext(() => ladeAntraegeMitNummer(supabase, tenantId))
  const fehlerText = await freieNummerFehler(supabase, tenantId, freieNummer, {
    weinausbauId: p.weinausbauId, chargeName: p.chargeName, charge, antraegeMitNummer, heute: p.heute,
  })
  if (fehlerText) throw new AktionsFehler(fehlerText)
  return { pruefnummer: freieNummer, dacAntragId: null }
}

/**
 * updateFuellung: Wird einer Füllung mit Prüfnummer oder DAC-Antrag nachträglich eine (andere)
 * Charge zugeordnet, müssen Nummer bzw. Antrag zu ihr passen – sonst umginge die Bearbeitung
 * die Prüfung von createFuellung (Füllung ohne Charge mit freier Nummer anlegen, danach die
 * Charge mit Antrag wählen). Nummer und Antrag selbst ändert die Bearbeitung nicht, abgebucht
 * wird nichts – maßgeblich ist deshalb das Abfülldatum (`datum`), nicht der heutige Bestand.
 *   * DAC-Antrag: muss zur neuen Charge gehören, das Abfülldatum gegen seinen Beginn halten
 *     (fuellungDatumVerletzung).
 *   * Nummer ohne Antrag: die eines genehmigten, aktiven Antrags der neuen Charge, wenn das
 *     Abfülldatum gegen dessen Beginn hält – oder eine freie Nummer, die zu keinem Antrag des
 *     Betriebs gehört (auch bei einer Charge mit Antrag: Füllung aus einem früheren, nicht
 *     erfassten Los) bzw. die einer Umzugs-Charge (freiePruefnummerPruefen, `nachtraeglich`).
 * Ohne `datum` entfällt die Datumsprüfung. Wirft AktionsFehler.
 */
export async function pruefnummerBeiChargenzuordnung(
  supabase: any,
  tenantId: string,
  fuellung: { pruefnummer: string | null; dacAntragId: string | null },
  p: { weinausbauId: string; chargeName: string | null; datum?: string | null; heute?: string },
): Promise<void> {
  const nummer = fuellung.pruefnummer?.trim() || null
  const dacAntragId = fuellung.dacAntragId?.trim() || null
  if (!nummer && !dacAntragId) return
  const charge = await mitFehlertext(async () => (await ladePruefnummerDaten(supabase, tenantId, [p.weinausbauId], { heute: p.heute })).get(p.weinausbauId) ?? null)
  const name = p.chargeName ? ` „${p.chargeName}“` : ''
  const datum = pnTag(p.datum)
  const datumPruefen = (antrag: PnAntrag) => {
    const v = datum && charge ? fuellungDatumVerletzung(antrag, charge.zugaenge, datum) : null
    if (v && datum) {
      throw new AktionsFehler(`Die Charge${name} kann nicht zugeordnet werden: ${fuellungDatumText(v, datum, antrag)} – die Prüfnummer bzw. der DAC-Antrag der Füllung gilt für diese Abfüllung nicht.`)
    }
  }
  if (dacAntragId) {
    const antrag = charge?.antraege.find(a => a.id === dacAntragId)
    if (!antrag) {
      throw new AktionsFehler(`Die Füllung ist mit dem DAC-Antrag einer anderen Charge verknüpft – die Charge${name} kann ihr nicht zugeordnet werden.`)
    }
    datumPruefen(antrag)
    return
  }
  if (!nummer) return
  const n = pnNormiert(nummer)
  const eigener = charge?.antraege.find(a => { const nr = pruefnummerAusAntrag(a, p.weinausbauId); return nr !== null && pnNormiert(nr) === n })
  if (eigener) { datumPruefen(eigener); return }
  const antraegeMitNummer = await mitFehlertext(() => ladeAntraegeMitNummer(supabase, tenantId))
  const fehlerText = await freieNummerFehler(supabase, tenantId, nummer, {
    weinausbauId: p.weinausbauId, chargeName: p.chargeName, charge, antraegeMitNummer, heute: p.heute, nachtraeglich: true,
  })
  if (fehlerText) throw new AktionsFehler(`Die Charge${name} kann nicht zugeordnet werden: ${fehlerText}`)
}

/**
 * updateFuellung: geändertes Abfülldatum einer Füllung mit DAC-Antrag oder mit der Nummer eines
 * genehmigten Antrags ihrer Charge – das neue Datum muss gegen den Beginn des Antrags halten
 * (fuellungDatumVerletzung: kein Zugang zwischen Abfüllung und Beginn), sonst trüge die Füllung
 * eine Nummer, die createFuellung mit diesem Datum abgelehnt hätte. Freie Nummern (Lieferant,
 * Umzugs-Charge, ohne Charge) hängen nicht vom Abfülldatum ab. Wirft AktionsFehler.
 */
export async function pruefnummerBeiDatumsaenderung(
  supabase: any,
  tenantId: string,
  fuellung: { pruefnummer: string | null; dacAntragId: string | null; weinausbauId: string | null },
  p: { datum: string; heute?: string },
): Promise<void> {
  const nummer = fuellung.pruefnummer?.trim() || null
  const dacAntragId = fuellung.dacAntragId?.trim() || null
  const datum = pnTag(p.datum)
  if (!datum || (!nummer && !dacAntragId)) return
  await mitFehlertext(async () => {
    let antrag: PnAntrag | null = null
    let chargeId = fuellung.weinausbauId
    if (dacAntragId) {
      const { data, error } = await (supabase.from('dac_antrag') as any)
        .select(PN_ANTRAG_SELECT)
        .eq('tenant_id', tenantId)
        .eq('id', dacAntragId)
        .maybeSingle()
      if (error) fehler('DAC-Antrag', error)
      antrag = data ? antragAusZeile(data as R) : null
      chargeId = chargeId ?? antrag?.weinausbauId ?? null
    }
    if (!chargeId || (!antrag && !nummer)) return
    const charge = (await ladePruefnummerDaten(supabase, tenantId, [chargeId], { heute: p.heute })).get(chargeId) ?? null
    if (!charge) return
    if (!antrag && nummer) {
      const n = pnNormiert(nummer)
      antrag = charge.antraege.find(a => { const nr = pruefnummerAusAntrag(a, chargeId); return nr !== null && pnNormiert(nr) === n }) ?? null
    }
    const v = antrag ? fuellungDatumVerletzung(antrag, charge.zugaenge, datum) : null
    if (v && antrag) {
      throw new AktionsFehler(`Das Abfülldatum kann nicht auf den ${pnDatumDe(datum)} geändert werden: ${fuellungDatumText(v, datum, antrag)} – die Prüfnummer bzw. der DAC-Antrag der Füllung gälte dann nicht. Ist das Datum falsch erfasst, bitte die Füllung löschen (nur ohne Verkäufe und Bestandsbuchungen möglich) und neu anlegen.`)
    }
  })
}
