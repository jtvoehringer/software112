// ── Farbkontrast nach WCAG 2.1 (Barrierefreiheit B2, 23.9.2026) ──────────────
// Bewusst ohne Server-Imports – wird im Layout (Server) und im Branding-Dialog (Client) genutzt.

function kanal(c: number) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function leuchtdichte(hex: string): number | null {
  const c = rgb(hex)
  if (!c) return null
  return 0.2126 * kanal(c[0]) + 0.7152 * kanal(c[1]) + 0.0722 * kanal(c[2])
}

/** Kontrastverhältnis zweier Farben (1 … 21); null bei ungültiger Farbe */
export function kontrast(a: string, b: string): number | null {
  const la = leuchtdichte(a), lb = leuchtdichte(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG AA für normale Schrift */
export const KONTRAST_AA = 4.5

/**
 * Aktionsfarbe so weit abdunkeln (bzw. bei dunkler Schrift aufhellen), dass die Schriftfarbe
 * darauf mindestens 4,5 : 1 (bzw. `ziel`) erreicht. Ist der Kontrast schon ausreichend, bleibt die Farbe
 * unverändert. Der Farbton bleibt erhalten – nur die Helligkeit ändert sich.
 */
export function barrierefreieAktionsfarbe(flaeche: string, schrift: string, ziel = KONTRAST_AA): string {
  const k = kontrast(flaeche, schrift)
  const c = rgb(flaeche)
  if (k === null || !c || k >= ziel) return flaeche
  const schriftHell = (leuchtdichte(schrift) ?? 1) > 0.5
  for (let i = 1; i <= 100; i++) {
    const t = i / 100
    const kanaele = c.map(v => {
      const neu = schriftHell ? v * (1 - t) : v + (255 - v) * t
      return Math.max(0, Math.min(255, Math.round(neu)))
    })
    const x = '#' + kanaele.map(v => v.toString(16).padStart(2, '0')).join('')
    if ((kontrast(x, schrift) ?? 0) >= ziel) return x.toUpperCase()
  }
  return flaeche
}

// ── Kopfleiste im Betriebs-CD (KAN-164, 29.09.2026) ──────────────────────────
/** Standardfarben aus DEFAULT_BRANDING (layout.tsx) – damit bleibt die Kopfleiste im CD-Blau */
export const STANDARD_PRIMAERFARBE = '#4F86D6'
export const STANDARD_SEKUNDAERFARBE = '#FFFFFF'
/** CD-Blau der Kopfleiste (s112-blue-700, KAN-142) */
export const CD_KOPFLEISTE = '#2F63AC'
/** Die Kopfleiste zeigt Text auch mit /85 Deckkraft – daher mehr Reserve als 4,5 : 1 */
export const KONTRAST_KOPFLEISTE = 5.5

const gleich = (a: string | null | undefined, b: string) => (a ?? '').trim().toUpperCase() === b

/**
 * Hintergrund und Schrift der Kopfleiste. Mit den Standardfarben CD-Blau/Weiß wie bisher;
 * mit eigenen Farben die Primärfarbe (abgedunkelt bzw. aufgehellt, bis die Sekundärfarbe
 * darauf mind. 5,5 : 1 erreicht) und die Sekundärfarbe als Schrift. Reicht auch das nicht
 * (ungültige Farbe, unerreichbarer Kontrast), wird die Schrift Weiß bzw. Schwarz.
 */
export function kopfleistenFarben(primaer: string | null | undefined, sekundaer: string | null | undefined): { flaeche: string; schrift: string } {
  const standard = { flaeche: CD_KOPFLEISTE, schrift: '#FFFFFF' }
  if (gleich(primaer, STANDARD_PRIMAERFARBE) && gleich(sekundaer, STANDARD_SEKUNDAERFARBE)) return standard
  if (!primaer || !rgb(primaer)) return standard
  const p = primaer.trim()
  let schrift = sekundaer && rgb(sekundaer) ? sekundaer.trim().toUpperCase() : '#FFFFFF'
  let flaeche = barrierefreieAktionsfarbe(p, schrift, KONTRAST_KOPFLEISTE).toUpperCase()
  if ((kontrast(flaeche, schrift) ?? 0) < KONTRAST_KOPFLEISTE) {
    // Sekundärfarbe unbrauchbar (z. B. Rot auf Rot): Weiß oder Schwarz – damit ist das Ziel immer erreichbar
    schrift = (kontrast(p, '#FFFFFF') ?? 0) >= (kontrast(p, '#000000') ?? 0) ? '#FFFFFF' : '#000000'
    flaeche = barrierefreieAktionsfarbe(p, schrift, KONTRAST_KOPFLEISTE).toUpperCase()
  }
  return { flaeche, schrift }
}

/** „#RRGGBB“ → „R G B“ für CSS-Variablen mit Deckkraft (rgb(var(--x) / 0.85)); null bei ungültiger Farbe */
export function rgbKanaele(hex: string): string | null {
  const c = rgb(hex)
  return c ? c.join(' ') : null
}
