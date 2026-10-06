import { cache } from 'react'
import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { authCookieOptionen } from '@/lib/tenant/subdomain'
import type { Database } from '@/lib/types/database.types'

/**
 * Supabase Server Client
 * Verwende diesen Client in Server Components, Route Handlers und Server Actions
 *
 * Performance (17.9.2026): pro Request wird nur EIN Client erzeugt (React cache),
 * und auth.getUser() - ein Netz-Roundtrip zum Auth-Server je Aufruf - wird auf
 * diesem Client dedupliziert: Layout + Seite + Helfer riefen es 4-6× pro
 * Seitenaufruf. Nach signIn/signOut/setSession wird der Merker verworfen.
 */
export const createSupabaseServerClient = cache(async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  // KAN-31: unter der Subdomain-Basis gemeinsames Anmelde-Cookie für alle Betriebs-Subdomains (sonst Standard)
  const kopf = await headers()
  const cookieOptions = authCookieOptionen(kopf.get('x-forwarded-host') ?? kopf.get('host'))

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(cookieOptions ? { cookieOptions } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            )
          } catch {
            // Server Component – Cookies können hier nicht gesetzt werden.
            // Die Middleware übernimmt das Session-Refresh.
          }
        },
      },
    }
  )

  const auth = client.auth as unknown as Record<string, (...a: unknown[]) => unknown>
  const getUser = auth.getUser.bind(client.auth) as typeof client.auth.getUser
  let merker: ReturnType<typeof client.auth.getUser> | null = null
  client.auth.getUser = ((jwt?: string) => {
    if (jwt) return getUser(jwt)
    if (!merker) merker = getUser().then(r => { if (r.error) merker = null; return r })
    return merker
  }) as typeof client.auth.getUser
  for (const m of ['signInWithPassword', 'signInWithOAuth', 'signInWithOtp', 'signOut', 'setSession', 'exchangeCodeForSession', 'refreshSession', 'verifyOtp', 'updateUser']) {
    const orig = auth[m]
    if (typeof orig !== 'function') continue
    auth[m] = (...args: unknown[]) => { merker = null; return orig.apply(client.auth, args) }
  }
  return client
})
