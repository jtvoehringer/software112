// Eine Qualitätsrangfolge für alle Vorgänge (KAN-74, 02.10.2026) – Verschnitt, Umzug, Füllung, Charge, Vorschau.
//
// Vorher gab es zwei widersprüchliche Ranglisten (lib/wein/qualitaet.ts: DAC = Kabinett = 3; lib/weinqualitaet.ts:
// nur die Prädikatsskala, DAC/Reserve/Sekt wurden übersprungen). Folge: Ein Verschnitt zweier DAC-Chargen setzte
// die Stufe auf NULL, Reserve + Qualitätswein stufte ohne Hinweis ab, eine Landwein-Charge ließ sich als DAC füllen.
//
// Achse (BKI-Kürzel): WEI 0 < LDW 1 < QUW 2 < KAB 3 < SPL 4 < ALW 5 < BAL = EIW = STW 6 < Ausbruch 7 < TBA 8
// (Ausbruch zwischen BA und TBA nach den Mindest-Mostgewichten 25/27/30 °KMW; Einordnung offen in KAN-38).
// Zusatzbezeichnungen liegen auf Qualitätswein: DAC (QUW + Herkunft), Reserve, Erste Lage, Großes Gewächs.
// Sekt b.A. und Perlwein sind Erzeugnisse, keine Stufen: Sekt b.A. setzt Qualitätswein voraus, Perlwein nichts.
//
// Regeln:
//  • Mischen (niedrigsteQualitaet): gleiche Werte bleiben (DAC + DAC = DAC, Sekt + Sekt = Sekt); sonst gilt die
//    niedrigste Stufe der Achse, eine Zusatzbezeichnung bleibt nur, wenn alle Beteiligten sie tragen – also
//    Reserve + Qualitätswein = Qualitätswein, DAC + Kabinett = Qualitätswein. Nie NULL, solange ein Wert bekannt ist.
//  • Aufwertung (istAufwertung): höhere Stufe der Achse oder eine Zusatzbezeichnung/ein Erzeugnis, das mehr
//    voraussetzt als die bisherige Stufe (Landwein → DAC/Reserve/Sekt). Qualitätswein bzw. Prädikat → DAC/Reserve
//    bleibt erlaubt – ob die Herkunft passt, prüft die Herkunftsregel (KAN-111).
//
// Isomorph und ohne Importe (node:test lädt die Datei direkt). KAN-39 ersetzt die Achse später durch den Katalog.

export type QualitaetsArt = 'stufe' | 'zusatz' | 'erzeugnis' | 'sonstiges'

export interface QualitaetsRang {
  /** Stufe auf der Achse (0 = Wein … 8 = TBA) */
  stufe: number
  art: QualitaetsArt
  /** Mindeststufe, die der Wert voraussetzt (DAC/Reserve/Sekt: Qualitätswein) */
  mindest: number
}

const STUFEN: Record<string, number> = {
  wein: 0, landwein: 1, qualitaetswein: 2, kabinett: 3, spaetlese: 4, auslese: 5,
  beerenauslese: 6, eiswein: 6, strohwein: 6, ausbruch: 7, trockenbeerenauslese: 8,
}
const ZUSATZ = ['dac', 'reserve', 'erste_lage', 'grosses_gewachs'] as const
const QUW = STUFEN.qualitaetswein

