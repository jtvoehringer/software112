'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb, seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff, schreibSperreFehler } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
// beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
// Daten eines anderen Betriebs als des gerade ausgewählten angezeigt/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership.tenantId
}

export async function createLage(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const payload: AR = {
    tenant_id:    tenantId,
    name:         formData.get('name') as string,
    gemeinde:     (formData.get('gemeinde') as string) || null,
    // KAN-110: amtliche Ried – leer übernimmt den Namen (wie die Vorbelegung der Migration)
    amtliche_ried: ((formData.get('amtliche_ried') as string | null) ?? '').trim() || ((formData.get('name') as string | null) ?? '').trim() || null,
    // KAN-165: kein weinbaugebiet mehr – es ergibt sich aus dem Herkunft-Code der Grundstücke (bestehende Werte bleiben)
    notizen:      (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('lagen') as any).insert(payload)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/lagen')
  revalidatePath('/weingarten')
}

export async function updateLage(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const name = formData.get('name') as string
  const payload: AR = {
    name,
    gemeinde:     (formData.get('gemeinde') as string) || null,
    // KAN-110: amtliche Ried – leer = nicht gepflegt (die Verschnitt-Regel prüft die Ried dann nicht)
    amtliche_ried: ((formData.get('amtliche_ried') as string | null) ?? '').trim() || null,
    // KAN-165: weinbaugebiet nicht mehr aus dem Formular (abgeleitet aus den Grundstücken, bestehende Werte bleiben)
    notizen:      (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('lagen') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)

  // Rückmeldung 24.8.2026: das denormalisierte Textfeld weingarten.ried (nach
  // dem die Rieden-Übersicht gruppiert, siehe WeingartenBaum.tsx) muss beim
  // Umbenennen einer Lage für alle zugewiesenen Weingarten-Datensätze
  // mitgezogen werden, sonst zeigt die Übersicht weiterhin den alten Namen
  // (analog zum selben Fix in weingarten/actions.ts::updateWeingarten).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { const { error: e } = await (supabase.from('weingarten') as any)
    .update({ ried: name })
    .eq('lage_id', id).eq('tenant_id', tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weingarten): ${e.message}`) }

  revalidatePath('/lagen')
  revalidatePath('/weingarten')
}

export async function deleteLage(id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    if (!membership) return { error: 'Kein Betrieb gefunden' }
    const betriebGewechselt = await seitenBetriebFehler(membership.tenantId)   // KAN-30
    if (betriebGewechselt) return { error: betriebGewechselt }
    const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
    if (aboGesperrt) return { error: aboGesperrt }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('lagen') as any)
      .delete()
      .eq('id', id)
      .eq('tenant_id', membership.tenantId)
    if (error) return { error: (error as AR).message }

    revalidatePath('/lagen')
    revalidatePath('/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen der Ried' }
  }
}

export async function assignWeingartenToLage(weingartenId: string, lageId: string | null) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // ried-Text synchron halten: bei Zuweisung Lage-Name setzen, bei Entfernung löschen
  let riedName: string | null = null
  if (lageId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lage } = await (supabase.from('lagen') as any)
      .select('name').eq('id', lageId).eq('tenant_id', tenantId).maybeSingle()
    riedName = (lage as AR | null)?.name ?? null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any)
    .update({ lage_id: lageId, ried: riedName })
    .eq('id', weingartenId)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/lagen')
  revalidatePath('/weingarten')
}
