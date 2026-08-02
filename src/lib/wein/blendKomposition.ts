// Blend-Protokoll: löst die vollständige Herkunfts-Zusammensetzung einer Weinausbau-Charge
// (oder einer Füllung) rekursiv auf – über beliebig viele Verschneidungs-Generationen zurück
// bis zu den ursprünglichen Pressungen (Weingarten/Grundstück/Rebsorte), Zukäufen oder
// Eröffnungsbeständen. Ergebnis ist eine auf 100 % normalisierte Liste von Ursprüngen.
//
// Rückverfolgbarkeit Flasche → Weingarten, Feature 5 (siehe project_traceability_plan.md).

import type { createSupabaseServerClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
type SB = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type KompositionUrsprung = {
  key: string
  typ: 'pressung' | 'zukauf' | 'eroeffnungsbestand' | 'unbekannt'
  rebsorte: string | null
  jahrgang: number | null
  weingarten_name: string | null   // Ried
  gst_nr: string | null
  katastralgemeinde: string | null
  ernte_datum: string | null
  kmw: number | null
  zukauf_von: string | null        // Lieferant, nur bei typ='zukauf'
  anteil_pct: number                // 0–100, gerundet auf 1 Dezimalstelle
}

type RohEintrag = { key: string; liter: number; info: Omit<KompositionUrsprung, 'anteil_pct' | 'key'> }

const EPSILON = 1e-9

function mengeNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Löst die rohe (noch nicht normalisierte) Herkunfts-Zusammensetzung einer Charge rekursiv auf.
 * `besucht` bricht echte Zirkelbezüge ab (sollte in der Praxis nie vorkommen); `cache`
 * memoisiert bereits aufgelöste Chargen, damit gemeinsame Vorfahren nicht mehrfach abgefragt
 * werden. Der Zirkel-Check MUSS vor dem Cache-Zugriff erfolgen, sonst würde eine noch
 * laufende Auflösung auf sich selbst warten (Deadlock).
 */
async function resolveRoh(
  supabase: SB,
  weinausbauId: string,
  cache: Map<string, Promise<RohEintrag[]>>,
  besucht: Set<string>,
): Promise<RohEintrag[]> {
  if (besucht.has(weinausbauId)) {
    return [{
      key: `zirkel:${weinausbauId}`,
      liter: 1,
      info: {
        typ: 'unbekannt', rebsorte: null, jahrgang: null, weingarten_name: null,
        gst_nr: null, katastralgemeinde: null, ernte_datum: null, kmw: null, zukauf_von: null,
      },
    }]
  }
  if (cache.has(weinausbauId)) return cache.get(weinausbauId)!

  const naechsteBesucht = new Set(besucht)
  naechsteBesucht.add(weinausbauId)

  const promise = (async (): Promise<RohEintrag[]> => {
    const eintraege: RohEintrag[] = []

    // 1. Eigene Herkunft: Pressungen direkt in diese Charge
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pbRows } = await (supabase.from('pressung_behaelter') as any)
      .select(`
        menge_liter,
        pressung:pressung_id(
          id,
          pressung_weingaerten(
            trauben_kg, rebsorte, ernte_datum, kmw,
            weingarten:weingarten_id(name),
            grundstueck:grundstueck_id(gst_nr, katastralgemeinde)
          )
        )
      `)
      .eq('weinausbau_id', weinausbauId)

    for (const pb of ((pbRows ?? []) as R[])) {
      const p = pb.pressung as R | null
      const wgListe = ((p?.pressung_weingaerten ?? []) as R[])
      const pbLiter = mengeNum(pb.menge_liter)
      if (pbLiter <= EPSILON) continue
      if (wgListe.length === 0) {
        // Pressung ohne verknüpfte Weingärten (sehr alte Daten) – als unbekannte Pressungs-Herkunft
        eintraege.push({
          key: `pressung-unbekannt:${p?.id ?? weinausbauId}`,
          liter: pbLiter,
          info: {
            typ: 'pressung', rebsorte: null, jahrgang: null, weingarten_name: null,
            gst_nr: null, katastralgemeinde: null, ernte_datum: null, kmw: null, zukauf_von: null,
          },
        })
        continue
      }
      const totalKg = wgListe.reduce((s, wg) => s + mengeNum(wg.trauben_kg), 0)
      for (const wg of wgListe) {
        const anteilKg = totalKg > 0 ? mengeNum(wg.trauben_kg) / totalKg : 1 / wgListe.length
        const liter = pbLiter * anteilKg
        if (liter <= EPSILON) continue
        const w = wg.weingarten as R | null
        const g = wg.grundstueck as R | null
        const jahrgangAusDatum = wg.ernte_datum ? new Date(wg.ernte_datum).getFullYear() : null
        eintraege.push({
          key: `pressung:${w?.name ?? '?'}:${g?.gst_nr ?? '?'}:${wg.rebsorte ?? '?'}:${jahrgangAusDatum ?? '?'}`,
          liter,
          info: {
            typ: 'pressung', rebsorte: wg.rebsorte ?? null, jahrgang: jahrgangAusDatum,
            weingarten_name: w?.name ?? null, gst_nr: g?.gst_nr ?? null, katastralgemeinde: g?.katastralgemeinde ?? null,
            ernte_datum: wg.ernte_datum ?? null, kmw: wg.kmw != null ? mengeNum(wg.kmw) : null, zukauf_von: null,
          },
        })
      }
    }

    // 2. Eigene Herkunft: Zukäufe (Wein/Most) direkt in diese Charge
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: zkRows } = await (supabase.from('zukauf_posten') as any)
      .select(`
        menge, art, rebsorte, jahrgang, datum,
        lieferant_firma:firmen!lieferant_firma_id(name),
        lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)
      `)
      .eq('ziel_weinausbau_id', weinausbauId)
      .eq('aktiv', true)
      .in('art', ['wein', 'most'])

    for (const zk of ((zkRows ?? []) as R[])) {
      const liter = mengeNum(zk.menge)
      if (liter <= EPSILON) continue
      const firma = (zk.lieferant_firma as R | null)?.name ?? null
      const kontakt = zk.lieferant_kontakt as R | null
      const kontaktName = kontakt ? [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ') : null
      eintraege.push({
        key: `zukauf:${firma ?? kontaktName ?? '?'}:${zk.rebsorte ?? '?'}:${zk.jahrgang ?? '?'}`,
        liter,
        info: {
          typ: 'zukauf', rebsorte: zk.rebsorte ?? null, jahrgang: zk.jahrgang ?? null,
          weingarten_name: null, gst_nr: null, katastralgemeinde: null, ernte_datum: zk.datum ?? null, kmw: null,
          zukauf_von: firma ?? kontaktName ?? null,
        },
      })
    }

    // 3. Eigene Herkunft: Eröffnungsbestand (historisch, nicht weiter rückverfolgbar)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: waRow } = await (supabase.from('weinausbau') as any)
      .select('ist_eroeffnungsbestand, anfangsbestand_liter, menge_liter, rebsorte, jahrgang')
      .eq('id', weinausbauId)
      .maybeSingle()
    const wa = waRow as R | null
    if (wa?.ist_eroeffnungsbestand) {
      const liter = mengeNum(wa.anfangsbestand_liter ?? wa.menge_liter)
      if (liter > EPSILON) {
        eintraege.push({
          key: `eb:${weinausbauId}`,
          liter,
          info: {
            typ: 'eroeffnungsbestand', rebsorte: wa.rebsorte ?? null, jahrgang: wa.jahrgang ?? null,
            weingarten_name: null, gst_nr: null, katastralgemeinde: null, ernte_datum: null, kmw: null, zukauf_von: null,
          },
        })
      }
    }

    // 4. Verschneidungen, bei denen diese Charge das Ziel ist – Quellen rekursiv auflösen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vRows } = await (supabase.from('verschneidungen') as any)
      .select('id, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter)')
      .eq('ziel_weinausbau_id', weinausbauId)

    for (const v of ((vRows ?? []) as R[])) {
      for (const q of ((v.quellen ?? []) as R[])) {
        const quelleLiter = mengeNum(q.menge_liter)
        if (quelleLiter <= EPSILON || !q.quell_weinausbau_id) continue
        const quelleKomposition = await resolveRoh(supabase, q.quell_weinausbau_id, cache, naechsteBesucht)
        const quelleTotal = quelleKomposition.reduce((s, e) => s + e.liter, 0)
        if (quelleTotal <= EPSILON) continue
        for (const e of quelleKomposition) {
          eintraege.push({ key: e.key, liter: (e.liter / quelleTotal) * quelleLiter, info: e.info })
        }
      }
    }

    // Fallback: keine Herkunft ermittelbar (z.B. sehr alte/manuelle Daten ohne
    // Pressung/Zukauf/Eröffnungsbestand/Verschneidung)
    if (eintraege.length === 0) {
      eintraege.push({
        key: `unbekannt:${weinausbauId}`,
        liter: 1,
        info: {
          typ: 'unbekannt', rebsorte: wa?.rebsorte ?? null, jahrgang: wa?.jahrgang ?? null,
          weingarten_name: null, gst_nr: null, katastralgemeinde: null, ernte_datum: null, kmw: null, zukauf_von: null,
        },
      })
    }

    return eintraege
  })()

  cache.set(weinausbauId, promise)
  return promise
}

