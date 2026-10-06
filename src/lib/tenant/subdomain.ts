// ── KAN-31 (06.10.2026): Betrieb je Tab über die Subdomain ──────────────────────────────────────────────────────
// gebeshuber.software112.icp-consultants.at und spaetrot.software112.icp-consultants.at laufen parallel im selben
// Browser: Der Betrieb kommt aus dem Host jeder Anfrage (auch Server Actions und /api), nicht aus dem browserweiten
// Cookie s112_active_tenant. getCurrentMembership() prüft die Subdomain gegen die eigenen aktiven Mitgliedschaften
// (tenants.subdomain); auf der Hauptdomain gilt wie bisher das Cookie.
//
// Eingeschaltet nur mit NEXT_PUBLIC_S112_SUBDOMAIN_BASIS (z. B. „software112.icp-consultants.at“, Entscheidung Jörgen
// 06.10.2026; Produktion erst nach der Zahel-Präsentation). Ohne Variable verhält sich alles wie bisher.
// Mit Variable gilt das Anmelde-Cookie für die Basis und alle Subdomains (eigener Name SUBDOMAIN_AUTH_COOKIE – alte,
// nur für einen Host gesetzte Cookies werden ignoriert, alle melden sich einmal neu an).
//
// Isomorph und ohne @/-Importe (node:test, Proxy, Browser).

/** Subdomains, die nie ein Betrieb sein dürfen (gleiche Liste wie der CHECK auf tenants.subdomain) */
export const RESERVIERTE_SUBDOMAINS = ['www', 'app', 'api', 'admin', 'auth', 'login', 'mail', 'smtp', 'staging', 'static', 'status', 'preview'] as const
export const SUBDOMAIN_MUSTER = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
/** Name des Supabase-Anmelde-Cookies im Subdomain-Betrieb */
export const SUBDOMAIN_AUTH_COOKIE = 'sb-s112-auth'

/** Basis aus der Umgebung (klein, ohne Punkt am Rand); leer = Funktion aus */
export function subdomainBasis(wert: string | undefined = process.env.NEXT_PUBLIC_S112_SUBDOMAIN_BASIS): string {
  return (wert ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
}

/** Host ohne Port, klein */
export function hostOhnePort(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '')
}

/** Gültiger Kurzname für tenants.subdomain? (Fehlertext oder null) */
export function subdomainFehler(wert: string): string | null {
  if (!SUBDOMAIN_MUSTER.test(wert)) return 'Nur Kleinbuchstaben, Ziffern und Bindestrich (2–40 Zeichen, nicht am Anfang oder Ende).'
  if (wert.length < 2) return 'Mindestens 2 Zeichen.'
  if ((RESERVIERTE_SUBDOMAINS as readonly string[]).includes(wert)) return `„${wert}“ ist reserviert.`
  return null
}

/** Subdomain des Betriebs aus dem Host, sonst null (Hauptdomain, fremder Host, Funktion aus) */
export function subdomainAusHost(host: string | null | undefined, basis: string = subdomainBasis()): string | null {
  if (!basis) return null
  const h = hostOhnePort(host)
  if (!h.endsWith(`.${basis}`)) return null
  const teil = h.slice(0, -(basis.length + 1))
  if (!teil || teil.includes('.')) return null
  return subdomainFehler(teil) ? null : teil
}

/** Läuft die Anfrage unter der Basis (Hauptdomain oder eine Subdomain)? Nur dann gilt das gemeinsame Cookie. */
export function hostUnterBasis(host: string | null | undefined, basis: string = subdomainBasis()): boolean {
  if (!basis) return false
  const h = hostOhnePort(host)
  return h === basis || h.endsWith(`.${basis}`)
}

/** Cookie-Optionen für @supabase/ssr: gemeinsames Anmelde-Cookie für Basis und Subdomains, sonst Standard */
export function authCookieOptionen(host: string | null | undefined, basis: string = subdomainBasis()):
  { name: string; domain: string; path: string; sameSite: 'lax'; secure: boolean } | undefined {
  if (!hostUnterBasis(host, basis)) return undefined
  return { name: SUBDOMAIN_AUTH_COOKIE, domain: basis, path: '/', sameSite: 'lax', secure: true }
}

/** Absolute Adresse eines Pfads auf der Subdomain des Betriebs (bzw. der Basis, wenn sub null) */
export function subdomainUrl(sub: string | null, pfad: string, basis: string = subdomainBasis()): string | null {
  if (!basis) return null
  const p = pfad.startsWith('/') && !pfad.startsWith('//') ? pfad : '/dashboard'
  return `https://${sub ? `${sub}.` : ''}${basis}${p}`
}
