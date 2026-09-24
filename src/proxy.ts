import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hatBestaetigtenFaktor } from '@/lib/auth/mfa'

// Routen die OHNE Login zugänglich sind
// Öffentlich ohne Anmeldung. /signup und /newsletter fehlten bis 23.9.2026 – Registrierung und
// Newsletter-Anmeldung/-Bestätigung/-Abmeldung leiteten Besucher auf /login um.
// Die früheren /api/…-Einträge (u. a. '/api/export/') sind entfernt (KAN-54): Der Matcher
// unten schließt /api ohnehin aus – API-Routen prüfen Anmeldung und Zwei-Faktor-Stufe
// selbst (pruefeZweiFaktor, src/lib/api/zweiFaktor.ts).
const PUBLIC_ROUTES = ['/.well-known/', '/barrierefreiheit', '/signup', '/newsletter', '/login', '/register', '/auth/callback', '/auth/invite', '/auth/update-password']

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          )
        },
      },
    }
  )

  // Session auffrischen – WICHTIG: kein Code zwischen createServerClient und getUser!
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route))

  // Nicht eingeloggt + geschützte Route → zum Login
  if (!user && !isPublicRoute && pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Zwei-Faktor (Sicherheits-Welle 2, S3): Wer einen Authenticator eingerichtet hat, muss
  // nach der Passwort-Anmeldung erst den Code eingeben (Stufe aal2), bevor irgendeine
  // Seite erreichbar ist. Die Stufe steht im signierten Zugriffstoken (kein weiterer
  // Netzwerkaufruf); ob ein Faktor eingerichtet ist, kommt aus dem von getUser() geprüften
  // User – nicht aus aal.nextLevel, das die unsignierte Faktorenliste im Cookie liest
  // (KAN-54, siehe lib/auth/mfa.ts). API-Routen: pruefeZweiFaktor(), Matcher schließt /api aus.
  if (user && pathname !== '/zwei-faktor' && !pathname.startsWith('/auth/') && !pathname.startsWith('/.well-known/') && pathname !== '/login') {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (hatBestaetigtenFaktor(user) && aal?.currentLevel !== 'aal2') {
      const url = request.nextUrl.clone()
      url.pathname = '/zwei-faktor'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  // Eingeloggt + Login-Seite → zum Dashboard
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
