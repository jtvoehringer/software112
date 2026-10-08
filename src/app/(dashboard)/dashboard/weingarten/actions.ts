'use server'

// Server Actions der Sicht "Weingarten & Ernte": Lesevorbereitungs-Checkliste
// (Tabellen checklisten / checklisten_punkte, Migration 178).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { LESE_VORLAGE } from './vorlage'
import { AktionsFehler } from '@/lib/fehler'

const PFAD = '/dashboard/weingarten'

async function kontext() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const { data: { user } } = await supabase.auth.getUser()
  if (!membership?.tenantId || !user) throw new AktionsFehler('Nicht angemeldet')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership.role, 'rieden')) throw new AktionsFehler('Keine Berechtigung')
  return { supabase, tenantId: membership.tenantId, userId: user.id }
}

export async function checklisteAnlegen(jahr: number) {
  const { supabase, tenantId, userId } = await kontext()
  const { data: liste, error } = await (supabase.from('checklisten') as any)
    .insert({ tenant_id: tenantId, typ: 'lese', name: `Lesevorbereitung ${jahr}`, jahr, erstellt_von: userId })
    .select('id').single()
  if (error) throw new AktionsFehler(error.message)
  const punkte = LESE_VORLAGE.map((p, i) => ({
    tenant_id: tenantId, checkliste_id: liste.id, text: p.text, zustaendig: p.zustaendig, faellig_hinweis: p.hinweis, sortierung: (i + 1) * 10,
  }))
  const { error: e2 } = await (supabase.from('checklisten_punkte') as any).insert(punkte)
  if (e2) throw new AktionsFehler(e2.message)
  revalidatePath(PFAD); revalidatePath('/dashboard')
}

export async function punktUmschalten(id: string, erledigt: boolean) {
  const { supabase, tenantId, userId } = await kontext()
  const { error } = await (supabase.from('checklisten_punkte') as any)
    .update({ erledigt, erledigt_am: erledigt ? new Date().toISOString() : null, erledigt_von: erledigt ? userId : null })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(error.message)
  revalidatePath(PFAD); revalidatePath('/dashboard')
}

export async function punktHinzufuegen(checklisteId: string, text: string, zustaendig: string, hinweis: string) {
  const { supabase, tenantId } = await kontext()
  const t = text.trim()
  if (!t) return
  const { data: max } = await (supabase.from('checklisten_punkte') as any)
    .select('sortierung').eq('checkliste_id', checklisteId).order('sortierung', { ascending: false }).limit(1).maybeSingle()
  const { error } = await (supabase.from('checklisten_punkte') as any).insert({
    tenant_id: tenantId, checkliste_id: checklisteId, text: t, zustaendig: zustaendig.trim() || null, faellig_hinweis: hinweis.trim() || null,
    sortierung: ((max as { sortierung?: number } | null)?.sortierung ?? 0) + 10,
  })
  if (error) throw new AktionsFehler(error.message)
  revalidatePath(PFAD); revalidatePath('/dashboard')
}

export async function punktLoeschen(id: string) {
  const { supabase, tenantId } = await kontext()
  const { data: weg, error } = await (supabase.from('checklisten_punkte') as any).delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(error.message)
  if (((weg ?? []) as unknown[]).length === 0) throw new AktionsFehler('Der Punkt wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.')   // KAN-243
  revalidatePath(PFAD); revalidatePath('/dashboard')
}
