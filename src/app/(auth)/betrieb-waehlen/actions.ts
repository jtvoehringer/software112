'use server'
// schreibsperre-ausnahme-datei: Betrieb wechseln – muss auch aus einem gesperrten Betrieb heraus möglich sein (KAN-5)

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'
import { subdomainZiel } from '@/lib/tenant/subdomainServer'
import { sichererWeiterPfad } from '@/lib/tenant/waechter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function selectBetriebAction(formData: FormData) {
  const tenantId = formData.get('tenant_id') as string
  if (!tenantId) return

  // Sicherheit: validieren dass der User wirklich Mitglied dieses Tenants ist
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // einzelabfrage-ohne-fehler: ein Fehler heißt hier „kein Zugriff“ – die Auswahl bleibt stehen, nichts wird freigegeben
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('tenant_id', tenantId).eq('user_id', user.id).eq('aktiv', true).limit(1).maybeSingle()

  if (!(data as R | null)?.tenant_id) return // Kein Zugriff

  // KAN-31: mit Betriebs-Subdomain dorthin (eigener Tab je Betrieb) – dann bleibt das Cookie der Hauptdomain, wie es ist
  // KAN-78: Ziel aus dem Link (weiter), nur sichere relative Pfade – sonst wie bisher das Dashboard
  const weiter = sichererWeiterPfad(formData.get('weiter') as string | null) ?? '/dashboard'
  const ziel = await subdomainZiel(supabase, tenantId, weiter)
  if (!ziel || ziel.cookie) await setActiveTenantCookie(tenantId)
  redirect(ziel?.url ?? weiter)
}
