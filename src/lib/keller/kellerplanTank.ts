// ── Kellerplan: Tank mit Kammern als ein Symbol (KAN-467, 16.11.2026) ───────────────────────────────────────────
// Ein Tank (gebinde_tanks, KAN-466) steht im Plan als abgerundetes Rechteck; seine Kammern liegen darin als Segmente
// übereinander – Kammer 1 unten, die oberste oben, die Höhe nach dem Fassungsvermögen. Diese Datei rechnet nur:
// Segmente eines Tanks, Größe und Lage im Plan, und welches Gebinde unter dem Zeiger liegt (Kreise und Segmente).
// Gezeichnet und gebucht wird im Editor. Isomorph, ohne '@/'-Importe (node:test).

/** Der Plan ist ein A4-Hochformat: eine Höhe „im Maß der Breite“ in % der Planhöhe (damit ein Kreis rund bleibt) */
export const planHoehe = (pctDerBreite: number): number => pctDerBreite * (210 / 297)

export type TankKammer = { id: string; nr: number; volumen_liter: number | null }
/** Segment einer Kammer im Tank: Abstand von oben und Höhe in % der Tankhöhe */
export type TankSegment = { id: string; nr: number; oben: number; hoehe: number }

/** Mindestanteil einer Kammer an der Tankhöhe – sonst wäre eine kleine Kammer nicht mehr lesbar und kaum zu treffen */
export const SEGMENT_MIN_ANTEIL = 0.18

/**
 * Segmente von oben nach unten (höchste Kammer-Nummer zuerst). Höhe nach dem Fassungsvermögen; fehlt es bei einer
 * Kammer, zählt sie wie der Durchschnitt der übrigen. Jede Kammer bekommt mindestens SEGMENT_MIN_ANTEIL (bei vielen
 * Kammern entsprechend weniger), der Rest verteilt sich nach dem Volumen. Summe der Höhen = 100.
 */
export function tankSegmente(kammern: readonly TankKammer[]): TankSegment[] {
  const k = [...kammern].sort((a, b) => b.nr - a.nr)
  if (k.length === 0) return []
  const bekannt = k.map(x => x.volumen_liter).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  const schnitt = bekannt.length ? bekannt.reduce((s, v) => s + v, 0) / bekannt.length : 1
  const gewicht = k.map(x => (typeof x.volumen_liter === 'number' && Number.isFinite(x.volumen_liter) && x.volumen_liter > 0 ? x.volumen_liter : schnitt))
  const summe = gewicht.reduce((s, v) => s + v, 0)
  const min = Math.min(SEGMENT_MIN_ANTEIL, 1 / k.length)
  const frei = 1 - min * k.length
  let oben = 0
  return k.map((x, i) => {
    const hoehe = (min + frei * (gewicht[i] / summe)) * 100
    const s = { id: x.id, nr: x.nr, oben, hoehe }
    oben += hoehe
    return s
  })
}

export type TankPlatz = { pos_x_pct: number; pos_y_pct: number; breite_pct: number; hoehe_pct: number }

export const TANK_BREITE_MIN = 6
export const TANK_BREITE_MAX = 30
const TANK_HOEHE_MAX = 90   // im Maß der Breite – 90 entspricht rund 64 % der Planhöhe

const grenze = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Startgröße eines Tanks nach der Zahl seiner Kammern (3 Kammern: 12 × 26) */
export function tankStandardGroesse(kammern: number): { breite_pct: number; hoehe_pct: number } {
  return { breite_pct: 12, hoehe_pct: grenze(8 * kammern + 2, 18, 44) }
}

/** Lage so begrenzt, dass der Tank ganz im Plan bleibt */
export function tankImPlan(p: TankPlatz): TankPlatz {
  return {
    ...p,
    pos_x_pct: grenze(p.pos_x_pct, 0, Math.max(0, 100 - p.breite_pct)),
    pos_y_pct: grenze(p.pos_y_pct, 0, Math.max(0, 100 - planHoehe(p.hoehe_pct))),
  }
}

/** Größer/kleiner um `delta` Prozentpunkte der Breite – das Seitenverhältnis bleibt, der Tank bleibt im Plan */
export function tankGroesseAendern(p: TankPlatz, delta: number): TankPlatz {
  const breite = grenze(p.breite_pct + delta, TANK_BREITE_MIN, TANK_BREITE_MAX)
  const faktor = p.breite_pct > 0 ? breite / p.breite_pct : 1
  const hoehe = Math.min(TANK_HOEHE_MAX, p.hoehe_pct * faktor)
  return tankImPlan({ ...p, breite_pct: breite, hoehe_pct: hoehe })
}

/** Rechteck in Pixeln der Zeichenfläche */
export type PlanRechteck = { id: string; x: number; y: number; b: number; h: number }
export type PlanKreis = { id: string; cx: number; cy: number; r: number }

/** Segmente eines platzierten Tanks als Rechtecke in Pixeln (Fläche = Breite × Höhe der Zeichenfläche) */
export function segmentRechtecke(platz: TankPlatz, segmente: readonly TankSegment[], flaeche: { breite: number; hoehe: number }): PlanRechteck[] {
  const x = platz.pos_x_pct / 100 * flaeche.breite
  const y = platz.pos_y_pct / 100 * flaeche.hoehe
  const b = platz.breite_pct / 100 * flaeche.breite
  const h = planHoehe(platz.hoehe_pct) / 100 * flaeche.hoehe
  return segmente.map(s => ({ id: s.id, x, y: y + s.oben / 100 * h, b, h: s.hoehe / 100 * h }))
}

/**
 * Gebinde unter dem Zeiger: zuerst die Kreise (der nächste Mittelpunkt gewinnt), sonst das Segment, in dem der Zeiger
 * liegt. `ausser` = das gezogene Gebinde selbst. null = freie Fläche.
 */
export function zielUnterZeiger(
  punkt: { x: number; y: number },
  kreise: readonly PlanKreis[],
  rechtecke: readonly PlanRechteck[],
  ausser: string | null,
): string | null {
  let best: { id: string; d: number } | null = null
  for (const k of kreise) {
    if (k.id === ausser) continue
    const d = Math.hypot(punkt.x - k.cx, punkt.y - k.cy)
    if (d <= k.r && (!best || d < best.d)) best = { id: k.id, d }
  }
  if (best) return best.id
  for (const r of rechtecke) {
    if (r.id === ausser) continue
    if (punkt.x >= r.x && punkt.x <= r.x + r.b && punkt.y >= r.y && punkt.y < r.y + r.h) return r.id
  }
  return null
}
