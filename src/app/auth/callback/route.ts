import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Auth Callback Route
 * Supabase leitet nach Email-Verification / Magic Link hierher weiter.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const next  = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Fehler → zurück zum Login mit Fehlermeldung
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