/** Stufenwert zu einer Stufe der Achse (für das Ergebnis einer Mischung) */
const WERT_ZU_STUFE: readonly string[] = ['wein', 'landwein', 'qualitaetswein', 'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'ausbruch', 'trockenbeerenauslese']

/** Rang eines Werts – null für leer bzw. unbekannt */
export function qualitaetsRang(wert: string | null | undefined): QualitaetsRang | null {
  if (!wert) return null
  if (wert in STUFEN) return { stufe: STUFEN[wert], art: 'stufe', mindest: 0 }
  if ((ZUSATZ as readonly string[]).includes(wert)) return { stufe: QUW, art: 'zusatz', mindest: QUW }
  if (wert === 'sekt') return { stufe: QUW, art: 'erzeugnis', mindest: QUW }
  if (wert === 'perlwein') return { stufe: 0, art: 'erzeugnis', mindest: 0 }
  if (wert === 'sonstiges') return { stufe: 0, art: 'sonstiges', mindest: 0 }
  return null
}

/** Stufe der Achse (für Sortierungen und Auswahllisten); unbekannt → null */
export function qualitaetsStufe(wert: string | null | undefined): number | null {
  return qualitaetsRang(wert)?.stufe ?? null
}

/**
 * Ergebnis einer Mischung (Verschnitt, Zusammenführung). Leere und unbekannte Werte zählen nicht; „Sonstiges“
 * zählt nur, wenn sonst nichts bekannt ist. Ohne jeden Wert → null.
 */
export function niedrigsteQualitaet(liste: readonly (string | null | undefined)[]): string | null {
  const bekannt = liste.filter((w): w is string => !!w && qualitaetsRang(w) != null)
  const bewertet = bekannt.filter(w => w !== 'sonstiges')
  if (bewertet.length === 0) return bekannt[0] ?? null
  if (bewertet.every(w => w === bewertet[0])) return bewertet[0]
  const min = Math.min(...bewertet.map(w => qualitaetsRang(w)!.stufe))
  return WERT_ZU_STUFE[min] ?? 'wein'
}

/** Höchster Wert der Beteiligten (für „Abstufung von … auf …“): höhere Stufe, bei gleicher Stufe der mit Zusatz */
export function hoechsteQualitaet(liste: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const w of liste) {
    const r = qualitaetsRang(w)
    if (!w || !r || r.art === 'sonstiges') continue
    const b = qualitaetsRang(best)
    if (!b || r.stufe > b.stufe || (r.stufe === b.stufe && r.art !== 'stufe' && b.art === 'stufe')) best = w
  }
  return best
}

/**
 * `neu` liegt unter `alt` – eine Abstufung, die angezeigt bzw. vermerkt wird: niedrigere Stufe, oder gleiche Stufe
 * und die Zusatzbezeichnung bzw. das Erzeugnis von `alt` geht verloren (Reserve → Qualitätswein).
 */
export function istAbstufung(alt: string | null | undefined, neu: string | null | undefined): boolean {
  const a = qualitaetsRang(alt), n = qualitaetsRang(neu)
  if (!a || !n || !alt || !neu || alt === neu || a.art === 'sonstiges' || n.art === 'sonstiges') return false
  if (n.stufe !== a.stufe) return n.stufe < a.stufe
  return a.art !== 'stufe' && n.art === 'stufe'
}

/**
 * `neu` ist eine unzulässige Aufwertung gegenüber `alt` (KAN-80, „händisch downgraden, aber nicht upgraden“):
 * höhere Stufe der Achse, oder eine Zusatzbezeichnung/ein Erzeugnis, das mehr voraussetzt als `alt`
 * (Landwein → DAC, Reserve oder Sekt). Ohne bisherigen Wert ist nichts eine Aufwertung.
 */
export function istAufwertung(alt: string | null | undefined, neu: string | null | undefined): boolean {
  const a = qualitaetsRang(alt), n = qualitaetsRang(neu)
  if (!a || !n || !alt || !neu || alt === neu || a.art === 'sonstiges' || n.art === 'sonstiges') return false
  if (n.art === 'stufe' || a.art === 'stufe') {
    // Perlwein (Stufe 0) ist kein Maßstab: aus Perlwein wird nichts „höher“, Perlwein selbst ist nie eine Aufwertung
    if (a.art === 'erzeugnis' && alt === 'perlwein') return false
    if (n.art === 'stufe') return n.stufe > a.stufe
    return n.mindest > a.stufe
  }
  // Zusatz/Erzeugnis → Zusatz/Erzeugnis: nur, wenn mehr vorausgesetzt wird
  return n.mindest > a.mindest
}

/** Vergleich für Sortierungen (aufsteigend nach Stufe, Zusätze nach der reinen Stufe) */
export function vergleicheQualitaet(a: string | null | undefined, b: string | null | undefined): number {
  const ra = qualitaetsRang(a), rb = qualitaetsRang(b)
  if (!ra || !rb) return ra ? 1 : rb ? -1 : 0
  if (ra.stufe !== rb.stufe) return ra.stufe - rb.stufe
  const gewicht = (r: QualitaetsRang) => (r.art === 'stufe' ? 0 : 1)
  return gewicht(ra) - gewicht(rb)
}
