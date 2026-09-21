'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function selectBetriebAction(formData: FormData) {
  const tenantId = formData.get('tenant_id') as string
  if (!tenantId) return

  // Sicherheit: validieren dass der User wirklich Mitglied dieses Tenants ist
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('tenant_id', tenantId).eq('user_id', user.id).eq('aktiv', true).limit(1).maybeSingle()

  if (!(data as R | null)?.tenant_id) return // Kein Zugriff

  await setActiveTenantCookie(tenantId)
  redirect('/dashboard')
}
