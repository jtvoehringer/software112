import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Künftig: experimental.ppr für partial pre-rendering aktivieren
  // @react-pdf/renderer muss als "externes" Server-Paket behandelt werden,
  // sonst bündelt Next.js es beim Production-Build falsch (Symptom: "Font
  // family not registered: Arial, Helvetica, sans-serif" beim PDF-Rendern
  // in der Rechnungsversand-Route, obwohl lokal/im Sandbox-Test alles
  // funktioniert) – offizielle Empfehlung von react-pdf.org/compatibility.
  serverExternalPackages: ['@react-pdf/renderer'],
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
