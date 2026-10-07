// ── QR-Codes lokal erzeugen (KAN-122 Weinpass, KAN-116 Behälter-Etiketten; 07.10.2026) ──
//
// Paket qrcode (MIT, Entscheidung Jörgen 01.10.2026) statt eines externen QR-Dienstes: Die kodierte URL
// verlässt den Server nicht. SVG für die Anzeige und den Etikettendruck (skaliert verlustfrei), PNG als Data-URL für den
// Download. Fehlerkorrektur „M“ (15 %) – genug für leicht verschmutzte bzw. feuchte Etiketten im Keller.

import 'server-only'
import QRCode from 'qrcode'

const OPTIONEN = { errorCorrectionLevel: 'M' as const, margin: 1 }

/** QR-Code als SVG-Markup (ohne feste Größe – per CSS skalieren) */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { ...OPTIONEN, type: 'svg' })
}

/** QR-Code als PNG-Data-URL (Download), Kantenlänge in Pixeln */
export async function qrPngDataUrl(text: string, breite = 400): Promise<string> {
  return QRCode.toDataURL(text, { ...OPTIONEN, width: breite })
}

/** Öffentliche Basisadresse der App (Weinpass auf der Flasche) */
export function appBasisUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at').replace(/\/+$/, '')
}
