import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database.types'

/**
 * Supabase Browser Client
 * Verwende diesen Client in Client Components ('use client')
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
