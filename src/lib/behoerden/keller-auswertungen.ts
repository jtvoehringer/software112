// ── Keller-Auswertungen (/reports/keller) – Seite UND CSV (24.09.2026) ─────────
//
// Bisher: nur das laufende Kalenderjahr, Umzüge mit .limit(100), CSV mit Komma über
// lib/utils/csv.ts. Jetzt: frei wählbarer Zeitraum (von–bis), alle Zeilen (alle()), alle
// CSVs über den Baustein lib/csv.
//   Umzüge, Filtrationen, Schwund  → Meldung „keller-auswertungen“ (Route /meldungen/…/csv)
//   Kellerbehandlungen             → Meldung „keller-behandlungen-alle“ (alle Gebinde, Zeitraum)
//   Behälter-Auslastung, Chargen   → Listen-CSV im Browser (SPALTEN_KELLER_BEHAELTER/_CHARGEN)
// Seite und CSV nutzen dieselben Ladefunktionen (ladeKellerUmzuege, ladeKellerBehandlungen).
// Isomorph (keine Server-Importe) – die Spalten nutzt auch KellerAuswertungenClient.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { ladeBehaelter, type BehaelterZeile } from '@/lib/keller/behaelter'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { ladeKellerBehandlungen, behandlungenJeTyp, type KellerBehandlungZeile } from './keller-behandlungen'
import { istTag, num, tag, text, type R, type Zeitraum } from './kellerbuch-hilfen'

/**
 * Zeitraum der Seite /reports/keller aus ?von=&bis= (KAN-177, 01.10.2026).
 * Ohne ?von (erster Aufruf): 1.1. des laufenden Jahres bis offen; ?von= (leer) = ohne Untergrenze.
 * Bisher fiel ein ungültiges Datum stillschweigend weg und ein „bis“ vor „von“ wurde verworfen –
 * dann zeigte die Seite mehr als gewählt („gesamter Zeitraum“). Jetzt: vertauschte Grenzen werden
 * getauscht, ein ungültiges Datum wird gemeldet.
 */
export function kellerZeitraum(
  sp: { von?: string | string[]; bis?: string | string[] },
  heute: string,
): { zeitraum: Zeitraum; hinweise: string[] } {
  const hinweise: string[] = []
  const wert = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim()
  const grenze = (roh: string | undefined, name: string): string | null => {
    if (!roh) return null
    if (istTag(roh)) return roh
    hinweise.push(`„${name}“ ist kein gültiges Datum (${roh}) und wurde nicht berücksichtigt.`)
    return null
  }
  const vonRoh = wert(sp.von)
  let von = vonRoh === undefined ? `${heute.slice(0, 4)}-01-01` : grenze(vonRoh, 'Von')
  let bis = grenze(wert(sp.bis), 'Bis')
  if (von && bis && bis < von) {
    ;[von, bis] = [bis, von]
    hinweise.push('„Bis“ lag vor „Von“ – die beiden Grenzen wurden getauscht.')
  }
  return { zeitraum: { von, bis }, hinweise }
}

/** umzug_typ → Bezeichnung. 'normal' ist der Standardwert beim Umziehen (umziehen/actions.ts). */
export const UMZUG_TYP_LABEL: Record<string, string> = {
  normal: 'Umzug', umzug: 'Umzug', transfer: 'Umzug', filtration: 'Filtration', schwund: 'Schwund',
}

export const CHARGEN_STATUS_LABEL: Record<string, string> = {
  ernte: 'Ernte', gaerung: 'Gärung', ausbau: 'Ausbau', abfuellung: 'Abfüllung', abgeschlossen: 'Abgeschlossen',
}

export type KellerUmzugZeile = {
  id: string
  datum: string
  typ: string
  art: string
  vonGebinde: string | null
  charge: string | null
  nachGebinde: string | null
  brutto: number | null
  schwund: number | null
  beleg: string | null
  notizen: string | null
}

