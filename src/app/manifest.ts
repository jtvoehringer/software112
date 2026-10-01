import type { MetadataRoute } from 'next'

// KAN-179 (01.10.2026): software:112 als installierbare App (PWA) – Android/Chrome „App installieren“,
// iOS „Zum Home-Bildschirm“ (dafür zusätzlich appleWebApp in app/layout.tsx). Ausgeliefert als
// /manifest.webmanifest; der Proxy-Matcher (src/proxy.ts) nimmt die Datei aus, sonst landete sie auf dem Login.
// Bewusst ohne Mandantendaten: Name, Farben und Icons sind für alle Betriebe gleich.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'software:112',
    short_name: 'software:112',
    description: 'Vom Rebstock bis zur Rechnung. Alles in einem System.',
    lang: 'de-AT',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F7F8FA',
    theme_color: '#4F86D6',
    icons: [
      { src: '/favicon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/favicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Schnellzugriffe (langes Drücken auf das App-Symbol, Android)
    shortcuts: [
      { name: 'Lese erfassen', url: '/erntemeldung', icons: [{ src: '/favicon-192.png', sizes: '192x192' }] },
      { name: 'Maßnahme erfassen', url: '/behandlungen/neu', icons: [{ src: '/favicon-192.png', sizes: '192x192' }] },
      { name: 'Kellerbuch', url: '/kellerbuch', icons: [{ src: '/favicon-192.png', sizes: '192x192' }] },
    ],
  }
}
