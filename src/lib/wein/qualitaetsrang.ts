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

// ── KAN-186 Etappe 2b/2c (02.10.2026): Qualitätsangabe = Stufe + Zusatzbezeichnung + Erzeugnis ─────────────────
// Reserve, Große Reserve, Erste Lage und Großes Gewächs sind keine Stufen mehr, sondern eine eigene Spalte
// (zusatzbezeichnung) auf der Grundstufe Qualitätswein – auch bei DAC-Herkunft (Entscheidung Jörgen 02.10.2026).
// Sekt und Perlwein sind Erzeugnisse (Spalte erzeugnis: SEKTGU bzw. PERLWEIN) auf einer Stufe der Achse.
// Altdaten können im Qualitätsfeld noch 'reserve', 'erste_lage', 'grosses_gewachs', 'sekt' oder 'perlwein' tragen,
// bis die Migration kan186c sie umstellt – normalisiereQualitaet() liefert für beide Fälle dieselbe Angabe.
//
// Regeln:
//  • Mischen (mischeQualitaet): Stufe nach niedrigsteQualitaet; die Zusatzbezeichnung bleibt nur, wenn alle Teile
//    dieselbe tragen (KAN-74), sonst entfällt sie; ebenso das Erzeugnis.
//  • Aufwertung (istAufwertungQualitaet): höhere Stufe ODER eine Zusatzbezeichnung, die vorher fehlte bzw. höher ist
//    (Qualitätswein → Reserve, Reserve → Große Reserve, Reserve → Erste Lage). Erlaubt bleibt das Absteigen innerhalb
//    der Paare Große Reserve → Reserve und Großes Gewächs → Erste Lage. Ein Erzeugnis allein ist nie eine Aufwertung
//    (Sekt setzt Qualitätswein voraus – das prüft die Stufe bzw. qualitaetsAngabeFehler in lib/wein/qualitaet).
//  • Abstufung (istAbstufungQualitaet): niedrigere Stufe, eine verlorene bzw. niedrigere Zusatzbezeichnung oder ein
//    verlorenes Erzeugnis Sekt/Perlwein – für Vermerke („Abstufung von Qualitätswein Reserve auf Qualitätswein“).

/** Zusatzbezeichnungen (Spiegel von ZUSATZBEZEICHNUNGEN in lib/katalog/bki.ts und der CHECKs, Test kan39-kataloge) */
export const ZUSATZ_WERTE = ['reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs'] as const
export type Zusatz = (typeof ZUSATZ_WERTE)[number]

/** Altwerte des Qualitätsfelds, die seit KAN-186 in Zusatzbezeichnung bzw. Erzeugnis stehen */
export const ALTWERTE_QUALITAET = ['reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein'] as const
const ALT_ZUSATZ: Readonly<Record<string, Zusatz>> = { reserve: 'reserve', erste_lage: 'erste_lage', grosses_gewachs: 'grosses_gewachs' }
const ALT_ERZEUGNIS: Readonly<Record<string, string>> = { sekt: 'SEKTGU', perlwein: 'PERLWEIN' }
/** Grundstufe der Zusatzbezeichnungen und der Altwerte Sekt/Perlwein (Entscheidung Jörgen 02.10.2026) */
export const GRUNDSTUFE_ZUSATZ = 'qualitaetswein'

/** Qualitätsangabe einer Charge, Füllung oder eines Zukaufs */
export interface QualitaetsAngabe {
  stufe: string | null
  zusatz: Zusatz | null
  erzeugnis: string | null
}

/** Zeile mit Qualitätsfeld (weinausbau/zukauf_posten: qualitaetsstufe, fuellungen: qualitaet) */
export type QualitaetsZeile = {
  qualitaetsstufe?: string | null
  qualitaet?: string | null
  zusatzbezeichnung?: string | null
  erzeugnis?: string | null
}

export function istZusatz(wert: unknown): wert is Zusatz {
  return typeof wert === 'string' && (ZUSATZ_WERTE as readonly string[]).includes(wert)
}

/** Ist `wert` ein Altwert des Qualitätsfelds (reserve, erste_lage, grosses_gewachs, sekt, perlwein)? */
export function istAltwertQualitaet(wert: unknown): boolean {
  return typeof wert === 'string' && (ALTWERTE_QUALITAET as readonly string[]).includes(wert)
}

const hat = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Normalisierte Angabe – tolerant für Altdaten: Altwert im Qualitätsfeld → Qualitätswein + Zusatz bzw. Erzeugnis
 * (ausdrücklich gespeicherte Spalten haben Vorrang). Leere Texte zählen als null.
 */
