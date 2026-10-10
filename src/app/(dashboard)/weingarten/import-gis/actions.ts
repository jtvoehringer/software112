'use server'

// ── eAMA-GIS-Import: Zuordnung + Übernahme (Stufe 2 Rieden-Koordinaten) ─────
// Das Shapefile-ZIP wird im Browser geparst (shpjs, MGI Lambert → WGS84,
// siehe ImportGisClient.tsx); hierher kommen fertige WGS84-Polygone.
// Zuordnung: weingarten.ama_feldnummer = FSNR, grundstuecke.ama_feldnummer = SLNR.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { zentrum, type EamaFeldstueck, type EamaSchlag } from '@/lib/geo/eama'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type FsZuordnung = {
  fsnr: number; fsname: string; nutzung: string | null; flaeche_ha: number | null
  ried: { id: string; name: string; geoQuelle: string | null; hatPin: boolean; hatUmriss: boolean } | null
  schlaege: number          // Schläge dieses Feldstücks in der Datei
  gstTreffer: number        // Grundstücke, denen ein Schlag-Polygon zugeordnet werden kann
}
export type Vorschau = {
  zuordnungen: FsZuordnung[]
  riedenOhneFeldstueck: { id: string; name: string; ama_feldnummer: string | null }[]
  schlaegeOhneGst: { fsnr: number; slnr: number; sorte: string | null }[]
}

async function kontext() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Nicht angemeldet')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'rieden')) throw new AktionsFehler('Keine Berechtigung')
  return { supabase, tenantId: membership.tenantId }
}

const fsKey = (v: unknown) => { const n = parseInt(String(v ?? '').trim()); return Number.isFinite(n) ? n : null }

async function ladeBestand(supabase: any, tenantId: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [{ data: w, error: wFehler }, { data: g, error: gFehler }] = await Promise.all([
    (supabase.from('weingarten') as any).select('id, name, ried, ama_feldnummer, aktiv, geo_quelle, zentrum_lat, geometrie').eq('tenant_id', tenantId).eq('aktiv', true),
    // alle(): Abgleich über alle Grundstücke – sonst legte der Import vorhandene GST ab dem 1.001. doppelt an
    alle<R>((supabase.from('grundstuecke') as any).select('id, weingarten_id, gst_nr, ama_feldnummer').eq('tenant_id', tenantId).order('id')),
  ])
  // KAN-253: ohne die vorhandenen Rieden legte der Import sie doppelt an
  if (wFehler) throw new AktionsFehler(dbFehlerText(wFehler, 'Rieden konnten nicht geladen werden'))
  if (gFehler) throw new AktionsFehler(`Grundstücke nicht ladbar: ${gFehler.message}`)
  const rieden = ((w ?? []) as R[])
  const riedByFs = new Map<number, R[]>()
  for (const r of rieden) { const k = fsKey(r.ama_feldnummer); if (k == null) continue; const a = riedByFs.get(k) ?? []; a.push(r); riedByFs.set(k, a) }
  const gst = ((g ?? []) as R[])
  return { rieden, riedByFs, gst }
}

export async function vorschauEamaGis(feldstuecke: EamaFeldstueck[], schlaege: EamaSchlag[]): Promise<Vorschau> {
  const { supabase, tenantId } = await kontext()
  const { rieden, riedByFs, gst } = await ladeBestand(supabase, tenantId)

  const gstByRied = new Map<string, R[]>()
  for (const x of gst) { const a = gstByRied.get(x.weingarten_id) ?? []; a.push(x); gstByRied.set(x.weingarten_id, a) }

  const zuordnungen: FsZuordnung[] = feldstuecke.map(fs => {
    const treffer = riedByFs.get(fs.fsnr) ?? []
    const r = treffer[0] ?? null
    const sl = schlaege.filter(s => s.fsnr === fs.fsnr)
    let gstTreffer = 0
    if (r) {
      const gsts = treffer.flatMap(t => gstByRied.get(t.id) ?? [])
      for (const s of sl) gstTreffer += gsts.filter(x => fsKey(x.ama_feldnummer) === s.slnr).length
    }
    return {
      fsnr: fs.fsnr, fsname: fs.fsname, nutzung: fs.nutzung, flaeche_ha: fs.flaeche_ha,
      ried: r ? { id: r.id, name: r.ried ?? r.name, geoQuelle: r.geo_quelle ?? null, hatPin: r.zentrum_lat != null, hatUmriss: !!r.geometrie } : null,
      schlaege: sl.length, gstTreffer,
    }
  })
  const dateiFs = new Set(feldstuecke.map(f => f.fsnr))
  const riedenOhneFeldstueck = rieden
    .filter(r => { const k = fsKey(r.ama_feldnummer); return k == null || !dateiFs.has(k) })
    .map(r => ({ id: r.id as string, name: (r.ried ?? r.name) as string, ama_feldnummer: (r.ama_feldnummer ?? null) as string | null }))
  const schlaegeOhneGst = schlaege.filter(s => {
    const treffer = riedByFs.get(s.fsnr) ?? []
    const gsts = treffer.flatMap(t => gstByRied.get(t.id) ?? [])
    return !gsts.some(x => fsKey(x.ama_feldnummer) === s.slnr)
  }).map(s => ({ fsnr: s.fsnr, slnr: s.slnr, sorte: s.sorte }))
  return { zuordnungen, riedenOhneFeldstueck, schlaegeOhneGst }
}