/** Normalisiert + gruppiert die rohe Komposition einer Charge auf 100 % (nach `key`). */
function normalisiere(eintraege: RohEintrag[]): KompositionUrsprung[] {
  const total = eintraege.reduce((s, e) => s + e.liter, 0)
  if (total <= EPSILON) return []
  const byKey = new Map<string, { liter: number; info: Omit<KompositionUrsprung, 'anteil_pct' | 'key'> }>()
  for (const e of eintraege) {
    const existing = byKey.get(e.key)
    if (existing) existing.liter += e.liter
    else byKey.set(e.key, { liter: e.liter, info: e.info })
  }
  return Array.from(byKey.entries())
    .map(([key, { liter, info }]) => ({ key, ...info, anteil_pct: Math.round((liter / total) * 1000) / 10 }))
    .sort((a, b) => b.anteil_pct - a.anteil_pct)
}

/**
 * Vollständige, rekursiv aufgelöste Herkunfts-Zusammensetzung einer einzelnen
 * Weinausbau-Charge (in %) – über alle Verschneidungs-Generationen zurück bis zu den
 * ursprünglichen Pressungen/Zukäufen/Eröffnungsbeständen.
 */
export async function resolveBlendKomposition(supabase: SB, weinausbauId: string): Promise<KompositionUrsprung[]> {
  const cache = new Map<string, Promise<RohEintrag[]>>()
  const roh = await resolveRoh(supabase, weinausbauId, cache, new Set())
  return normalisiere(roh)
}