/** Umzüge, Filtrationen und Schwundbuchungen im Zeitraum (eine Zeile je Quell-Buchung, neueste zuerst) */
export async function ladeKellerUmzuege(
  supabase: any,
  tenantId: string,
  z: Zeitraum,
  opts: { gebindeListe?: BehaelterZeile[] } = {},
): Promise<{ zeilen: KellerUmzugZeile[]; warnungen: string[] }> {
  const gebindeListe = opts.gebindeListe ?? await ladeBehaelter(supabase, tenantId)
  const gebindeName = new Map(gebindeListe.map(g => [g.id, g.anzeigeName]))

  let q = (supabase.from('keller_umzuege') as any)
    .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, umzug_batch_id, transaktions_nr, notizen, von_behaelter_id, nach_behaelter_id, von_behaelter:von_behaelter_id(name), nach_behaelter:nach_behaelter_id(name), von_weinausbau:von_weinausbau_id(name)')
    .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
    .eq('tenant_id', tenantId)
    .not('zeilen_typ', 'eq', 'ziel')
  if (z.von) q = q.gte('datum', z.von)
  if (z.bis) q = q.lte('datum', z.bis)
  const { data, error } = await alle<R>(q.order('datum', { ascending: false }).order('id', { ascending: true }))
  if (error) throw new Error(`Umzüge konnten nicht geladen werden: ${error.message}`)

  // Ziel-Gebinde der n:n-Umzüge (Quell-Zeile trägt kein Ziel) über die Batch-Ziele
  const batchIds = [...new Set(data.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id as string))]
  const zieleJeBatch = new Map<string, string[]>()
  if (batchIds.length > 0) {
    // inBloecken: alle Umzüge des Zeitraums – die Batch-Liste wächst mit (URL-Grenze ≈ 350 IDs)
    const ziele = await inBloecken<R>(batchIds, b => alle<R>((supabase.from('keller_umzuege') as any)
      .select('id, umzug_batch_id, nach_behaelter_id, nach_behaelter:nach_behaelter_id(name)')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('tenant_id', tenantId)
      .in('umzug_batch_id', b)
      .eq('zeilen_typ', 'ziel')
      .order('id')))
    if (ziele.error) throw new Error(`Umzüge konnten nicht geladen werden: ${ziele.error.message}`)
    for (const zr of ziele.data) {
      const n = (zr.nach_behaelter_id ? gebindeName.get(zr.nach_behaelter_id) : null) ?? (zr.nach_behaelter as R | null)?.name ?? '?'
      const liste = zieleJeBatch.get(zr.umzug_batch_id) ?? []
      if (!liste.includes(n)) liste.push(n)
      zieleJeBatch.set(zr.umzug_batch_id, liste)
    }
  }

  const zeilen: KellerUmzugZeile[] = data.map(u => {
    const typ = (u.umzug_typ as string | null) ?? 'umzug'
    const istSchwund = typ === 'schwund'
    const von = (u.von_behaelter_id ? gebindeName.get(u.von_behaelter_id) : null) ?? text((u.von_behaelter as R | null)?.name)
    const nach = istSchwund ? null
      : (u.zeilen_typ === 'quelle' && u.umzug_batch_id ? (zieleJeBatch.get(u.umzug_batch_id)?.join(', ') ?? null) : null)
        ?? (u.nach_behaelter_id ? gebindeName.get(u.nach_behaelter_id) : null) ?? text((u.nach_behaelter as R | null)?.name)
    const brutto = num(u.brutto_liter) || num(u.menge_liter)
    const schwund = num(u.schwund_liter)
    return {
      id: u.id,
      datum: tag(u.datum),
      typ,
      art: UMZUG_TYP_LABEL[typ] ?? typ,
      vonGebinde: von,
      charge: text((u.von_weinausbau as R | null)?.name),
      nachGebinde: nach,
      brutto: brutto > 0 ? runden(brutto, STELLEN.liter) : null,
      schwund: schwund > 0 ? runden(schwund, STELLEN.liter) : null,
      beleg: text(u.transaktions_nr),
      notizen: text(u.notizen),
    }
  })
  return { zeilen, warnungen: [] }
}

