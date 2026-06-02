import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ── Öffentliche Routen (kein Login nötig) ─────────────────────────────────────
const PUBLIC_ROUTES = [
  '/login', '/register', '/auth/callback',
  '/api/email/', '/api/ki-abfrage', '/api/besuchsplanung',
  '/api/export/', '/api/verkauf-stammdaten',
]

// ── Rate Limiting (In-Memory, für Single-Instance Vercel ausreichend) ─────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string, route: string, maxReq: number, windowMs: number): boolean {
  const key  = `${ip}:${route}`
  const now  = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= maxReq) return false
  entry.count++
  return true
}

// ── Middleware ────────────────────────────────────────────────────────────────
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? request.headers.get('x-real-ip') ?? '127.0.0.1'

  // CORS: API-Routes nur von erlaubten Origins
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin') ?? ''
    const host   = request.headers.get('host') ?? ''
    const allowed = [`https://${host}`, 'http://localhost:3000', 'https://software112.icp-consultants.at']
    if (origin && !allowed.some(o => origin === o) && !origin.endsWith('.vercel.app')) {
      return NextResponse.json({ fehler: 'Nicht erlaubt' }, { status: 403 })
    }
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : '',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      })
    }
  }

  // Rate Limits: [route-prefix, max/min, window-ms]
  const limits: [string, number, number][] = [
    ['/api/ki-abfrage',  10,  60_000],
    ['/api/auth/m365',   20,  60_000],
    ['/api/nachrichten', 60,  60_000],
    ['/api/email',       30,  60_000],
    ['/api/weinexport',  30,  60_000],
    ['/api/export',      10,  60_000],
  ]
  for (const [route, max, window] of limits) {
    if (pathname.startsWith(route)) {
      if (!checkRateLimit(ip, route, max, window)) {
        return NextResponse.json(
          { fehler: 'Zu viele Anfragen. Bitte kurz warten.' },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      }
      break
    }
  }

  // Supabase Session + Auth-Schutz
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2] | undefined)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const isPublic = PUBLIC_ROUTES.some(r => pathname.startsWith(r))

  // Nicht eingeloggt + geschützte Route → Login
  if (!user && !isPublic && pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Eingeloggt + Login-Seite → Dashboard
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Security Headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
