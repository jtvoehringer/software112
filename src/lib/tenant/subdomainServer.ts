import 'server-only'
import { headers } from 'next/headers'
import { hostUnterBasis, subdomainAusHost, subdomainBasis, subdomainUrl } from './subdomain'

// KAN-31: Betriebs-Subdomain der laufenden Anfrage (x-forwarded-host bei Vercel, sonst host); null auf der Hauptdomain
// oder ohne NEXT_PUBLIC_S112_SUBDOMAIN_BASIS. Außerhalb eines Requests (Cron, Skripte) ebenfalls null.
export async function aktiveSubdomain(): Promise<string | null> {
  try {
    const kopf = await headers()
    return subdomainAusHost(kopf.get('x-forwarded-host') ?? kopf.get('host'))
  } catch {
    return null
  }
}

/**
 * KAN-31: Ziel nach einem Betriebswechsel – die Subdomain des Betriebs, wenn die Funktion an ist, die Anfrage unter
 * der Basis läuft und der Betrieb eine Subdomain hat; sonst null (bisheriges Verhalten: relativer Pfad, Cookie).
 * Fehler beim Lesen (z. B. Spalte noch nicht da) → null.
 */
export async function subdomainZiel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, pfad: string,
): Promise<string | null> {
  if (!subdomainBasis()) return null
  try {
    const kopf = await headers()
    const host = kopf.get('x-forwarded-host') ?? kopf.get('host')
    if (!hostUnterBasis(host)) return null
    const { data, error } = await supabase.from('tenants').select('subdomain').eq('id', tenantId).maybeSingle()
    const sub = error ? null : ((data as { subdomain?: string | null } | null)?.subdomain ?? null)
    if (sub) return subdomainUrl(sub, pfad)
    // Betrieb ohne Subdomain, aus einem Subdomain-Tab gewählt → Hauptdomain (dort gilt das Cookie), sonst bliebe der
    // Tab über den Host im bisherigen Betrieb
    return subdomainAusHost(host) ? subdomainUrl(null, pfad) : null
  } catch {
    return null
  }
}