export function normalisiereQualitaet(zeile: QualitaetsZeile | null | undefined): QualitaetsAngabe {
  if (!zeile) return { stufe: null, zusatz: null, erzeugnis: null }
  const roh = hat(zeile, 'qualitaetsstufe') ? zeile.qualitaetsstufe : zeile.qualitaet
  let stufe: string | null = typeof roh === 'string' && roh.trim() ? roh.trim() : null
  let zusatz: Zusatz | null = istZusatz(zeile.zusatzbezeichnung) ? zeile.zusatzbezeichnung : null
  let erzeugnis: string | null = typeof zeile.erzeugnis === 'string' && zeile.erzeugnis.trim() ? zeile.erzeugnis.trim() : null
  if (stufe && hat(ALT_ZUSATZ, stufe)) {
    zusatz = zusatz ?? ALT_ZUSATZ[stufe]
    stufe = GRUNDSTUFE_ZUSATZ
  } else if (stufe && hat(ALT_ERZEUGNIS, stufe)) {
    erzeugnis = erzeugnis ?? ALT_ERZEUGNIS[stufe]
    stufe = GRUNDSTUFE_ZUSATZ
  }
  return { stufe, zusatz, erzeugnis }
}

/** Kurzform: normalisierte Angabe aus Stufe, Zusatz und Erzeugnis */
export function qualitaetsAngabe(stufe: string | null | undefined, zusatz?: string | null, erzeugnis?: string | null): QualitaetsAngabe {
  return normalisiereQualitaet({ qualitaetsstufe: stufe ?? null, zusatzbezeichnung: zusatz ?? null, erzeugnis: erzeugnis ?? null })
}

/** Spalten zum Schreiben (weinausbau/zukauf_posten) – nie ein Altwert im Qualitätsfeld */
export function qualitaetsSpalten(a: QualitaetsAngabe | null | undefined): { qualitaetsstufe: string | null; zusatzbezeichnung: Zusatz | null; erzeugnis: string | null } {
  return { qualitaetsstufe: a?.stufe ?? null, zusatzbezeichnung: a?.zusatz ?? null, erzeugnis: a?.erzeugnis ?? null }
}

/** Spalten zum Schreiben in fuellungen (Qualitätsfeld heißt dort qualitaet) */
export function fuellungsQualitaetsSpalten(a: QualitaetsAngabe | null | undefined): { qualitaet: string | null; zusatzbezeichnung: Zusatz | null; erzeugnis: string | null } {
  return { qualitaet: a?.stufe ?? null, zusatzbezeichnung: a?.zusatz ?? null, erzeugnis: a?.erzeugnis ?? null }
}

/** Beide Angaben gleich (nach Normalisierung)? */
export function gleicheQualitaet(a: QualitaetsAngabe | null | undefined, b: QualitaetsAngabe | null | undefined): boolean {
  return (a?.stufe ?? null) === (b?.stufe ?? null) && (a?.zusatz ?? null) === (b?.zusatz ?? null) && (a?.erzeugnis ?? null) === (b?.erzeugnis ?? null)
}

const leer = (a: QualitaetsAngabe | null | undefined): boolean => !a || (!a.stufe && !a.zusatz && !a.erzeugnis)

/** Zusatz und Erzeugnis passen zur Stufe? Zusatz nur auf Qualitätswein, Sekt g.U. erst ab Qualitätswein. */
function bereinigt(a: QualitaetsAngabe): QualitaetsAngabe {
  const zusatz = a.zusatz && a.stufe === GRUNDSTUFE_ZUSATZ ? a.zusatz : null
  const r = qualitaetsRang(a.stufe)
  const erzeugnis = a.erzeugnis === 'SEKTGU' && (!r || r.stufe < QUW) ? null : a.erzeugnis
  return { stufe: a.stufe, zusatz, erzeugnis }
}

/**
 * Ergebnis einer Mischung (Verschnitt, Zusammenführung): Stufe wie niedrigsteQualitaet, Zusatzbezeichnung und
 * Erzeugnis nur, wenn alle Teile mit bekannter Stufe dieselben tragen. Ohne jeden Wert → null.
 */
export function mischeQualitaet(liste: readonly (QualitaetsAngabe | null | undefined)[]): QualitaetsAngabe | null {
  const teile = liste.filter((a): a is QualitaetsAngabe => !leer(a))
  if (teile.length === 0) return null
  const stufe = niedrigsteQualitaet(teile.map(a => a.stufe))
  const bewertet = teile.filter(a => a.stufe && a.stufe !== 'sonstiges' && qualitaetsRang(a.stufe) != null)
  const basis = bewertet.length > 0 ? bewertet : teile
  const zusatz = basis.every(a => a.zusatz && a.zusatz === basis[0].zusatz) ? basis[0].zusatz : null
  const erzeugnis = basis.every(a => (a.erzeugnis ?? null) === (basis[0].erzeugnis ?? null)) ? basis[0].erzeugnis ?? null : null
  return bereinigt({ stufe, zusatz, erzeugnis })
}

