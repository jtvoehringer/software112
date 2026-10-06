import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database.types'
import { authCookieOptionen } from '@/lib/tenant/subdomain'

/**
 * Supabase Browser Client
 * Verwende diesen Client in Client Components ('use client')
 */
export function createSupabaseBrowserClient() {
  // KAN-31: gleiches Anmelde-Cookie wie Server und Proxy (Basis + Betriebs-Subdomains)
  const cookieOptions = typeof window === 'undefined' ? undefined : authCookieOptionen(window.location.host)
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookieOptions ? { cookieOptions } : undefined
  )
}
