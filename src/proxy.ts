import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hatBestaetigtenFaktor } from '@/lib/auth/mfa'
import { authCookieOptionen } from '@/lib/tenant/subdomain'
import { elabelRewritePfad } from '@/lib/elabel/oeffentlich'
import { sichererWeiterPfad, weiterFuerUmleitung } from '@/lib/tenant/waechter'

// Routen die OHNE Login zugänglich sind
// Öffentlich ohne Anmeldung. /signup und /newsletter fehlten bis 23.9.2026 – Registrierung und
// Newsletter-Anmeldung/-Bestätigung/-Abmeldung leiteten Besucher auf /login um.
// Die früheren /api/…-Einträge (u. a. '/api/export/') sind entfernt (KAN-54): Der Matcher
// unten schließt /api ohnehin aus – API-Routen prüfen Anmeldung und Zwei-Faktor-Stufe
// selbst (pruefeZweiFaktor, src/lib/api/zweiFaktor.ts).
// KAN-217 (07.10.2026): '/w/' (Weinpass – war nie öffentlich, der QR-Code auf der Flasche leitete auf den Login um) und
// '/e/' (E-Label) sind öffentliche Seiten für Konsumenten; sie lesen nur Freigegebenes per Service-Role.
const PUBLIC_ROUTES = ['/.well-known/', '/barrierefreiheit', '/signup', '/newsletter', '/login', '/register', '/auth/callback', '/auth/invite', '/auth/update-password', '/w/', '/e/']

export async function proxy(request: NextRequest) {
  // KAN-217: Anfragen an die E-Label-Domain (NEXT_PUBLIC_ELABEL_HOST) zeigen die öffentliche Seite /e/<code> – ohne Anmeldung
  const elabelPfad = elabelRewritePfad(request.headers.get('x-forwarded-host') ?? request.headers.get('host'), request.nextUrl.pathname)
  if (elabelPfad) {
    const url = request.nextUrl.clone()
    url.pathname = elabelPfad
    return NextResponse.rewrite(url)
  }

  let supabaseResponse = NextResponse.next({ request })
  // KAN-31: gemeinsames Anmelde-Cookie für Basis und Betriebs-Subdomains (nur mit NEXT_PUBLIC_S112_SUBDOMAIN_BASIS)
  const cookieOptions = authCookieOptionen(request.headers.get('x-forwarded-host') ?? request.headers.get('host'))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(cookieOptions ? { cookieOptions } : {}),
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

  // KAN-78: Ziel der Anfrage für den Rücksprung nach Login, Zwei-Faktor und Betriebswahl (nur relative Pfade)
  const umleiten = (ziel: string) => {
    const url = request.nextUrl.clone()
    url.pathname = ziel
    url.search = ''
    const weiter = weiterFuerUmleitung(pathname, request.nextUrl.search)
    if (weiter) url.searchParams.set('weiter', weiter)
    return NextResponse.redirect(url)
  }

  // Nicht eingeloggt + geschützte Route → zum Login
  if (!user && !isPublicRoute && pathname !== '/') {
    return umleiten('/login')
  }

  // Zwei-Faktor (Sicherheits-Welle 2, S3): Wer einen Authenticator eingerichtet hat, muss
  // nach der Passwort-Anmeldung erst den Code eingeben (Stufe aal2), bevor irgendeine
  // Seite erreichbar ist. Die Stufe steht im signierten Zugriffstoken (kein weiterer
  // Netzwerkaufruf); ob ein Faktor eingerichtet ist, kommt aus dem von getUser() geprüften
  // User – nicht aus aal.nextLevel, das die unsignierte Faktorenliste im Cookie liest
  // (KAN-54, siehe lib/auth/mfa.ts). API-Routen: pruefeZweiFaktor(), Matcher schließt /api aus.
  if (user && pathname !== '/zwei-faktor' && !pathname.startsWith('/auth/') && !pathname.startsWith('/.well-known/') && pathname !== '/login'
      && !pathname.startsWith('/w/') && !pathname.startsWith('/e/')) {   // KAN-217: öffentliche Seiten auch ohne zweiten Faktor
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (hatBestaetigtenFaktor(user) && aal?.currentLevel !== 'aal2') {
      return umleiten('/zwei-faktor')
    }
  }

  // Eingeloggt + Login-Seite → zum Ziel aus weiter (KAN-78), sonst zum Dashboard
  if (user && pathname === '/login') {
    const ziel = sichererWeiterPfad(request.nextUrl.searchParams.get('weiter')) ?? '/dashboard'
    return NextResponse.redirect(new URL(ziel, request.nextUrl.origin))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // KAN-179: manifest.webmanifest ohne Anmeldung abrufbar (sonst Umleitung auf den Login – App nicht installierbar);
    // KAN-180: ebenso der Service Worker (sw.js) und seine statische Offline-Seite (offline.html)
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js$|offline\\.html$|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
