import 'server-only'
import { alle } from '@/lib/supabase/alle'
import { ladePsmUebermittlung } from '@/lib/behoerden/psm_uebermittlung'
import { standJeMassnahme, type MassnahmenStand, type ProtokollEintrag } from './stand'

// ── PSM-Übermittlung: Stand laden (KAN-120) ───────────────────────────────────────────────────────────────
// Aktuelle Exportzeilen aller Jahre (dieselbe Ladefunktion wie die CSV „psm-uebermittlung“) und das Protokoll.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type PsmUebermittlungsStand = {
  stand: MassnahmenStand[]
  protokoll: ProtokollEintrag[]
  betriebsnummer: string | null
  /** letzte Export-Läufe (neueste zuerst) für „erneut herunterladen“ */
  laeufe: { exportId: string; exportiertAm: string; exportiertVon: string | null; massnahmen: number }[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladePsmUebermittlungsStand(supabase: any, tenantId: string): Promise<PsmUebermittlungsStand> {
  const { data: einst, error: eErr } = await (supabase.from('tenant_einstellungen') as R)
    .select('betrieb_betriebsnummer').eq('tenant_id', tenantId).maybeSingle()
  if (eErr) throw new Error(`Laden fehlgeschlagen (tenant_einstellungen): ${eErr.message}`)
  const betriebsnummer = (einst as R | null)?.betrieb_betriebsnummer?.trim() || null

  const [{ zeilen }, { data: prot, error: pErr }] = await Promise.all([
    ladePsmUebermittlung(supabase, tenantId, betriebsnummer, { jahr: null }),
    alle<R>((supabase.from('psm_uebermittlungen') as R)
      .select('id, behandlung_id, export_id, hash, version, status, exportiert_am, exportiert_von_name')
      .eq('tenant_id', tenantId)
      .order('exportiert_am').order('id')),
  ])
  if (pErr) throw new Error(`Laden fehlgeschlagen (psm_uebermittlungen): ${pErr.message}`)
  const protokoll = (prot as R[]).map((p): ProtokollEintrag => ({
    behandlung_id: String(p.behandlung_id), export_id: String(p.export_id), hash: String(p.hash), version: Number(p.version),
    status: String(p.status), exportiert_am: String(p.exportiert_am), exportiert_von_name: p.exportiert_von_name ?? null,
  }))

  const laeufeMap = new Map<string, { exportId: string; exportiertAm: string; exportiertVon: string | null; massnahmen: number }>()
  for (const p of protokoll) {
    const l = laeufeMap.get(p.export_id) ?? { exportId: p.export_id, exportiertAm: p.exportiert_am, exportiertVon: p.exportiert_von_name, massnahmen: 0 }
    l.massnahmen++
    laeufeMap.set(p.export_id, l)
  }
  const laeufe = [...laeufeMap.values()].sort((a, b) => b.exportiertAm.localeCompare(a.exportiertAm))

  return { stand: standJeMassnahme(zeilen, protokoll), protokoll, betriebsnummer, laeufe }
}
