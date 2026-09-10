// ── Wetter-Cache je Betrieb (Migration 201) ──────────────────────────────────
// Rieden-Koordinaten werden auf 0,02° (≈ 2 km) zusammengefasst, je Punkt liegen
// Stundenwerte des Rückblicks (INCA, 35 Tage) und der Prognose (NWP, ~55 h) in
// wetter_stunden. aktualisiereWetter() frischt bei Bedarf über die Service-Role
// auf (Rückblick älter als 90 min, Prognose älter als 3 h) - so braucht es
// keinen stündlichen Cron; der Morgenbericht-Cron wärmt den Cache täglich vor.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { holePrognose, holeRueckblick, type WetterStunde } from './geosphere'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type WetterPunkt = { key: string; lat: number; lon: number; riedIds: string[] }
export type WetterRied = { id: string; name: string; ried: string | null; lat: number | null; lon: number | null }

export const RUECKBLICK_TAGE = 35
const RASTER = 0.02

export function wetterPunkte(rieden: WetterRied[]): WetterPunkt[] {
  const map = new Map<string, WetterPunkt>()
  for (const r of rieden) {
    if (r.lat === null || r.lon === null || Number.isNaN(r.lat) || Number.isNaN(r.lon)) continue
    const lat = Math.round(r.lat / RASTER) * RASTER, lon = Math.round(r.lon / RASTER) * RASTER
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
    const p = map.get(key) ?? { key, lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)), riedIds: [] }
    p.riedIds.push(r.id)
    map.set(key, p)
  }
  return [...map.values()]
}

export type WetterDaten = { punkt: WetterPunkt; rueckblick: WetterStunde[]; prognose: WetterStunde[]; stand: string | null; prognoseStand: string | null }

/** Cache auffrischen (Service-Role). Fehler je Punkt werden gesammelt, nicht geworfen. */
export async function aktualisiereWetter(tenantId: string, punkte: WetterPunkt[], opts: { erzwingen?: boolean } = {}): Promise<{ aktualisiert: number; fehler: string[] }> {
  if (punkte.length === 0) return { aktualisiert: 0, fehler: [] }
  const admin = createSupabaseAdminClient()
  const jetzt = new Date()
  const fehler: string[] = []
  let aktualisiert = 0

  for (const p of punkte.slice(0, 12)) { // Schutz: höchstens 12 Punkte je Betrieb und Lauf
    try {
      // ── Rückblick (INCA) ──
      const { data: letzte } = await (admin.from('wetter_stunden') as any).select('zeit')
        .eq('tenant_id', tenantId).eq('lat', p.lat).eq('lon', p.lon).eq('quelle', 'inca').order('zeit', { ascending: false }).limit(1).maybeSingle()
      const letzteZeit = letzte?.zeit ? new Date(letzte.zeit) : null
      const alterMin = letzteZeit ? (jetzt.getTime() - letzteZeit.getTime()) / 60000 : Infinity
      if (opts.erzwingen || alterMin >= 90) {
        const von = letzteZeit ? new Date(letzteZeit.getTime() + 3600000) : new Date(jetzt.getTime() - RUECKBLICK_TAGE * 86400000)
        const vonBegrenzt = new Date(Math.max(von.getTime(), jetzt.getTime() - RUECKBLICK_TAGE * 86400000))
        if (vonBegrenzt.getTime() < jetzt.getTime()) {
          const werte = await holeRueckblick(p.lat, p.lon, vonBegrenzt, jetzt)
          const zeilen = werte.filter(w => w.t2m !== null || w.rr !== null).map(w => ({
            tenant_id: tenantId, lat: p.lat, lon: p.lon, quelle: 'inca', zeit: w.zeit, rr: w.rr, t2m: w.t2m, rh2m: w.rh2m, wind_ms: w.wind_ms, boe_ms: null, abgerufen_am: jetzt.toISOString(),
          }))
          for (let i = 0; i < zeilen.length; i += 500) {
            const { error } = await (admin.from('wetter_stunden') as any).upsert(zeilen.slice(i, i + 500), { onConflict: 'tenant_id,lat,lon,quelle,zeit' })
            if (error) throw new Error(error.message)
          }
          aktualisiert++
        }
      }
      // ── Prognose (NWP) ──
      const { data: prog } = await (admin.from('wetter_stunden') as any).select('abgerufen_am')
        .eq('tenant_id', tenantId).eq('lat', p.lat).eq('lon', p.lon).eq('quelle', 'nwp').order('abgerufen_am', { ascending: false }).limit(1).maybeSingle()
      const progAlterMin = prog?.abgerufen_am ? (jetzt.getTime() - new Date(prog.abgerufen_am).getTime()) / 60000 : Infinity
      if (opts.erzwingen || progAlterMin >= 180) {
        const { stunden } = await holePrognose(p.lat, p.lon)
        if (stunden.length > 0) {
          await (admin.from('wetter_stunden') as any).delete().eq('tenant_id', tenantId).eq('lat', p.lat).eq('lon', p.lon).eq('quelle', 'nwp')
          const zeilen = stunden.map(w => ({
            tenant_id: tenantId, lat: p.lat, lon: p.lon, quelle: 'nwp', zeit: w.zeit, rr: w.rr, t2m: w.t2m, rh2m: w.rh2m, wind_ms: w.wind_ms, boe_ms: w.boe_ms, abgerufen_am: jetzt.toISOString(),
          }))
          const { error } = await (admin.from('wetter_stunden') as any).insert(zeilen)
          if (error) throw new Error(error.message)
          aktualisiert++
        }
      }
    } catch (e) {
      fehler.push(`${p.key}: ${(e as Error).message}`)
    }
  }
  // Alte Rückblick-Zeilen ausdünnen (älter als 35 Tage)
  await (admin.from('wetter_stunden') as any).delete().eq('tenant_id', tenantId).eq('quelle', 'inca').lt('zeit', new Date(jetzt.getTime() - (RUECKBLICK_TAGE + 2) * 86400000).toISOString())
  return { aktualisiert, fehler }
}

/** Cache lesen (beliebiger Client mit Lesezugriff auf den Mandanten) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeWetterdaten(client: any, tenantId: string, punkte: WetterPunkt[]): Promise<WetterDaten[]> {
  if (punkte.length === 0) return []
  const seit = new Date(Date.now() - RUECKBLICK_TAGE * 86400000).toISOString()
  const { data } = await (client.from('wetter_stunden') as any).select('lat, lon, quelle, zeit, rr, t2m, rh2m, wind_ms, boe_ms, abgerufen_am')
    .eq('tenant_id', tenantId).gte('zeit', seit).order('zeit')
  const rows = (data ?? []) as R[]
  return punkte.map(p => {
    const eigene = rows.filter(r => Number(r.lat) === p.lat && Number(r.lon) === p.lon)
    const zu = (r: R): WetterStunde => ({ zeit: r.zeit, rr: r.rr === null ? null : Number(r.rr), t2m: r.t2m === null ? null : Number(r.t2m), rh2m: r.rh2m === null ? null : Number(r.rh2m), wind_ms: r.wind_ms === null ? null : Number(r.wind_ms), boe_ms: r.boe_ms === null ? null : Number(r.boe_ms) })
    const rueck = eigene.filter(r => r.quelle === 'inca').map(zu)
    const prog = eigene.filter(r => r.quelle === 'nwp').map(zu)
    return {
      punkt: p, rueckblick: rueck, prognose: prog,
      stand: rueck.length ? rueck[rueck.length - 1].zeit : null,
      prognoseStand: eigene.find(r => r.quelle === 'nwp')?.abgerufen_am ?? null,
    }
  })
}
