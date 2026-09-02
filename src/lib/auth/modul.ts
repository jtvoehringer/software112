import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

// Zuschaltbare Module (boolean-Flags auf tenant_einstellungen, Toggle in
// Administration → Mandanten). Die Sidebar blendet die Menüpunkte aus, diese
// Server-Guards sichern zusätzlich die Routen selbst ab - ein direkter Aufruf
// per URL landet ohne Freischaltung auf dem Dashboard (gleiches Muster wie die
// inline-Prüfungen der E&A-Seiten, hier nur einmal zentral).
export type ModulFlag = 'modul_ea' | 'modul_sumup' | 'modul_export' | 'modul_controlling'

export async function hatModul(flag: ModulFlag): Promise<boolean> {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return false
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_einstellungen') as any)
    .select(flag).eq('tenant_id', membership.tenantId).maybeSingle()
  return !!(data as Record<string, unknown> | null)?.[flag]
}

// In Server-Layouts/-Pages: leitet auf /dashboard um, wenn das Modul für den
// aktiven Mandanten nicht freigeschaltet ist.
export async function requireModul(flag: ModulFlag): Promise<void> {
  if (!(await hatModul(flag))) redirect('/dashboard')
}
