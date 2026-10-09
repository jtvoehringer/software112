// ── GeoSphere Austria Data Hub (Open Data, CC BY 4.0) ────────────────────────
// Rückblick: INCA-Analyse 1 km / 1 h (Niederschlag, Temperatur, Feuchte, Wind),
// Prognose: NWP (AROME) 2,5 km / 1 h, ~55-61 h voraus. Beide Endpunkte liefern
// Zeitreihen für beliebige Koordinaten - keine Stationssuche nötig.
// Doku: https://dataset.api.hub.geosphere.at/v1/docs/
// Quellenangabe in der Oberfläche: „Wetterdaten: GeoSphere Austria“.
//
// KAN-123 (25.09.2026): Rate-Limit laut Doku „5 requests per second and 240 requests per hour“
// je Nutzer, darüber HTTP 429 (https://dataset.api.hub.geosphere.at/v1/docs/user-guide/request-limit.html,
// abgerufen 25.09.2026; wie der Data Hub Nutzer erkennt, sagt die Doku nicht – ohne API-Schlüssel
// vermutlich je IP). Der Morgenbericht-Lauf hat höchstens 2 Betriebe × 3 Wetterpunkte
// gleichzeitig (lib/morgenbericht/zeitplan.ts, lib/wetter/daten.ts), je Punkt zwei Abrufe
// nacheinander – der Takt unten hält die Starts dieser Instanz zusätzlich unter 5 je Sekunde.
// Das Stundenlimit gilt für ALLE Abrufe der App zusammen (Cron über alle Betriebe plus
// „Jetzt aktualisieren“), nicht je Betrieb: derzeit täglich 6 Punkte (Gebeshuber) × 2 = 12 im
// Cron. Bekannte Skalierungsgrenze: bei 12 Punkten × 2 Abrufen reichen 240/h für etwa
// 10 Betriebe mit Wetter – davor ein gemeinsames Stundenbudget, einen betriebsübergreifenden
// Punkte-Cache oder einen eigenen API-Zugang klären (429 landet sonst nur als Wetterfehler im Protokoll).
// Zeitlimit je Abruf 25 s wie bisher: in Stichproben vom 25.09.2026 brauchten 7 von 25 Abrufen
// über 10 s, bis 28 s (Antwortzeit des Servers, nicht Datenmenge – v. a. der 35-Tage-Rückblick
// eines neuen Punkts), und im Cron brach am selben Tag um 05:01 UTC ein Abruf erst nach 25 s ab;
// 10 s hätten viele sonst gelungene Abrufe abgebrochen. Die Gesamtzeit im Cron begrenzt das
// Signal des Aufrufers (Zeitgrenze des Betriebs), das Zeitlimit hier nur den einzelnen Abruf.

import { startTakt } from '@/lib/utils/parallel'
import { rund as rundKfm } from '@/lib/zahl/runden'

const BASIS = 'https://dataset.api.hub.geosphere.at/v1'
const ABRUF_TIMEOUT_MS = 25_000
const takt = startTakt(4, 1000)

export type WetterStunde = {
  zeit: string        // ISO, UTC
  rr: number | null   // mm in der Stunde
  t2m: number | null  // °C
  rh2m: number | null // %
  wind_ms: number | null
  boe_ms: number | null
}

const iso = (d: Date) => d.toISOString().slice(0, 16)  // YYYY-MM-DDTHH:MM
const rund = (n: number | null | undefined, st = 2) => n === null || n === undefined || Number.isNaN(Number(n)) ? null : rundKfm(Number(n), st)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function hole(url: string, signal?: AbortSignal): Promise<R> {
  await takt(signal)
  const zeitlimit = AbortSignal.timeout(ABRUF_TIMEOUT_MS)
  const res = await fetch(url, { headers: { accept: 'application/json' }, next: { revalidate: 0 }, signal: signal ? AbortSignal.any([signal, zeitlimit]) : zeitlimit })
  if (!res.ok) throw new Error(`GeoSphere ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 300))
  return res.json()
}

/** INCA-Rückblick für einen Punkt von `von` bis `bis` (UTC) */
export async function holeRueckblick(lat: number, lon: number, von: Date, bis: Date, signal?: AbortSignal): Promise<WetterStunde[]> {
  const url = `${BASIS}/timeseries/historical/inca-v1-1h-1km?parameters=RR,T2M,RH2M,UU,VV&start=${iso(von)}&end=${iso(bis)}&lat_lon=${lat.toFixed(3)},${lon.toFixed(3)}&output_format=geojson`
  const d = await hole(url, signal)
  const p = d.features?.[0]?.properties?.parameters ?? {}
  const ts: string[] = d.timestamps ?? []
  return ts.map((t, i) => {
    const uu = Number(p.UU?.data?.[i]), vv = Number(p.VV?.data?.[i])
    return {
      zeit: t, rr: rund(p.RR?.data?.[i]), t2m: rund(p.T2M?.data?.[i]), rh2m: rund(p.RH2M?.data?.[i], 1),
      wind_ms: Number.isNaN(uu) || Number.isNaN(vv) ? null : rund(Math.hypot(uu, vv)), boe_ms: null,
    }
  })
}

/** NWP-Prognose (AROME) für einen Punkt, ab jetzt ~55 h; rr aus der akkumulierten Summe je Stunde abgeleitet */
export async function holePrognose(lat: number, lon: number, signal?: AbortSignal): Promise<{ referenz: string | null; stunden: WetterStunde[] }> {
  const url = `${BASIS}/timeseries/forecast/nwp-v1-1h-2500m?parameters=t2m,rr_acc,rh2m,u10m,v10m,ugust,vgust&lat_lon=${lat.toFixed(3)},${lon.toFixed(3)}&output_format=geojson`
  const d = await hole(url, signal)
  const p = d.features?.[0]?.properties?.parameters ?? {}
  const ts: string[] = d.timestamps ?? []
  const acc: number[] = (p.rr_acc?.data ?? []).map(Number)
  const stunden = ts.map((t, i) => {
    const u = Number(p.u10m?.data?.[i]), v = Number(p.v10m?.data?.[i])
    const ug = Number(p.ugust?.data?.[i]), vg = Number(p.vgust?.data?.[i])
    const rr = i === 0 ? 0 : Math.max(0, (acc[i] ?? 0) - (acc[i - 1] ?? 0))
    return {
      zeit: t, rr: rund(rr), t2m: rund(p.t2m?.data?.[i]), rh2m: rund(p.rh2m?.data?.[i], 1),
      wind_ms: Number.isNaN(u) || Number.isNaN(v) ? null : rund(Math.hypot(u, v)),
      boe_ms: Number.isNaN(ug) || Number.isNaN(vg) ? null : rund(Math.hypot(ug, vg)),
    }
  })
  return { referenz: d.reference_time ?? null, stunden }
}
