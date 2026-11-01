import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'
import { mitWeiter, sichererWeiterPfad } from '@/lib/tenant/waechter'
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
// KAN-399: ohne tenant_id (direkt nach der Anmeldung bzw. dem zweiten Faktor) wählt der Handler bei genau einem aktiven
// Betrieb selbst – eine Umleitung über /betrieb-waehlen weniger; bei mehreren Betrieben geht es zur Auswahl. Der zweite
// Faktor wird hier nicht geprüft (/auth/ ist im Proxy ausgenommen), aber am Ziel: der Proxy leitet dort auf /zwei-faktor.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  let tenantId = searchParams.get('tenant_id')
  const herkunft = request.headers.get('sec-fetch-site')
  const fremdAusgeloest = herkunft === 'cross-site' || herkunft === 'same-site'
  const weiter = (!fremdAusgeloest && sichererWeiterPfad(searchParams.get('weiter'))) || '/dashboard'

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)
  if (!tenantId) {
    tenantId = await einzigerBetrieb(supabase, user.id)
    if (!tenantId) return NextResponse.redirect(new URL(mitWeiter('/betrieb-waehlen', searchParams.get('weiter')), origin))
  }

  // Sicherheit: nur eigene, aktive Mitgliedschaften
  // einzelabfrage-ohne-fehler: ein Fehler heißt hier „kein Zugriff“ – zurück zur Betriebswahl, nichts wird freigegeben
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

/** Der einzige aktive Betrieb des Benutzers; null = keiner, mehrere oder Lesefehler (dann entscheidet /betrieb-waehlen) */
async function einzigerBetrieb(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string): Promise<string | null> {
  // abfrage-ohne-fehler: Fehler und „mehrere“ führen beide zur Betriebsauswahl, die den Fehler selbst anzeigt
  const { data } = await supabase.from('tenant_memberships')
    .select('tenant_id').eq('user_id', userId).eq('aktiv', true).order('tenant_id').limit(2)
  const zeilen = (data ?? []) as R[]
  return zeilen.length === 1 ? String(zeilen[0].tenant_id) : null
}
