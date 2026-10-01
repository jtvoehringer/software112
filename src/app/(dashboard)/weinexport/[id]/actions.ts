'use server'

// KAN-150 F2 (01.10.2026): Exportauftrag stornieren statt löschen. Der Auftrag bleibt mit Grund stehen (Liste und CSV
// zeigen ihn gekennzeichnet), Positionen und Dokumente sind danach unveränderlich (a_export_kind_schutz), ein e-AD gibt es
// nicht mehr. Endgültig löschen über die RPC s112_storniert_loeschen: stornierte Aufträge, Entwürfe ohne ausgestelltes
// Dokument und ohne ARC auch ohne Storno (nur Betriebsleitung, Frage 8) – Positionen und Dokumente gehen mit.
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function exportSchreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.')
  return membership.tenantId
}

export async function stornoExportauftrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await exportSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('exportauftraege') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Exportauftrag nicht gefunden oder bereits storniert.')
  revalidatePath('/weinexport')
  revalidatePath(`/weinexport/${id}`)
}

export async function loescheExportauftrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await exportSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'exportauftraege', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen'))
  revalidatePath('/weinexport')
}
