'use server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

type AR = Record<string, any>

async function getTenantAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')
  // Aktiv gewählten Betrieb respektieren (wie im Rest der App) statt einer unsortierten
  // Rollenabfrage, die bei mehreren Admin-Mitgliedschaften zudem mit .single() fehlschlagen würde.
  const membership = await getCurrentMembership()
  if (!membership || !['tenant_admin', 'system_admin'].includes(membership.role ?? '')) {
    throw new AktionsFehler('Keine Berechtigung')
  }
  return { supabase, tenantId: membership.tenantId }
}

function parseForm(formData: FormData): AR {
  const stunden       = parseFloat(dezimal(formData.get('stunden') as string)) || 0
  const stundensatz   = parseFloat(dezimal(formData.get('stundensatz') as string)) || 50
  const tokensInput   = formData.get('tokens_input')  as string
  const tokensOutput  = formData.get('tokens_output') as string
  const tokenKosten   = formData.get('token_kosten_euro') as string
  return {
    datum:              formData.get('datum') as string,
    phase:              parseInt(formData.get('phase') as string) || 0,
    beschreibung:       ((formData.get('beschreibung') as string) ?? '').trim(),
    stunden,
    stundensatz,
    tokens_input:       tokensInput  ? parseInt(tokensInput)   : null,
    tokens_output:      tokensOutput ? parseInt(tokensOutput)  : null,
    token_kosten_euro:  tokenKosten  ? parseFloat(tokenKosten) : null,
    lizenzkosten_euro:  (() => { const v = formData.get('lizenzkosten_euro') as string; return v ? parseFloat(v) : null })(),
  }
}

export async function createZeiteintrag(formData: FormData) {
  const { supabase, tenantId } = await getTenantAdmin()
  const { error } = await (supabase.from('zeiterfassung') as any)
    .insert({ ...parseForm(formData), tenant_id: tenantId })
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/admin/zeiterfassung')
}

export async function updateZeiteintrag(id: string, formData: FormData) {
  const { supabase, tenantId } = await getTenantAdmin()
  const { error } = await (supabase.from('zeiterfassung') as any)
    .update({ ...parseForm(formData), aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/admin/zeiterfassung')
}

export async function deleteZeiteintrag(id: string) {
  const { supabase, tenantId } = await getTenantAdmin()
  const { error } = await (supabase.from('zeiterfassung') as any)
    .delete().eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/admin/zeiterfassung')
}
