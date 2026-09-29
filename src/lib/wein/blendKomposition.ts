// Blend-Protokoll: Herkunfts-Zusammensetzung einer Weinausbau-Charge (oder einer Füllung) bis zu den
// ursprünglichen Pressungen (Ried/GST/Rebsorte), Zukäufen oder Eröffnungsbeständen.
//
// KAN-76 (29.09.2026): Die Anteile rechnet der Kern lib/wein/mischungsrechnung.ts zeitrichtig – alle Bewegungen
// chronologisch, Abgänge anteilig, Umzüge (auch n:m, auch über Zwischenchargen) und Verschnitte mit der
// Mischung der Quelle im Moment der Bewegung. Vorher wurden alle Zugänge ohne Datum und ohne Abgänge summiert
// und Umzüge gar nicht verfolgt („Herkunft unbekannt“, 99,0 / 1,0 % statt 91,2 / 8,8 %).
//
// Dieser Lader holt die Bewegungen: beginnend bei den gefragten Chargen rückwärts über Umzüge und Verschnitte,
// bis alle vorgelagerten Chargen bekannt sind (Bewegungsgraph); je Charge alle Zu- und Abgänge. Nur eigener
// Betrieb (tenant_id), Tabellen ohne tenant_id über ihr Elternteil gefiltert. Chips „Besteht aus“,
// Blend-Protokoll (Seite und CSV) und Rückverfolgung nutzen dieselben Funktionen.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle } from '@/lib/supabase/alle'
import {
  zusammensetzung, zusammensetzungEntnahme, type Ereignis, type Herkunftsanteil, type HerkunftInfo, type HerkunftLiter,
  type Zusammensetzung,
} from './mischungsrechnung'

type R = Record<string, any>

/** Herkunftsanteil einer Charge bzw. Füllung (mit Litern bezogen auf die Bezugsmenge) */
export type KompositionUrsprung = Herkunftsanteil

