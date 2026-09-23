import type { NextConfig } from 'next'

// ── Sicherheits-Header (Sicherheits-Welle 2, Befund S6, 23.9.2026) ───────────
// Durchgesetzt: HSTS, Einbettungsschutz, nosniff, Referrer, Berechtigungen.
// Content-Security-Policy vorerst nur im Beobachtungsmodus (Report-Only): Verstöße
// landen über /api/csp-bericht im Systembericht; erst wenn dort 2 Wochen Ruhe ist,
// wird sie scharf geschaltet (Header-Name ohne „-Report-Only“).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // Logos der Betriebe (beliebige Hosts), Kartenkacheln basemap.at, QR-Codes, Supabase-Speicher
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://mapsneu.wien.gv.at",
  "frame-src 'self' blob: https://*.supabase.co",
  "frame-ancestors 'self'",
  "form-action 'self' https://login.microsoftonline.com https://checkout.stripe.com",
  "base-uri 'self'",
  "object-src 'none'",
  'report-uri /api/csp-bericht',
].join('; ')

const SICHERHEITS_HEADER = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Kamera: Visitenkarte scannen; Mikrofon: bot:112 Sprachsteuerung; Standort: Rieden
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()' },
  { key: 'Content-Security-Policy-Report-Only', value: CSP },
]

const nextConfig: NextConfig = {
  // Künftig: experimental.ppr für partial pre-rendering aktivieren
  // @react-pdf/renderer muss als "externes" Server-Paket behandelt werden,
  // sonst bündelt Next.js es beim Production-Build falsch (Symptom: "Font
  // family not registered: Arial, Helvetica, sans-serif" beim PDF-Rendern
  // in der Rechnungsversand-Route, obwohl lokal/im Sandbox-Test alles
  // funktioniert) – offizielle Empfehlung von react-pdf.org/compatibility.
  serverExternalPackages: ['@react-pdf/renderer'],
  async headers() {
    return [{ source: '/:path*', headers: SICHERHEITS_HEADER }]
  },
  // Router-Cache (17.9.2026): dynamische Seiten nie aus dem Client-Cache
  // wiederverwenden, vorab geladene statische Teile höchstens 30 s - zusammen
  // mit components/AutoRefresh.tsx (refresh bei Fokus/Zurück/Intervall), damit
  // Änderungen ohne „Seite neu laden“ sichtbar werden.
  experimental: {
    staleTimes: { dynamic: 0, static: 30 },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',  // Multi-Tenant: beliebige externe Logo-URLs erlauben
      },
    ],
  },
}

export default nextConfig
