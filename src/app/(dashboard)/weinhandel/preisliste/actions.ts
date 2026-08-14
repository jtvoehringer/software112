'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// Next.js wirft intern NEXT_REDIRECT / NEXT_NOT_FOUND mit einem digest-Feld.
// Diese müssen in try/catch re-geworfen werden, sonst funktioniert die Navigation nicht.
function isNextInternalError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'digest' in err &&
    typeof (err as AR).digest === 'string' &&
    ((err as AR).digest.startsWith('NEXT_REDIRECT') || (err as AR).digest.startsWith('NEXT_NOT_FOUND'))
  )
}

async function getTenantId(): Promise<string | null> {
  const membership = await getCurrentMembership()
  return membership?.tenantId ?? null
}

// ── Preisliste anlegen ────────────────────────────────────────────────────────

export async function createPreisliste(formData: FormData) {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    if (!tenantId) { redirect('/weinhandel/preisliste') }

    const newId = randomUUID()
    const { error } = await (supabase.from('preislisten') as any).insert({
      id:           newId,
      tenant_id:    tenantId,
      name:         formData.get('name') as string,
      beschreibung: (formData.get('beschreibung') as string) || null,
      gueltig_von:  (formData.get('gueltig_von') as string)  || null,
      gueltig_bis:  (formData.get('gueltig_bis') as string)  || null,
    })

    if (error) {
      console.error('createPreisliste insert error:', error.message, error.code)
      redirect('/weinhandel/preisliste')
    }
    revalidatePath('/weinhandel/preisliste')
    redirect(`/weinhandel/preisliste/${newId}`)
  } catch (err) {
    if (isNextInternalError(err)) throw err
    console.error('createPreisliste unexpected:', err)
    redirect('/weinhandel/preisliste')
  }
}

// ── Preisliste bearbeiten ─────────────────────────────────────────────────────

export async function updatePreisliste(id: string, formData: FormData) {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId  = await getTenantId()
    const { error } = await (supabase.from('preislisten') as any).update({
      name:            formData.get('name') as string,
      beschreibung:    (formData.get('beschreibung') as string) || null,
      gueltig_von:     (formData.get('gueltig_von') as string)  || null,
      gueltig_bis:     (formData.get('gueltig_bis') as string)  || null,
      aktualisiert_am: new Date().toISOString(),
    }).eq('id', id).eq('tenant_id', tenantId ?? '')
    if (error) console.error('updatePreisliste:', error.message)
    revalidatePath('/weinhandel/preisliste')
    revalidatePath(`/weinhandel/preisliste/${id}`)
  } catch (err) {
    if (isNextInternalError(err)) throw err
    console.error('updatePreisliste unexpected:', err)
  }
}

// ── Preisliste deaktivieren ───────────────────────────────────────────────────

export async function deactivatePreisliste(id: string) {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId  = await getTenantId()
    const { error } = await (supabase.from('preislisten') as any)
      .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId ?? '')
    if (error) console.error('deactivatePreisliste:', error.message)
    revalidatePath('/weinhandel/preisliste')
    redirect('/weinhandel/preisliste')
  } catch (err) {
    if (isNextInternalError(err)) throw err
    console.error('deactivatePreisliste unexpected:', err)
    redirect('/weinhandel/preisliste')
  }
}

// ── Position anlegen ──────────────────────────────────────────────────────────

export async function createPosition(preislisteId: string, formData: FormData) {
  try {
    const supabase  = await createSupabaseServerClient()
    const tenantId  = await getTenantId()
    if (!tenantId) { revalidatePath(`/weinhandel/preisliste/${preislisteId}`); return }

    const fuellungId = (formData.get('fuellung_id') as string) || null
    const { error }  = await (supabase.from('preislisten_positionen') as any).insert({
      tenant_id:          tenantId,
      preisliste_id:      preislisteId,
      fuellung_id:        fuellungId,
      name:               formData.get('name') as string,
      jahrgang:           parseInt(formData.get('jahrgang') as string) || null,
      rebsorte:           (formData.get('rebsorte') as string) || null,
      flaschengroesse_ml: parseInt(formData.get('flaschengroesse_ml') as string) || null,
      einheit:            (formData.get('einheit') as string) || 'Flasche',
      preis_brutto:       parseFloat(formData.get('preis_brutto') as string) || null,
      sort_order:         parseInt(formData.get('sort_order') as string) || 0,
    })
    if (error) console.error('createPosition:', error.message)
    revalidatePath(`/weinhandel/preisliste/${preislisteId}`)
  } catch (err) {
    if (isNextInternalError(err)) throw err
    console.error('createPosition unexpected:', err)
    revalidatePath(`/weinhandel/preisliste/${preislisteId}`)
  }
}

// ── Position aktualisieren ────────────────────────────────────────────────────

export async function updatePosition(positionId: string, preislisteId: string, formData: FormData) {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId  = await getTenantId()
    const { error } = await (supabase.from('preislisten_positionen') as any).update({
      name:               formData.get('name') as string,
      jahrgang:           parseInt(formData.get('jahrgang') as string) || null,
      rebsorte:           (formData.get('rebsorte') as string) || null,
      flaschengroesse_ml: parseInt(formData.get('flaschengroesse_ml') as string) || null,
      einheit:            (formData.get('einheit') as string) || 'Flasche',
      preis_brutto:       parseFloat(formData.get('preis_brutto') as string) || null,
      sort_order:         parseInt(formData.get('sort_order') as string) || 0,
      aktualisiert_am:    new Date().toISOString(),
    }).eq('id', positionId).eq('tenant_id', tenantId ?? '')
    if (error) console.error('updatePosition:', error.message)
    revalidatePath(`/weinhandel/preisliste/${preislisteId}`)
  } catch (err) {
    if (isNextInternalError(err)) throw err
    console.error('updatePosition unexpected:', err)
  }
}

// ── Position löschen ──────────────────────────────────────────────────────────

export async function deletePosition(positionId: string, preislisteId: string) {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId  = await getTenantId()
    const { error } = await (supabase.from('preislisten_positionen') as any)
      .delete()
      .eq('id', positionId)
      .eq('tenant_id', tenantId ?? '')
    if (error) console.error('deletePosition:', error.message)
    revalidatePath(`/weinhandel/preisliste/${preislisteId}`)
  } catch (err) {
    if (isNextInternalError(err)) throw err
    console.error('deletePosition unexpected:', err)
  }
}