/** Höchstzahl vorgelagerter Chargen – Schutz gegen entartete Daten */
const MAX_CHARGEN = 500

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
function tagVon(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 10) : ''
}
function ts(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

async function liste(query: any, was: string): Promise<R[]> {
  const { data, error } = await alle<R>(query)
  if (error) throw new Error(`Blend-Protokoll: ${was} konnte nicht geladen werden (${error.message ?? 'unbekannter Fehler'})`)
  return data
}

function info(p: Partial<HerkunftInfo> & { typ: HerkunftInfo['typ'] }): HerkunftInfo {
  return {
    rebsorte: null, jahrgang: null, weingarten_name: null, gst_nr: null, katastralgemeinde: null,
    ernte_datum: null, kmw: null, zukauf_von: null, ...p,
  }
}

function lieferant(z: R): string | null {
  const f = (z.lieferant_firma as R | null)?.name ?? null
  const k = z.lieferant_kontakt as R | null
  const kn = k ? [k.vorname, k.nachname].filter(Boolean).join(' ') : ''
  return f ?? (kn || null)
}

export type Bewegungsgraph = { ereignisse: Ereignis[]; chargen: Map<string, R>; warnungen: string[] }

/**
 * Alle Bewegungen der Chargen `startIds` und ihrer Vorgänger (rückwärts über Umzug und Verschnitt).
 * Ereignis-IDs sind je Quelle eindeutig (Tabelle:ID), damit mehrfach gefundene Bewegungen nur einmal zählen.
 */
export async function ladeBewegungsgraph(supabase: any, tenantId: string, startIds: readonly string[]): Promise<Bewegungsgraph> {
  const ereignisse = new Map<string, Ereignis>()
  const chargen = new Map<string, R>()
  const warnungen: string[] = []
  const bekannt = new Set<string>(startIds)
  let frontier = [...new Set(startIds)]
  const neu = (id: string | null | undefined) => {
    if (!id || bekannt.has(id)) return
    if (bekannt.size >= MAX_CHARGEN) return
    bekannt.add(id); naechste.push(id)
  }
  let naechste: string[] = []

  while (frontier.length > 0) {
    naechste = []
    const ids = frontier
    const [wa, pb, zk, kuVon, kuNach, vsZiel, vsQuelle, fc, fu, vk] = await Promise.all([
      liste((supabase.from('weinausbau') as any)
        .select('id, name, rebsorte, jahrgang, menge_liter, ist_eroeffnungsbestand, anfangsbestand_liter, created_at')
        .eq('tenant_id', tenantId).in('id', ids).order('id'), 'Chargen'),
      // pressung_behaelter ohne tenant_id – Mandant über die Pressung
      liste((supabase.from('pressung_behaelter') as any)
        .select(`id, menge_liter, weinausbau_id,
          pressung:pressung_id(id, datum, erstellt_am, tenant_id, jahrgang:jahrgang_id(jahrgang),
            pressung_weingaerten(id, trauben_kg, rebsorte, ernte_datum, kmw, zukauf_posten_id,
              weingarten:weingarten_id(name), grundstueck:grundstueck_id(gst_nr, katastralgemeinde)))`)
        .in('weinausbau_id', ids).order('id'), 'Pressungen'),
      liste((supabase.from('zukauf_posten') as any)
        .select('id, datum, erstellt_am, menge, rebsorte, jahrgang, ziel_weinausbau_id, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
        .eq('tenant_id', tenantId).in('ziel_weinausbau_id', ids).eq('aktiv', true).in('art', ['wein', 'most']).order('id'), 'Zukäufe'),
      liste((supabase.from('keller_umzuege') as any)
        .select('id, datum, erstellt_am, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, umzug_batch_id, von_weinausbau_id, nach_weinausbau_id')
        .eq('tenant_id', tenantId).in('von_weinausbau_id', ids).order('id'), 'Umzüge'),
      liste((supabase.from('keller_umzuege') as any)
        .select('id, datum, erstellt_am, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, umzug_batch_id, von_weinausbau_id, nach_weinausbau_id')
        .eq('tenant_id', tenantId).in('nach_weinausbau_id', ids).order('id'), 'Umzüge'),
      liste((supabase.from('verschneidungen') as any)
        .select('id, datum, created_at, ziel_weinausbau_id, quellen:verschneidung_quellen(id, quell_weinausbau_id, menge_liter)')
        .eq('tenant_id', tenantId).in('ziel_weinausbau_id', ids).order('id'), 'Verschnitte'),
      // verschneidung_quellen ohne tenant_id – Mandant über die Verschneidung
      liste((supabase.from('verschneidung_quellen') as any)
        .select('id, verschneidung:verschneidung_id(id, datum, created_at, tenant_id, ziel_weinausbau_id, quellen:verschneidung_quellen(id, quell_weinausbau_id, menge_liter))')
        .in('quell_weinausbau_id', ids).order('id'), 'Verschnitte'),
      liste((supabase.from('fuellung_chargen') as any)
        .select('id, fuellung_id, weinausbau_id, anteil_liter, fuellung:fuellung_id(id, datum, erstellt_am, aktiv)')
        .eq('tenant_id', tenantId).in('weinausbau_id', ids).order('id'), 'Füllungen'),
      liste((supabase.from('fuellungen') as any)
        .select('id, datum, erstellt_am, weinausbau_id, menge_liter_gefuellt, anzahl_flaschen, flaschengroesse_ml')
        .eq('tenant_id', tenantId).in('weinausbau_id', ids).eq('aktiv', true).order('id'), 'Füllungen'),
      liste((supabase.from('verkauf_positionen') as any)
        .select('id, menge, weinausbau_id, erstellt_am, verkaufsposten:verkaufsposten_id(datum, storniert, erstellt_am)')
        .eq('tenant_id', tenantId).in('weinausbau_id', ids).eq('typ', 'tank').order('id'), 'Tankverkäufe'),
    ])

    // Chargen, Eröffnungsbestand
    for (const c of wa) {
      chargen.set(c.id, c)
      if (!c.ist_eroeffnungsbestand) continue
      const l = num(c.anfangsbestand_liter) || num(c.menge_liter)
      if (l <= 0) continue
      ereignisse.set(`eb:${c.id}`, {
        art: 'zugang', id: `eb:${c.id}`, datum: '', erfasst: ts(c.created_at), charge: c.id,
        herkunft: [{ key: `eb:${c.id}`, liter: l, info: info({ typ: 'eroeffnungsbestand', rebsorte: c.rebsorte ?? null, jahrgang: c.jahrgang ?? null }) }],
      })
    }

    // Pressungen: Liter des Behälters nach kg auf die Traubenzeilen
    for (const b of pb) {
      const p = b.pressung as R | null
      if (!p || p.tenant_id !== tenantId || !b.weinausbau_id) continue
      const liter = num(b.menge_liter)
      if (liter <= 0) continue
      const zeilen = (p.pressung_weingaerten ?? []) as R[]
      const jahrgang = (p.jahrgang as R | null)?.jahrgang != null ? Number((p.jahrgang as R).jahrgang) : null
      const kgGesamt = zeilen.reduce((s, z) => s + num(z.trauben_kg), 0)
      const herkunft: HerkunftLiter[] = zeilen.length === 0
        ? [{ key: `pressung-unbekannt:${p.id}`, liter, info: info({ typ: 'pressung', jahrgang }) }]
        : zeilen.map(z => {
          const anteil = kgGesamt > 0 ? num(z.trauben_kg) / kgGesamt : 1 / zeilen.length
          const w = z.weingarten as R | null, g = z.grundstueck as R | null
          const jg = jahrgang ?? (z.ernte_datum ? Number(String(z.ernte_datum).slice(0, 4)) : null)
          if (z.zukauf_posten_id) {
            return { key: `zukauf-trauben:${z.zukauf_posten_id}`, liter: liter * anteil,
              info: info({ typ: 'zukauf', rebsorte: z.rebsorte ?? null, jahrgang: jg, ernte_datum: z.ernte_datum ?? null, zukauf_von: 'Trauben-Zukauf' }) }
          }
          return {
            key: `pressung:${w?.name ?? '?'}:${g?.gst_nr ?? '?'}:${z.rebsorte ?? '?'}:${jg ?? '?'}`,
            liter: liter * anteil,
            info: info({
              typ: 'pressung', rebsorte: z.rebsorte ?? null, jahrgang: jg, weingarten_name: w?.name ?? null,
              gst_nr: g?.gst_nr ?? null, katastralgemeinde: g?.katastralgemeinde ?? null,
              ernte_datum: z.ernte_datum ?? null, kmw: z.kmw != null ? num(z.kmw) : null,
            }),
          }
        })
      ereignisse.set(`pb:${b.id}`, { art: 'zugang', id: `pb:${b.id}`, datum: tagVon(p.datum), erfasst: ts(p.erstellt_am), charge: b.weinausbau_id, herkunft })
    }

    // Zukauf (Wein/Most)
    for (const z of zk) {
      const l = num(z.menge)
      if (l <= 0) continue
      const von = lieferant(z)
      ereignisse.set(`zk:${z.id}`, {
        art: 'zugang', id: `zk:${z.id}`, datum: tagVon(z.datum), erfasst: ts(z.erstellt_am), charge: z.ziel_weinausbau_id,
        herkunft: [{ key: `zukauf:${von ?? '?'}:${z.rebsorte ?? '?'}:${z.jahrgang ?? '?'}`, liter: l,
          info: info({ typ: 'zukauf', rebsorte: z.rebsorte ?? null, jahrgang: z.jahrgang ?? null, ernte_datum: z.datum ?? null, zukauf_von: von }) }],
      })
    }

    // Umzüge: n:m-Batches gesammelt, Einzelzeilen direkt; Schwund als Abgang
    const kuAlle = new Map<string, R>()
    for (const u of [...kuVon, ...kuNach]) kuAlle.set(u.id, u)
    const batchIds = [...new Set([...kuAlle.values()].filter(u => u.umzug_batch_id).map(u => u.umzug_batch_id as string))]
      .filter(b => !ereignisse.has(`ub:${b}`))
    if (batchIds.length > 0) {
      const batchZeilen = await liste((supabase.from('keller_umzuege') as any)
        .select('id, datum, erstellt_am, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, umzug_batch_id, von_weinausbau_id, nach_weinausbau_id')
        .eq('tenant_id', tenantId).in('umzug_batch_id', batchIds).order('id'), 'Umzüge')
      for (const z of batchZeilen) kuAlle.set(z.id, z)
    }
    const batches = new Map<string, R[]>()
    for (const u of kuAlle.values()) {
      if (u.umzug_batch_id) { (batches.get(u.umzug_batch_id) ?? batches.set(u.umzug_batch_id, []).get(u.umzug_batch_id)!).push(u); continue }
      const id = `ku:${u.id}`
      if (ereignisse.has(id)) continue
      const brutto = u.brutto_liter != null ? num(u.brutto_liter) : null
      const menge = num(u.menge_liter), schwund = num(u.schwund_liter)
      const abgang = brutto || menge
      if (u.umzug_typ === 'schwund' || !u.nach_weinausbau_id) {
        if (u.von_weinausbau_id && abgang > 0) {
          ereignisse.set(id, { art: 'abgang', id, datum: tagVon(u.datum), erfasst: ts(u.erstellt_am), charge: u.von_weinausbau_id, liter: abgang, grund: u.umzug_typ === 'schwund' ? 'schwund' : 'umzug' })
        }
        continue
      }
      const zugang = brutto != null ? menge : Math.max(0, menge - schwund)
      ereignisse.set(id, {
        art: 'uebertrag', id, grund: 'umzug', datum: tagVon(u.datum), erfasst: ts(u.erstellt_am),
        quellen: u.von_weinausbau_id ? [{ charge: u.von_weinausbau_id, liter: abgang }] : [],
        ziele: [{ charge: u.nach_weinausbau_id, liter: zugang }],
      })
      if (bekannt.has(u.nach_weinausbau_id)) neu(u.von_weinausbau_id)
    }
    for (const [batch, zeilen] of batches) {
      const id = `ub:${batch}`
      if (ereignisse.has(id)) continue
      const quellen = zeilen.filter(z => z.zeilen_typ === 'quelle' && z.von_weinausbau_id)
      const ziele = zeilen.filter(z => z.zeilen_typ === 'ziel' && z.nach_weinausbau_id)
      const erste = [...zeilen].sort((a, b) => String(a.erstellt_am ?? '').localeCompare(String(b.erstellt_am ?? '')))[0]
      ereignisse.set(id, {
        art: 'uebertrag', id, grund: 'umzug', datum: tagVon(erste?.datum), erfasst: ts(erste?.erstellt_am),
        quellen: quellen.map(q => ({ charge: q.von_weinausbau_id, liter: num(q.menge_liter) })),
        ziele: ziele.map(z => ({ charge: z.nach_weinausbau_id, liter: num(z.menge_liter) })),
      })
      if (ziele.some(z => bekannt.has(z.nach_weinausbau_id))) for (const q of quellen) neu(q.von_weinausbau_id)
    }

    // Verschnitte (als Ziel und als Quelle)
    const vsAlle = new Map<string, R>()
    for (const v of vsZiel) vsAlle.set(v.id, v)
    for (const q of vsQuelle) {
      const v = q.verschneidung as R | null
      if (v && v.tenant_id === tenantId) vsAlle.set(v.id, v)
    }
    for (const v of vsAlle.values()) {
      const id = `vs:${v.id}`
      const quellen = ((v.quellen ?? []) as R[]).filter(q => q.quell_weinausbau_id && num(q.menge_liter) > 0)
      if (!ereignisse.has(id)) {
        const gesamt = quellen.reduce((s, q) => s + num(q.menge_liter), 0)
        ereignisse.set(id, {
          art: 'uebertrag', id, grund: 'verschnitt', datum: tagVon(v.datum), erfasst: ts(v.created_at),
          quellen: quellen.map(q => ({ charge: q.quell_weinausbau_id, liter: num(q.menge_liter) })),
          ziele: v.ziel_weinausbau_id ? [{ charge: v.ziel_weinausbau_id, liter: gesamt }] : [],
        })
      }
      if (bekannt.has(v.ziel_weinausbau_id)) for (const q of quellen) neu(q.quell_weinausbau_id)
    }

    // Füllungen: je Charge über fuellung_chargen; alte Direkt-Füllungen ohne fuellung_chargen über weinausbau_id
    const mitChargen = new Set<string>()
    for (const r of fc) {
      const f = r.fuellung as R | null
      if (!f || f.aktiv === false) continue
      mitChargen.add(r.fuellung_id)
      const l = num(r.anteil_liter)
      if (l <= 0) continue
      ereignisse.set(`fc:${r.id}`, { art: 'abgang', id: `fc:${r.id}`, datum: tagVon(f.datum), erfasst: ts(f.erstellt_am), charge: r.weinausbau_id, liter: l, grund: 'fuellung', bezug: `fuellung:${r.fuellung_id}` })
    }
    const direkt = fu.filter(f => !mitChargen.has(f.id))
    if (direkt.length > 0) {
      const weitere = await liste((supabase.from('fuellung_chargen') as any)
        .select('fuellung_id').eq('tenant_id', tenantId).in('fuellung_id', direkt.map(f => f.id)).order('fuellung_id'), 'Füllungen')
      const hatZeilen = new Set(weitere.map(w => w.fuellung_id as string))
      for (const f of direkt) {
        if (hatZeilen.has(f.id)) continue
        const l = num(f.menge_liter_gefuellt) || (num(f.anzahl_flaschen) * num(f.flaschengroesse_ml) / 1000)
        if (l <= 0) continue
        ereignisse.set(`fu:${f.id}`, { art: 'abgang', id: `fu:${f.id}`, datum: tagVon(f.datum), erfasst: ts(f.erstellt_am), charge: f.weinausbau_id, liter: l, grund: 'fuellung', bezug: `fuellung:${f.id}` })
      }
    }

    // Tankverkauf (stornierte Verkäufe zählen nicht)
    for (const v of vk) {
      const vp = v.verkaufsposten as R | null
      if (!vp || vp.storniert) continue
      const l = num(v.menge)
      if (l <= 0) continue
      ereignisse.set(`vk:${v.id}`, { art: 'abgang', id: `vk:${v.id}`, datum: tagVon(vp.datum), erfasst: ts(vp.erstellt_am ?? v.erstellt_am), charge: v.weinausbau_id, liter: l, grund: 'verkauf' })
    }

    frontier = naechste
  }
  if (bekannt.size >= MAX_CHARGEN) warnungen.push(`Mehr als ${MAX_CHARGEN} vorgelagerte Chargen – die Herkunft ist nur teilweise aufgelöst.`)
  return { ereignisse: [...ereignisse.values()], chargen, warnungen }
}

/**
 * Zusammensetzung einer Charge zum Stichtag (ohne: heute). Heute wird mit dem gebuchten Bestand verglichen
 * (Warnung bei Abweichung, Anteile auf den gebuchten Bestand bezogen – Entscheidung Jörgen 29.09.2026).
 */
export async function ladeZusammensetzungCharge(
  supabase: any, tenantId: string, weinausbauId: string, stichtag: string | null = null,
): Promise<Zusammensetzung> {
  const g = await ladeBewegungsgraph(supabase, tenantId, [weinausbauId])
  const c = g.chargen.get(weinausbauId)
  if (!c) return { anteile: [], warnungen: [], saldoLiter: 0 }
  const z = zusammensetzung(g.ereignisse, weinausbauId, {
    stichtag, gebuchterBestand: stichtag ? null : num(c.menge_liter), name: c.name ?? null,
  })
  return { ...z, warnungen: [...g.warnungen, ...z.warnungen] }
}

/** Zusammensetzung einer Füllung = was bei der Abfüllung aus ihren Chargen entnommen wurde */
export async function ladeZusammensetzungFuellung(supabase: any, tenantId: string, fuellungId: string): Promise<Zusammensetzung> {
  const [fc, f] = await Promise.all([
    liste((supabase.from('fuellung_chargen') as any)
      .select('weinausbau_id').eq('tenant_id', tenantId).eq('fuellung_id', fuellungId).order('weinausbau_id'), 'Füllungen'),
    (supabase.from('fuellungen') as any).select('weinausbau_id').eq('tenant_id', tenantId).eq('id', fuellungId).maybeSingle(),
  ])
  const ids = [...new Set([...fc.map(r => r.weinausbau_id as string), (f.data as R | null)?.weinausbau_id as string | undefined].filter((x): x is string => !!x))]
  if (ids.length === 0) return { anteile: [], warnungen: [], saldoLiter: 0 }
  const g = await ladeBewegungsgraph(supabase, tenantId, ids)
  const z = zusammensetzungEntnahme(g.ereignisse, `fuellung:${fuellungId}`)
  const warnungen = [...g.warnungen]
  if (z.anteile.length === 0) warnungen.push('Die Füllung ist keiner Charge mit Bestand zugeordnet – Herkunft nicht ermittelbar.')
  return { ...z, warnungen }
}

/** Kompatibel zu früheren Aufrufen: nur die Anteile einer Charge (heute) */
export async function resolveBlendKomposition(supabase: any, weinausbauId: string, tenantId: string | null): Promise<KompositionUrsprung[]> {
  if (!tenantId) return []
  return (await ladeZusammensetzungCharge(supabase, tenantId, weinausbauId)).anteile
}

/** Kompatibel zu früheren Aufrufen: nur die Anteile einer Füllung */
export async function resolveBlendKompositionFuellung(supabase: any, fuellungId: string, tenantId: string | null): Promise<KompositionUrsprung[]> {
  if (!tenantId) return []
  return (await ladeZusammensetzungFuellung(supabase, tenantId, fuellungId)).anteile
}
