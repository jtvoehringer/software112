import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'
import { sichererWeiterPfad } from '@/lib/tenant/waechter'
import { subdomainZiel } from '@/lib/tenant/subdomainServer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// GET /auth/betrieb?tenant_id=…[&weiter=/pfad] – aktiven Betrieb setzen und weiterleiten.
// Cookies dürfen in Next nur in Server Actions oder Route Handlern geschrieben
// werden; /betrieb-waehlen leitet bei genau einem Betrieb hierher um, statt das
// Cookie beim Rendern zu setzen (Fix für „Cookies can only be modified …").
// weiter (KAN-30): Rücksprung nach dem Wechsel – „Zurück zu … wechseln“ im Betriebs-Wächter
// und „Neuer Mandant“ (admin/mandanten). Nur eigene relative Pfade (sichererWeiterPfad, zusätzlich
// hier gegen die Herkunft geprüft), sonst wie bisher /dashboard.
// Von fremden Seiten ausgelöste Aufrufe (Sec-Fetch-Site cross-site/same-site, z. B. ein Link in
// einer E-Mail) wechseln wie bisher, ignorieren aber weiter: ein fremder Link soll nach dem Wechsel
// nicht direkt in ein Formular springen. Nicht ganz sperren: der erste Aufruf nach einer
// Einladung (Mail → /auth/callback → /betrieb-waehlen → hierher) zählt als cross-site, weil der
// Browser die ganze Weiterleitungskette bewertet – eine Sperre ergäbe dort eine Schleife.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tenantId = searchParams.get('tenant_id')
  const herkunft = request.headers.get('sec-fetch-site')
  const fremdAusgeloest = herkunft === 'cross-site' || herkunft === 'same-site'
  const weiter = (!fremdAusgeloest && sichererWeiterPfad(searchParams.get('weiter'))) || '/dashboard'

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !tenantId) return NextResponse.redirect(`${origin}/login`)

  // Sicherheit: nur eigene, aktive Mitgliedschaften
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('tenant_id', tenantId).eq('user_id', user.id).eq('aktiv', true)
    .limit(1).maybeSingle()
  if (!(data as R | null)?.tenant_id) return NextResponse.redirect(`${origin}/betrieb-waehlen`)

  // KAN-31: mit Betriebs-Subdomain dorthin (weiter bleibt ein geprüfter relativer Pfad) – dann bleibt das Cookie der
  // Hauptdomain, wie es ist; sonst wie bisher
  const subZiel = await subdomainZiel(supabase, tenantId, weiter)
  if (!subZiel || subZiel.cookie) await setActiveTenantCookie(tenantId)
  if (subZiel) return NextResponse.redirect(subZiel.url)
  const ziel = new URL(weiter, origin)
  return NextResponse.redirect(ziel.origin === origin ? ziel : new URL('/dashboard', origin))
}