/**
 * Herkunfts-Zusammensetzung einer Füllung – kombiniert alle beteiligten Chargen (via
 * `fuellung_chargen`, mit Fallback auf `fuellungen.weinausbau_id` bei alten Direkt-Füllungen)
 * gewichtet nach Anteil-Litern.
 */
export async function resolveBlendKompositionFuellung(supabase: SB, fuellungId: string): Promise<KompositionUrsprung[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fcRows } = await (supabase.from('fuellung_chargen') as any)
    .select('weinausbau_id, anteil_liter')
    .eq('fuellung_id', fuellungId)

  let chargen: Array<{ id: string; anteil: number | null }> = ((fcRows ?? []) as R[])
    .filter(r => r.weinausbau_id)
    .map(r => ({ id: r.weinausbau_id, anteil: r.anteil_liter != null ? mengeNum(r.anteil_liter) : null }))

  if (chargen.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fRow } = await (supabase.from('fuellungen') as any)
      .select('weinausbau_id').eq('id', fuellungId).maybeSingle()
    const direktId = (fRow as R | null)?.weinausbau_id
    if (direktId) chargen = [{ id: direktId, anteil: null }]
  }
  if (chargen.length === 0) return []

  // Gewichtung: bekannte Anteil-Liter direkt verwenden; fehlt bei einzelnen Chargen der Wert
  // (alte Daten), wird ihnen ersatzweise der Durchschnitt der bekannten Anteile zugewiesen,
  // statt sie komplett aus der Komposition herauszufallen zu lassen.
  const bekannteSumme = chargen.reduce((s, c) => s + (c.anteil ?? 0), 0)
  const bekannteAnzahl = chargen.filter(c => c.anteil != null).length
  const ersatzAnteil = bekannteAnzahl > 0 ? bekannteSumme / bekannteAnzahl : 1

  const cache = new Map<string, Promise<RohEintrag[]>>()
  const alleRoh: RohEintrag[] = []

  for (const c of chargen) {
    const gewicht = c.anteil ?? ersatzAnteil
    if (gewicht <= EPSILON) continue
    const roh = await resolveRoh(supabase, c.id, cache, new Set())
    const rohTotal = roh.reduce((s, e) => s + e.liter, 0)
    if (rohTotal <= EPSILON) continue
    for (const e of roh) {
      alleRoh.push({ key: e.key, liter: (e.liter / rohTotal) * gewicht, info: e.info })
    }
  }

  return normalisiere(alleRoh)
}
