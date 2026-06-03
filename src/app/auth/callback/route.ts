import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Auth Callback Route
 * Supabase leitet nach Email-Verification / Magic Link hierher weiter.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const type  = searchParams.get('type')
  const next  = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Passwort-Reset → Passwort setzen
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      // Einladung: entweder type=invite ODER Erstlogin (created_at ≈ last_sign_in_at)
      const { data: { user } } = await supabase.auth.getUser()
      const isInvite = type === 'invite'
      const isFirstLogin = user?.created_at && user?.last_sign_in_at
        ? Math.abs(new Date(user.created_at).getTime() - new Date(user.last_sign_in_at).getTime()) < 15000
        : false
      if (isInvite || isFirstLogin) {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Fehler → zurück zum Login mit Fehlermeldung
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
