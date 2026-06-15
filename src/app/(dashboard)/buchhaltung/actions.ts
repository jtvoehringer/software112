'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getCtx() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new Error('Kein Mandant')
  return { supabase, tenantId: membership.tenantId }
}

// ── Buchung anlegen ───────────────────────────────────────────────────────────

export async function createEaTransaktion(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const typ          = formData.get('typ') as string
  const datum        = formData.get('datum') as string
  const beschreibung = formData.get('beschreibung') as string
  const kategorie_id = (formData.get('kategorie_id') as string) || null
  const betrag_netto = parseFloat(formData.get('betrag_netto') as string)
  const ust_satz     = parseFloat(formData.get('ust_satz') as string)
  const notizen      = (formData.get('notizen') as string) || null

  if (!typ || !datum || !beschreibung || isNaN(betrag_netto)) {
    return { error: 'Pflichtfelder fehlen' }
  }

  const { error } = await (supabase.from('ea_transaktionen') as any).insert({
    tenant_id: tenantId, typ, datum, beschreibung,
    kategorie_id, betrag_netto, ust_satz: ust_satz || 20,
    notizen,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung')
  return { ok: true }
}

// ── Buchung löschen ───────────────────────────────────────────────────────────

export async function deleteEaTransaktion(id: string) {
  const { supabase, tenantId } = await getCtx()

  const { error } = await (supabase.from('ea_transaktionen') as any)
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('is_locked', false)

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung')
  return { ok: true }
}

// ── Kategorie anlegen ─────────────────────────────────────────────────────────

export async function createEaKategorie(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const { error } = await (supabase.from('ea_kategorien') as any).insert({
    tenant_id:    tenantId,
    typ:          formData.get('typ'),
    name:         formData.get('name'),
    konto_nr:     formData.get('konto_nr') ? parseInt(formData.get('konto_nr') as string) : null,
    ust_satz_std: parseFloat(formData.get('ust_satz_std') as string) || 20,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung/kategorien')
  return { ok: true }
}

// ── Dauerauftrag anlegen ──────────────────────────────────────────────────────

export async function createEaDauerauftrag(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const { error } = await (supabase.from('ea_dauerauftraege') as any).insert({
    tenant_id:          tenantId,
    typ:                formData.get('typ'),
    beschreibung:       formData.get('beschreibung'),
    kategorie_id:       (formData.get('kategorie_id') as string) || null,
    betrag_netto:       parseFloat(formData.get('betrag_netto') as string),
    ust_satz:           parseFloat(formData.get('ust_satz') as string) || 20,
    intervall:          formData.get('intervall'),
    tag_im_monat:       parseInt(formData.get('tag_im_monat') as string) || 1,
    naechste_faelligkeit: formData.get('naechste_faelligkeit'),
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung/dauerauftraege')
  return { ok: true }
}

// ── UVA berechnen + speichern ─────────────────────────────────────────────────

export async function berechneUndSpeichereUva(jahr: number, zeitraum: string) {
  const { supabase, tenantId } = await getCtx()

  // RPC aufrufen
  const { data, error } = await (supabase.rpc as any)('berechne_ea_uva', {
    p_tenant_id: tenantId,
    p_jahr:      jahr,
    p_zeitraum:  zeitraum,
  })

  if (error) return { error: (error as R).message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { error: 'Keine Daten für diesen Zeitraum' }

  // In ea_uva upserten
  const { error: upsertErr } = await (supabase.from('ea_uva') as any).upsert({
    tenant_id:   tenantId,
    jahr:        jahr,
    zeitraum:    zeitraum,
    bmgl_ust_0:  row.bmgl_0  || 0,
    bmgl_ust_10: row.bmgl_10 || 0,
    bmgl_ust_13: row.bmgl_13 || 0,
    bmgl_ust_20: row.bmgl_20 || 0,
    ust_10:      row.ust_10  || 0,
    ust_13:      row.ust_13  || 0,
    ust_20:      row.ust_20  || 0,
    vst_10:      row.vst_10  || 0,
    vst_13:      row.vst_13  || 0,
    vst_20:      row.vst_20  || 0,
  }, { onConflict: 'tenant_id,jahr,zeitraum' })

  if (upsertErr) return { error: (upsertErr as R).message }
  revalidatePath('/buchhaltung/uva')
  return { ok: true, data: row }
}
