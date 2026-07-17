// Herkunft-Code (BKI) – Weinrechtliche Herkunftspyramide.
// Spiegelt bewusst das Muster von weinqualitaet.ts (QUALITAET_ORDER / minQualitaet / istNiedrigerAls),
// damit beide Felder ("Qualität" und "Herkunft-Code") im Kellerbuch/Verschneiden/Füllen identisch
// behandelt werden können: Abstufungen sind erlaubt, Aufstufungen nie.
//
// v1-Scope (mit Nutzer abgestimmt): nur Weinland Niederösterreich (WLNÖ) + Thermenregion DAC.
// Weitere Weinbaugebiete können später einfach als zusätzliche HERKUNFT_ORDER-Einträge +
// eigener SORTENSPIEGEL-Eintrag ergänzt werden, ohne das bestehende Modell zu ändern.
//
// Quelle Thermenregion-Sortenspiegel: BGBl. II Nr. 191/2023 (DAC-Verordnung Thermenregion),
// geändert durch BGBl. II Nr. 250/2024.

// Aufsteigend nach Enge/Anforderung der Herkunftsbezeichnung (breit → eng).
export const HERKUNFT_ORDER = [
  'wein',                        // Wein / Landwein – keine Herkunftsangabe
  'wlnoe',                       // WLNÖ – Weinland Niederösterreich, Qualitätswein g.U.
  'thermenregion_gebietswein',   // Thermenregion DAC – Gebietswein
  'thermenregion_ortswein',      // Thermenregion DAC – Ortswein
  'thermenregion_riedenwein',    // Thermenregion DAC – Riedenwein/Lagenwein
] as const

export type HerkunftCode = typeof HERKUNFT_ORDER[number] | 'sonstiges' | null

export const HERKUNFT_LABEL: Record<string, string> = {
  wein:                       'Wein / Landwein',
  wlnoe:                      'WLNÖ – Weinland Niederösterreich (Qualitätswein)',
  thermenregion_gebietswein:  'Thermenregion DAC – Gebietswein',
  thermenregion_ortswein:     'Thermenregion DAC – Ortswein',
  thermenregion_riedenwein:   'Thermenregion DAC – Riedenwein',
  sonstiges:                  'Sonstiges',
}

// Zu welchem Weinbaugebiet gehört eine Stufe? (für spätere Mandanten-/Regionsfilterung)
export const HERKUNFT_REGION: Record<string, string | null> = {
  wein:                       null,
  wlnoe:                      'weinland_noe',
  thermenregion_gebietswein:  'thermenregion',
  thermenregion_ortswein:     'thermenregion',
  thermenregion_riedenwein:   'thermenregion',
}

// Sortenspiegel je Stufe: welche Rebsorten (Freitext-Schreibweisen wie im übrigen Code, s. bki_kuerzel.ts)
// sind zulässig? null = keine Sortenspiegel-Einschränkung auf dieser Stufe.
const THERMENREGION_GEBIETSWEIN_SORTEN = [
  'Rotgipfler', 'Zierfandler',
  'Weißburgunder', 'Pinot Blanc',
  'Grauburgunder', 'Pinot Gris',
  'Chardonnay', 'Morillon',
  'Neuburger',
  'Blauburgunder', 'Pinot Noir',
  'St. Laurent', 'Sankt Laurent',
  'Blauer Portugieser',
  'Zweigelt',
]

const THERMENREGION_ORTSWEIN_SORTEN = THERMENREGION_GEBIETSWEIN_SORTEN.filter(
  s => s !== 'Neuburger' && s !== 'Blauer Portugieser'
)

const THERMENREGION_RIEDENWEIN_SORTEN = THERMENREGION_ORTSWEIN_SORTEN.filter(
  s => s !== 'Grauburgunder' && s !== 'Pinot Gris' && s !== 'Zweigelt'
)

