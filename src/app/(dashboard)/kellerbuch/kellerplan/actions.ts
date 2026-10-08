'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// Liefert den aktiven Tenant des Nutzers über getCurrentMembership() statt einer
// ungefilterten tenant_memberships-Abfrage – letztere würde bei Mehrfach-Mitgliedschaft
// irgendeine (nicht zwingend die aktive) Mitgliedschaft zurückliefern.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  const id = membership?.tenantId
  if (!id) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(id)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  // KAN-241: Freigabe Kellerbuch wie RLS (modul_insert/_update/_delete auf kellerplaene, kellerplan_positionen)
  if (!membership || !canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return id
}

// ── Neuen Kellerplan anlegen ──────────────────────────────────────────────────

export async function createKellerplan(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  const { data, error } = await (supabase.from('kellerplaene') as any).insert({
    tenant_id: tenantId,
    name:      formData.get('name') as string,
    breite_m:  parseFloat(dezimal(formData.get('breite_m') as string)) || 20,
    laenge_m:  parseFloat(dezimal(formData.get('laenge_m') as string)) || 10,
    notizen:   (formData.get('notizen') as string) || null,
  }).select('id').single()

  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/kellerbuch/kellerplan')
  redirect(`/kellerbuch/kellerplan/${(data as AR).id}`)
}

// ── Kellerplan-Metadaten bearbeiten ───────────────────────────────────────────

export async function updateKellerplan(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const { error } = await (supabase.from('kellerplaene') as any).update({
    name:     formData.get('name') as string,
    breite_m: parseFloat(dezimal(formData.get('breite_m') as string)) || 20,
    laenge_m: parseFloat(dezimal(formData.get('laenge_m') as string)) || 10,
    notizen:  (formData.get('notizen') as string) || null,
    aktualisiert_am: new Date().toISOString(),
  }).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/kellerbuch/kellerplan')
  revalidatePath(`/kellerbuch/kellerplan/${id}`)
}

// ── Behälter auf Plan platzieren / verschieben ────────────────────────────────

export async function upsertKellerplanPosition(
  kellerplanId: string,
  behaelterId: string,
  pos: { pos_x_pct: number; pos_y_pct: number; breite_pct: number; hoehe_pct: number }
) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()

  // Ein Gebinde steht nur einem Standort (Kellerplan) zur Verfügung – falls es
  // bereits auf einem anderen Plan platziert ist, wird es hierher verschoben
  // (onConflict auf behaelter_id allein statt der Kombination mit kellerplan_id).
  const { data: existing } = await (supabase.from('kellerplan_positionen') as any)
    .select('kellerplan_id').eq('behaelter_id', behaelterId).eq('tenant_id', tenantId).maybeSingle()
  const alterPlanId = (existing as AR | null)?.kellerplan_id ?? null

  const { error } = await (supabase.from('kellerplan_positionen') as any)
    .upsert({
      tenant_id:     tenantId,
      kellerplan_id: kellerplanId,
      behaelter_id:  behaelterId,
      ...pos,
      aktualisiert_am: new Date().toISOString(),
    }, { onConflict: 'behaelter_id' })

  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath(`/kellerbuch/kellerplan/${kellerplanId}`)
  if (alterPlanId && alterPlanId !== kellerplanId) {
    revalidatePath(`/kellerbuch/kellerplan/${alterPlanId}`)
  }
}

// ── Behälter vom Plan entfernen ───────────────────────────────────────────────

export async function deleteKellerplanPosition(kellerplanId: string, behaelterId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const { error } = await (supabase.from('kellerplan_positionen') as any)
    .delete()
    .eq('kellerplan_id', kellerplanId)
    .eq('behaelter_id', behaelterId)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath(`/kellerbuch/kellerplan/${kellerplanId}`)
}

// ── Kellerplan löschen ────────────────────────────────────────────────────────

export async function deleteKellerplan(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const { error } = await (supabase.from('kellerplaene') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/kellerbuch/kellerplan')
  redirect('/kellerbuch/kellerplan')
}