export const SPALTEN_KELLER_UMZUEGE: CsvSpalte<KellerUmzugZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  { kopf: 'Von Gebinde', typ: 'text', wert: z => z.vonGebinde },
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Nach Gebinde', typ: 'text', wert: z => z.nachGebinde },
  { kopf: 'Brutto (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.brutto },
  { kopf: 'Schwund (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.schwund },
  { kopf: 'Transaktion', typ: 'code', wert: z => z.beleg },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
]

// ── Behälter und Chargen (Listen-CSV im Browser) ─────────────────────────────

export type KellerBehaelterZeile = {
  id: string
  name: string
  typ: string | null
  standort: string | null
  kapazitaet: number | null
  eigenLiter: number
  fremdLiter: number
  fremdBetrieb: string | null
  inhalt: number
  auslastung: number | null
}

export type KellerChargeZeile = {
  id: string
  name: string
  rebsorte: string | null
  kuerzel: string | null
  jahrgang: number | null
  status: string | null
  statusLabel: string | null
  behaelterId: string | null
  behaelter: string | null
  liter: number
}

export type KellerAuswertungen = {
  zeitraum: Zeitraum
  behaelter: KellerBehaelterZeile[]
  chargen: KellerChargeZeile[]
  behandlungen: KellerBehandlungZeile[]
  behandlungTypen: [string, number][]
  umzuege: KellerUmzugZeile[]
  gesamtLiter: number
  gesamtKapazitaet: number
  gesamtAuslastung: number
  schwundGesamt: number
  abgefuelltLiter: number
  warnungen: string[]
}

/** Alles für /reports/keller: Bestand heute (Behälter, Chargen) und Bewegungen im Zeitraum */
export async function ladeKellerAuswertungen(supabase: any, tenantId: string, z: Zeitraum): Promise<KellerAuswertungen> {
  const gebindeAlle = await ladeBehaelter(supabase, tenantId)
  let fq = (supabase.from('fuellungen') as any)
    .select('id, datum, menge_liter_gefuellt')
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)   // KAN-145: stornierte bzw. gelöschte (aktiv = false) Füllungen zählen nicht
  if (z.von) fq = fq.gte('datum', z.von)
  if (z.bis) fq = fq.lte('datum', z.bis)
  const [chargenRes, behandlungen, umzuege, fuellungenRes] = await Promise.all([
    alle<R>((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, aktiv, behaelter_id, ist_eroeffnungsbestand')
      .eq('tenant_id', tenantId)
      .order('jahrgang', { ascending: false })
      .order('id')),
    ladeKellerBehandlungen(supabase, tenantId, { von: z.von, bis: z.bis }, { gebindeListe: gebindeAlle }),
    ladeKellerUmzuege(supabase, tenantId, z, { gebindeListe: gebindeAlle }),
    alle<R>(fq.order('datum', { ascending: false }).order('id')),
  ])
  if (chargenRes.error) throw new Error(`Chargen konnten nicht geladen werden: ${chargenRes.error.message}`)
  if (fuellungenRes.error) throw new Error(`Füllungen konnten nicht geladen werden: ${fuellungenRes.error.message}`)

  const gebinde = gebindeAlle.filter(g => g.aktiv)
  const gebindeName = new Map(gebindeAlle.map(g => [g.id, g.anzeigeName]))
  const aktive = chargenRes.data.filter(c => c.aktiv && c.status !== 'abgeschlossen')

  const literJeGebinde = new Map<string, number>()
  for (const c of aktive) if (c.behaelter_id) literJeGebinde.set(c.behaelter_id, (literJeGebinde.get(c.behaelter_id) ?? 0) + num(c.menge_liter))

  const behaelter: KellerBehaelterZeile[] = gebinde.map(g => {
    const eigenLiter = runden(literJeGebinde.get(g.id) ?? 0, STELLEN.liter)
    const inhalt = runden(eigenLiter + g.fremd_liter, STELLEN.liter)
    const kap = g.volumen_liter && g.volumen_liter > 0 ? runden(g.volumen_liter, STELLEN.liter) : null
    return {
      id: g.id, name: g.anzeigeName, typ: g.typ, standort: g.standort, kapazitaet: kap,
      eigenLiter, fremdLiter: runden(g.fremd_liter, STELLEN.liter), fremdBetrieb: g.fremd_betrieb,
      inhalt, auslastung: kap ? runden(Math.min(100, (inhalt / kap) * 100), 1) : null,
    }
  })

  const chargen: KellerChargeZeile[] = aktive.filter(c => !c.ist_eroeffnungsbestand).map(c => ({
    id: c.id,
    name: c.name,
    rebsorte: text(c.rebsorte),
    kuerzel: bkiRebsorteKuerzel(text(c.rebsorte)),
    jahrgang: typeof c.jahrgang === 'number' ? c.jahrgang : null,
    status: text(c.status),
    statusLabel: c.status ? (CHARGEN_STATUS_LABEL[c.status] ?? c.status) : null,
    behaelterId: c.behaelter_id ?? null,
    behaelter: c.behaelter_id ? (gebindeName.get(c.behaelter_id) ?? null) : null,
    liter: runden(num(c.menge_liter), STELLEN.liter),
  }))

  // Summen aus den gerundeten Zeilenwerten (Ausdruck und CSV stimmen überein)
  const gesamtLiter = runden(aktive.reduce((s: number, c: R) => s + runden(num(c.menge_liter), STELLEN.liter), 0), STELLEN.liter)
  const gesamtKapazitaet = runden(behaelter.reduce((s, b) => s + (b.kapazitaet ?? 0), 0), STELLEN.liter)
  const behandlungZeilen = behandlungen?.zeilen ?? []

  return {
    zeitraum: z,
    behaelter,
    chargen,
    behandlungen: behandlungZeilen,
    behandlungTypen: behandlungenJeTyp(behandlungZeilen),
    umzuege: umzuege.zeilen,
    gesamtLiter,
    gesamtKapazitaet,
    gesamtAuslastung: gesamtKapazitaet > 0 ? Math.min(100, (gesamtLiter / gesamtKapazitaet) * 100) : 0,
    schwundGesamt: runden(umzuege.zeilen.reduce((s, u) => s + (u.schwund ?? 0), 0), STELLEN.liter),
    abgefuelltLiter: runden(fuellungenRes.data.reduce((s: number, f: R) => s + runden(num(f.menge_liter_gefuellt), STELLEN.liter), 0), STELLEN.liter),
    warnungen: [...(behandlungen?.warnungen ?? []), ...umzuege.warnungen],
  }
}

export const SPALTEN_KELLER_BEHAELTER: CsvSpalte<KellerBehaelterZeile>[] = [
  { kopf: 'Behälter', typ: 'text', wert: z => z.name },
  { kopf: 'Typ', typ: 'text', wert: z => z.typ },
  { kopf: 'Standort', typ: 'text', wert: z => z.standort },
  { kopf: 'Kapazität (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.kapazitaet },
  { kopf: 'Inhalt eigen (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.eigenLiter },
  { kopf: 'Belegt durch Partnerbetrieb (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => (z.fremdLiter > 0 ? z.fremdLiter : null) },
  { kopf: 'Partnerbetrieb', typ: 'text', wert: z => (z.fremdLiter > 0 ? z.fremdBetrieb : null) },
  { kopf: 'Inhalt gesamt (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.inhalt },
  { kopf: 'Auslastung (%)', typ: 'prozent', stellen: 1, wert: z => z.auslastung },
]

export const SPALTEN_KELLER_CHARGEN: CsvSpalte<KellerChargeZeile>[] = [
  { kopf: 'Charge', typ: 'text', wert: z => z.name },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Status', typ: 'text', wert: z => z.statusLabel },
  { kopf: 'Behälter', typ: 'text', wert: z => z.behaelter },
  { kopf: 'Menge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.liter },
]
