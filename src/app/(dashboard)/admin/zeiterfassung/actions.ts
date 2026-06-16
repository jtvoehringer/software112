'use server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type AR = Record<string, any>

async function getTenantAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet')
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .in('role', ['tenant_admin', 'system_admin'])
    .single()
  if (!membership) throw new Error('Keine Berechtigung')
  return { supabase, tenantId: membership.tenant_id as string }
}

function parseForm(formData: FormData): AR {
  const stunden       = parseFloat(formData.get('stunden') as string) || 0
  const stundensatz   = parseFloat(formData.get('stundensatz') as string) || 50
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
  }
}

export async function createZeiteintrag(formData: FormData) {
  const { supabase, tenantId } = await getTenantAdmin()
  const { error } = await (supabase.from('zeiterfassung') as any)
    .insert({ ...parseForm(formData), tenant_id: tenantId })
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/zeiterfassung')
}

export async function updateZeiteintrag(id: string, formData: FormData) {
  const { supabase } = await getTenantAdmin()
  const { error } = await (supabase.from('zeiterfassung') as any)
    .update({ ...parseForm(formData), aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/zeiterfassung')
}

export async function deleteZeiteintrag(id: string) {
  const { supabase } = await getTenantAdmin()
  const { error } = await (supabase.from('zeiterfassung') as any)
    .delete().eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/admin/zeiterfassung')
}