export const SORTENSPIEGEL: Record<string, string[] | null> = {
  wein:                       null,
  wlnoe:                      null, // Qualitätswein g.U. – allgemeine Qualitätsweinsorten, keine Einschränkung
  thermenregion_gebietswein:  THERMENREGION_GEBIETSWEIN_SORTEN,
  thermenregion_ortswein:     THERMENREGION_ORTSWEIN_SORTEN,
  thermenregion_riedenwein:   THERMENREGION_RIEDENWEIN_SORTEN,
}

/** Prüft ob eine Rebsorte auf der gegebenen Herkunftsstufe laut Sortenspiegel zulässig ist. */
export function istRebsorteZulaessig(code: string | null | undefined, rebsorte: string | null | undefined): boolean {
  if (!code) return true
  const liste = SORTENSPIEGEL[code]
  if (liste === undefined) return true // unbekannter Code (z.B. 'sonstiges') -> keine Prüfung
  if (liste === null) return true // keine Einschränkung auf dieser Stufe
  if (!rebsorte) return true // Rebsorte (noch) unbekannt -> nicht blockieren, nur bei bekannter Sorte prüfen
  return liste.includes(rebsorte)
}

/** Gibt den niedrigsten (breitesten) Herkunft-Code unter den übergebenen zurück.
 *  Wird für die Abstufung beim Verschneiden verwendet (min. Herkunft aller Beteiligten gewinnt). */
export function minHerkunft(codes: (string | null | undefined)[]): string | null {
  let minIdx = Infinity
  let minVal: string | null = null
  for (const c of codes) {
    if (!c || c === 'sonstiges') continue
    const idx = HERKUNFT_ORDER.indexOf(c as typeof HERKUNFT_ORDER[number])
    if (idx !== -1 && idx < minIdx) { minIdx = idx; minVal = c }
  }
  return minVal
}

/** Gibt den höchsten (engsten) Herkunft-Code unter den übergebenen zurück (für "abgestuft von X auf Y"-Meldungen). */
export function maxHerkunft(codes: (string | null | undefined)[]): string | null {
  let maxIdx = -1
  let maxVal: string | null = null
  for (const c of codes) {
    if (!c || c === 'sonstiges') continue
    const idx = HERKUNFT_ORDER.indexOf(c as typeof HERKUNFT_ORDER[number])
    if (idx !== -1 && idx > maxIdx) { maxIdx = idx; maxVal = c }
  }
  return maxVal
}

/** Prüft ob Herkunft-Code `a` im Rang niedriger (breiter) ist als `b`. */
export function istNiedrigerAls(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const idxA = HERKUNFT_ORDER.indexOf(a as typeof HERKUNFT_ORDER[number])
  const idxB = HERKUNFT_ORDER.indexOf(b as typeof HERKUNFT_ORDER[number])
  if (idxA === -1 || idxB === -1) return false
  return idxA < idxB
}

/** Sucht ausgehend von `code` abwärts die höchste Herkunftsstufe, auf der `rebsorte` laut
 *  Sortenspiegel zulässig ist (automatische Abstufung bei Sortenspiegel-Verstoß).
 *  Gibt den ursprünglichen Code zurück, falls er bereits zulässig ist oder Rebsorte unbekannt ist. */
export function findePassendeHerkunftsstufe(
  code: string | null | undefined,
  rebsorte: string | null | undefined
): { code: string | null; abgestuft: boolean } {
  if (!code || code === 'sonstiges' || !rebsorte) return { code: code ?? null, abgestuft: false }
  const startIdx = HERKUNFT_ORDER.indexOf(code as typeof HERKUNFT_ORDER[number])
  if (startIdx === -1) return { code, abgestuft: false }
  if (istRebsorteZulaessig(code, rebsorte)) return { code, abgestuft: false }
  for (let idx = startIdx - 1; idx >= 0; idx--) {
    const kandidat = HERKUNFT_ORDER[idx]
    if (istRebsorteZulaessig(kandidat, rebsorte)) {
      return { code: kandidat, abgestuft: true }
    }
  }
  // Sollte nie eintreten, da 'wein'/'wlnoe' keine Einschränkung haben – Fallback sicherheitshalber.
  return { code: 'wein', abgestuft: true }
}
