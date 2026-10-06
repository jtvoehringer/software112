/**
 * Aktiver Betrieb – Cookie-Helper
 * Speichert den aktiven Tenant als HttpOnly-Cookie.
 * Wird von getCurrentMembership() und getTenantId() gelesen.
 */
import { cookies, headers } from 'next/headers'
import { hostUnterBasis, subdomainBasis } from '@/lib/tenant/subdomain'

const COOKIE = 's112_active_tenant'
// KAN-31: im Subdomain-Betrieb (NEXT_PUBLIC_S112_SUBDOMAIN_BASIS) gilt das Cookie für die Basis und alle Subdomains,
// unter eigenem Namen (alte, nur für einen Host gesetzte Cookies bleiben unbeachtet). Auf einer Betriebs-Subdomain
// entscheidet ohnehin der Host (getCurrentMembership); das Cookie bestimmt nur den Betrieb der Hauptdomain – so kann
// man aus einem Subdomain-Tab einen Betrieb ohne Subdomain wählen, und er kommt auf der Hauptdomain an.
const COOKIE_SUBDOMAIN = 's112_aktiver_betrieb'
// 400 Tage (Höchstwert der Browser) statt bisher 30 (KAN-30, 25.09.2026): Die Laufzeit zählte
// ab dem letzten Wechsel. Wer länger nur in einem Betrieb arbeitete, fiel nach Ablauf still auf
// den ältesten Betrieb zurück (getCurrentMembership-Fallback) – der Betriebs-Wächter sperrte dann
// einen einzelnen offenen Tab. Bewusst KEINE gleitende Verlängerung im Proxy: der schriebe den
// Wert der jeweiligen Anfrage zurück und könnte einen gleichzeitigen Wechsel in einem anderen
// Tab wieder überschreiben. Das Cookie enthält nur die Betriebs-ID; jede Nutzung prüft sie gegen
// die eigenen, aktiven Mitgliedschaften, jede Anmeldung setzt sie über /betrieb-waehlen neu.
const MAX_AGE = 60 * 60 * 24 * 400

async function cookieArt(): Promise<{ name: string; domain?: string }> {
  try {
    const kopf = await headers()
    if (hostUnterBasis(kopf.get('x-forwarded-host') ?? kopf.get('host'))) return { name: COOKIE_SUBDOMAIN, domain: subdomainBasis() }
  } catch { /* außerhalb eines Requests */ }
  return { name: COOKIE }
}

export async function getActiveTenantCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get((await cookieArt()).name)?.value ?? null
}

export async function setActiveTenantCookie(tenantId: string): Promise<void> {
  const store = await cookies()
  const art = await cookieArt()
  store.set(art.name, tenantId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    ...(art.domain ? { domain: art.domain, secure: true } : {}),
  })
}

export async function clearActiveTenantCookie(): Promise<void> {
  const store = await cookies()
  const art = await cookieArt()
  if (art.domain) store.set(art.name, '', { path: '/', domain: art.domain, maxAge: 0 })
  else store.delete(art.name)
}