/** Rang einer Zusatzbezeichnung (0 = keine; Reserve/Erste Lage 1; Große Reserve/Großes Gewächs 2) */
const ZUSATZ_RANG: Readonly<Record<Zusatz, number>> = { reserve: 1, erste_lage: 1, grosse_reserve: 2, grosses_gewachs: 2 }
/** Erlaubtes Absteigen innerhalb einer Zusatzbezeichnung */
const ZUSATZ_DARUNTER: Readonly<Partial<Record<Zusatz, Zusatz>>> = { grosse_reserve: 'reserve', grosses_gewachs: 'erste_lage' }

/** Zusatzbezeichnungen, die gegenüber `alt` keine Aufwertung sind (bisherige und die darunter); ohne bisherige keine */
export function zusaetzeOhneAufwertung(alt: Zusatz | null | undefined): Zusatz[] {
  if (!alt) return []
  const darunter = ZUSATZ_DARUNTER[alt]
  return darunter ? [alt, darunter] : [alt]
}

/** `neu` ist eine neue bzw. höhere Zusatzbezeichnung gegenüber `alt` */
function zusatzAufgewertet(alt: Zusatz | null, neu: Zusatz | null): boolean {
  if (!neu || neu === alt) return false
  return !(alt && ZUSATZ_DARUNTER[alt] === neu)
}

/** Vergleich für Sortierungen und die höchste Angabe: Stufe, dann Zusatzbezeichnung, dann Erzeugnis Sekt/Perlwein */
export function vergleicheQualitaetsAngabe(a: QualitaetsAngabe | null | undefined, b: QualitaetsAngabe | null | undefined): number {
  const s = vergleicheQualitaet(a?.stufe, b?.stufe)
  if (s !== 0) return s
  const z = (a?.zusatz ? ZUSATZ_RANG[a.zusatz] : 0) - (b?.zusatz ? ZUSATZ_RANG[b.zusatz] : 0)
  if (z !== 0) return z
  const e = (x: QualitaetsAngabe | null | undefined) => (x?.erzeugnis === 'SEKTGU' || x?.erzeugnis === 'PERLWEIN' ? 1 : 0)
  return e(a) - e(b)
}

/** Höchste Angabe der Beteiligten (für „Abstufung von … auf …“); ohne bekannte Stufe zählt eine Angabe nicht */
export function hoechsteQualitaetsAngabe(liste: readonly (QualitaetsAngabe | null | undefined)[]): QualitaetsAngabe | null {
  let best: QualitaetsAngabe | null = null
  for (const a of liste) {
    if (!a || !a.stufe || a.stufe === 'sonstiges' || qualitaetsRang(a.stufe) == null) continue
    if (!best || vergleicheQualitaetsAngabe(a, best) > 0) best = a
  }
  return best
}

/**
 * Unzulässige Aufwertung von `alt` auf `neu` (KAN-80 „händisch downgraden, aber nicht upgraden“, KAN-186):
 * höhere Stufe der Achse oder neue/höhere Zusatzbezeichnung. Ohne bisherige Stufe ist nichts eine Aufwertung.
 */
export function istAufwertungQualitaet(alt: QualitaetsAngabe | null | undefined, neu: QualitaetsAngabe | null | undefined): boolean {
  if (!alt?.stufe || !neu || leer(neu)) return false
  if (neu.stufe && istAufwertung(alt.stufe, neu.stufe)) return true
  return zusatzAufgewertet(alt.zusatz ?? null, neu.zusatz ?? null)
}

/**
 * `neu` liegt unter `alt` (Vermerk „Abstufung von … auf …“): niedrigere Stufe, verlorene bzw. niedrigere
 * Zusatzbezeichnung oder verlorenes Erzeugnis Sekt/Perlwein – sofern es keine Aufwertung ist.
 */
export function istAbstufungQualitaet(alt: QualitaetsAngabe | null | undefined, neu: QualitaetsAngabe | null | undefined): boolean {
  if (!alt?.stufe || !neu?.stufe || gleicheQualitaet(alt, neu) || istAufwertungQualitaet(alt, neu)) return false
  if (istAbstufung(alt.stufe, neu.stufe)) return true
  if (istAufwertung(alt.stufe, neu.stufe)) return false
  if (alt.zusatz && alt.zusatz !== neu.zusatz) return true
  return (alt.erzeugnis === 'SEKTGU' || alt.erzeugnis === 'PERLWEIN') && neu.erzeugnis !== alt.erzeugnis
}
