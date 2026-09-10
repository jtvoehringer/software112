// ── Wetter & Rieden: Daten laden, Cache auffrischen, Regeln anwenden ─────────
// Einstieg für Dashboard, Morgenbericht-Seite und Cron. Läuft mit einem
// beliebigen Lese-Client (Session oder Service-Role) für den Mandanten; das
// Auffrischen des Caches nutzt intern die Service-Role (best effort - bei
// Netzfehlern bleiben die letzten Werte stehen).

import { aktualisiereWetter, ladeWetterdaten, wetterPunkte, type WetterRied } from './daten'
import { werteWetterAus, type RegelRied, type WetterAuswertung } from './regeln'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const BEHANDLUNG_RUECKBLICK_TAGE = 45

export type WetterEinstellungen = { abwaschMm: number; intervallTage: number }

export async function ladeWetterAuswertung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any, tenantId: string, heute: Date, einst: WetterEinstellungen, opts: { auffrischen?: boolean; erzwingen?: boolean } = { auffrischen: true },
): Promise<WetterAuswertung & { ohneKoordinaten: number; fehler: string[] }> {
  const seit = new Date(heute.getTime() - BEHANDLUNG_RUECKBLICK_TAGE * 86400000).toISOString().slice(0, 10)
  const [{ data: wgRaw }, { data: bhRaw }] = await Promise.all([
    (client.from('weingarten') as any).select('id, name, ried, zentrum_lat, zentrum_lon').eq('tenant_id', tenantId).eq('aktiv', true).order('name'),
    (client.from('behandlungen') as any).select('id, weingarten_id, datum, art, ernte_fruehesteins, psm:pflanzenschutzmittel!psm_id(name, handelsname, wartezeit_tage)')
      .eq('tenant_id', tenantId).eq('art', 'spritzung').gte('datum', seit).order('datum', { ascending: false }),
  ])
  const rieden: WetterRied[] = ((wgRaw ?? []) as R[]).map(w => ({
    id: w.id, name: w.name, ried: w.ried ?? null,
    lat: w.zentrum_lat === null || w.zentrum_lat === undefined ? null : Number(w.zentrum_lat),
    lon: w.zentrum_lon === null || w.zentrum_lon === undefined ? null : Number(w.zentrum_lon),
  }))
  const punkte = wetterPunkte(rieden)
  const ohneKoordinaten = rieden.filter(r => r.lat === null || r.lon === null).length

  let fehler: string[] = []
  if (opts.auffrischen !== false && punkte.length > 0) {
    const r = await aktualisiereWetter(tenantId, punkte, { erzwingen: opts.erzwingen })
    fehler = r.fehler
  }
  const wetter = await ladeWetterdaten(client, tenantId, punkte)

  // letzte Spritzung je Ried
  const letzte = new Map<string, R>()
  for (const b of (bhRaw ?? []) as R[]) if (b.weingarten_id && !letzte.has(b.weingarten_id)) letzte.set(b.weingarten_id, b)
  const regelRieden: RegelRied[] = rieden.map(r => {
    const b = letzte.get(r.id)
    const p = punkte.find(x => x.riedIds.includes(r.id))
    return {
      id: r.id, name: r.name, ried: r.ried, punktKey: p?.key ?? null,
      letzteBehandlung: b ? { datum: String(b.datum).slice(0, 10), mittel: b.psm?.handelsname || b.psm?.name || null, wartezeitTage: b.psm?.wartezeit_tage ?? null } : null,
      ernteFruehestens: b?.ernte_fruehesteins ? String(b.ernte_fruehesteins).slice(0, 10) : null,
    }
  })
  const aus = werteWetterAus({ rieden: regelRieden, wetter, heute, einst })
  return { ...aus, ohneKoordinaten, fehler }
}
