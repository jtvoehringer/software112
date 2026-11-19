// ── Mitscrollen am Rand beim Ziehen (KAN-469, UAT 19.11.2026) ─────────────────────────────────────────────────
//
// Wer im Kellerplan ein Gebinde mit dem Zeiger zieht (Pointer-Ereignisse, touch-action: none), bekommt vom Browser
// kein automatisches Scrollen – Ziele unterhalb des sichtbaren Bereichs waren nicht erreichbar. Nähert sich der Zeiger
// dem Rand des scrollenden Rahmens, scrollt die Seite mit; je näher am Rand, desto schneller.
// Ohne '@/'-Importe und ohne DOM-Zugriff beim Laden (node:test).

/** Breite der Zone am Rand, in der gescrollt wird (px) */
export const RAND_ZONE = 72
/** höchste Geschwindigkeit (px je Bild, also etwa je 1/60 s) */
export const RAND_TEMPO = 22

/**
 * Scroll-Schritt für eine Achse: negativ = zum Anfang (oben/links), positiv = zum Ende, 0 = nicht scrollen.
 * `pos` ist die Zeigerposition, `anfang`/`ende` die sichtbaren Kanten des Rahmens (dieselben Koordinaten).
 * In der Zone wächst das Tempo gleichmäßig bis RAND_TEMPO an der Kante (und bleibt dort, auch außerhalb).
 */
export function randTempo(pos: number, anfang: number, ende: number, zone = RAND_ZONE, max = RAND_TEMPO): number {
  const laenge = ende - anfang
  if (!(laenge > 0) || !Number.isFinite(pos)) return 0
  const z = Math.min(zone, laenge / 4)   // kleiner Rahmen: die Mitte bleibt frei
  if (pos < anfang + z) return -Math.max(1, Math.ceil(max * Math.min(1, (anfang + z - pos) / z)))
  if (pos > ende - z) return Math.max(1, Math.ceil(max * Math.min(1, (pos - (ende - z)) / z)))
  return 0
}

/** Der nächste Vorfahre, der senkrecht scrollt (overflow-y auto/scroll und mehr Inhalt als Höhe); sonst das Dokument */
export function scrollEltern(el: Element | null): Element | null {
  if (typeof document === 'undefined') return null
  for (let e = el?.parentElement ?? null; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e
  }
  return document.scrollingElement
}