export async function uebernehmeEamaGis(
  feldstuecke: EamaFeldstueck[], schlaege: EamaSchlag[], opts: { manuellePinsUeberschreiben: boolean },
): Promise<{ rieden: number; pins: number; grundstuecke: number; fehler?: string }> {
  const { supabase, tenantId } = await kontext()
  const { riedByFs, gst } = await ladeBestand(supabase, tenantId)
  const jetzt = new Date().toISOString()
  let rieden = 0, pins = 0, grundstuecke = 0

  for (const fs of feldstuecke) {
    const treffer = riedByFs.get(fs.fsnr) ?? []
    if (!treffer.length) continue
    const z = zentrum(fs.geometrie)
    for (const r of treffer) {
      // Umriss immer übernehmen; den Pin nur, wenn keiner da ist, er schon von eAMA
      // stammt oder das Überschreiben manueller Pins gewünscht ist.
      const pinSetzen = z && (r.zentrum_lat == null || r.geo_quelle !== 'manuell' || opts.manuellePinsUeberschreiben)
      const payload: R = { geometrie: fs.geometrie, geo_stand: jetzt }
      if (pinSetzen && z) { payload.zentrum_lat = z.lat; payload.zentrum_lon = z.lon; payload.geo_quelle = 'eama' }
      else if (!r.geo_quelle) payload.geo_quelle = 'eama'
      const { data: geaendert, error } = await (supabase.from('weingarten') as any).update(payload).eq('id', r.id).eq('tenant_id', tenantId).select('id')
      if (error) return { rieden, pins, grundstuecke, fehler: `${fs.fsname}: ${dbFehlerText(error)}` }
      if (!(geaendert as unknown[] | null)?.length) return { rieden, pins, grundstuecke, fehler: `${fs.fsname}: ${NICHT_GESPEICHERT}` }   // KAN-248
      rieden++; if (pinSetzen) pins++
    }
  }

  // Schläge → Grundstücke (gleiche Ried, Schlagnummer = grundstuecke.ama_feldnummer)
  const gstByRied = new Map<string, R[]>()
  for (const x of gst) { const a = gstByRied.get(x.weingarten_id) ?? []; a.push(x); gstByRied.set(x.weingarten_id, a) }
  for (const s of schlaege) {
    const treffer = riedByFs.get(s.fsnr) ?? []
    const ziele = treffer.flatMap(t => gstByRied.get(t.id) ?? []).filter(x => fsKey(x.ama_feldnummer) === s.slnr)
    if (!ziele.length) continue
    const { error } = await (supabase.from('grundstuecke') as any).update({ geometrie: s.geometrie }).in('id', ziele.map(x => x.id)).eq('tenant_id', tenantId)   // aenderung-ohne-pruefung: Geometrie der Grundstücke des Schlags – Liste eben aus der Datenbank
    if (error) return { rieden, pins, grundstuecke, fehler: `Schlag ${s.fsnr}/${s.slnr}: ${dbFehlerText(error)}` }
    grundstuecke += ziele.length
  }

  revalidatePath('/weingarten'); revalidatePath('/dashboard/weingarten'); revalidatePath('/dashboard')
  return { rieden, pins, grundstuecke }
}
