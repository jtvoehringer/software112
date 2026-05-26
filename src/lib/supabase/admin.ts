import { createClient } from '@supabase/supabase-js'

/**
 * Supabase Admin Client mit Service-Role-Key.
 * NUR in Server Components / Server Actions verwenden — niemals im Browser!
 * Ermöglicht Zugriff auf auth.admin API (User-Emails, User-Management).
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
