import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sichererWeiterPfad } from '@/lib/tenant/waechter'
import { zielFuerTokenHash } from '@/lib/auth/authLink'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const type  = searchParams.get('type')
  // KAN-257: nur ein relativer Pfad der App – `${origin}${next}` mit next=„@boese.example“ bzw. „.boese.example“ führte
  // nach dem Login auf eine fremde Seite (offene Weiterleitung)
  const next  = sichererWeiterPfad(searchParams.get('next')) ?? '/dashboard'

  // KAN-465: Link mit Token-Hash (neue E-Mail-Vorlagen) – hier NICHT einlösen: Ein Abruf (GET) kann vom Mailprogramm
  // oder Virenscanner kommen und würde den Link verbrauchen. Weiter auf die Seite, auf der er per Klick eingelöst wird.
  const tokenHash = (searchParams.get('token_hash') ?? '').trim()
  if (tokenHash) {
    const ziel = new URL(zielFuerTokenHash(type), origin)
    ziel.searchParams.set('token_hash', tokenHash)
    ziel.searchParams.set('type', type ?? 'invite')
    return NextResponse.redirect(ziel)
  }

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Passwort-Reset
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      // Einladung: type=invite ODER email_confirmed_at wurde gerade gesetzt (≤ 30 Sek.)
      const { data: { user } } = await supabase.auth.getUser()
      const isInvite = type === 'invite'
      const confirmedMs = user?.email_confirmed_at
        ? new Date(user.email_confirmed_at).getTime()
        : 0
      const isJustConfirmed = confirmedMs > 0 && (Date.now() - confirmedMs) < 30000
      if (isInvite || isJustConfirmed) {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // KAN-465: Fehler bleibt sichtbar – nie /login?error=… (die Anmeldeseite zeigte ihn nicht an und leitet bei offener
  // Sitzung ins Dashboard des angemeldeten, womöglich anderen Kontos).
  const zweck = type === 'recovery' ? 'passwort' : type === 'invite' ? 'einladung' : 'anmeldung'
  if (!code && zweck !== 'anmeldung') {
    // Ohne Code: Supabase hat die Sitzung bzw. den Fehler im Fragment (#access_token=… / #error=…) oder als ?error=…
    // geliefert. Das Fragment sieht nur der Browser – er nimmt es bei der Weiterleitung mit; die Seite des Zwecks wertet
    // es aus (Sitzung setzen bzw. Meldung mit Ausweg).
    const ziel = new URL(zielFuerTokenHash(type), origin)
    for (const k of ['error', 'error_code', 'error_description']) {
      const v = searchParams.get(k)
      if (v) ziel.searchParams.set(k, v)
    }
    return NextResponse.redirect(ziel)
  }
  return NextResponse.redirect(`${origin}/auth/fehler?zweck=${zweck}`)
}
