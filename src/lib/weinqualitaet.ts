// Österreichische Weinqualitätsstufen – aufsteigend nach Qualität
// Wird für Verschneidungs-Abstufung (niedrigste Stufe gewinnt), die Stufe neuer
// Pressungs-Chargen und die Abstufungsregeln von Charge und Füllung verwendet.
// Die Datei bleibt bewusst ohne Importe (node:test lädt sie direkt, lib/wein/qualitaet.ts importiert sie).

export const QUALITAET_ORDER = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
  'eiswein', 'strohwein',
  'dac', 'reserve', 'erste_lage', 'grosses_gewachs',
  'sekt', 'perlwein',
] as const

export type Qualitaetsstufe = typeof QUALITAET_ORDER[number] | 'sonstiges' | null

// Kurzbezeichnungen für Fließtexte (Abstufungs-Hinweise, Badges, Notizen). Bewusst kürzer
// als die Listen-Labels in lib/wein/qualitaet.ts (dort „Wein (ohne Herkunft)“): umziehen()
// schreibt diese Texte in Notizen/Bewegungsbuch, und lib/kellerbuch/storno.ts
// (qualitaetsCode) liest sie beim Storno wieder zurück – ein geändertes Label träfe
// gespeicherte Texte nicht mehr. Werte = QUALITAET_OPTS (Test: scripts/tests/qualitaet.test.mjs).
export const QUALITAET_LABEL: Record<string, string> = {
  wein:                    'Wein',
  landwein:                'Landwein',
  qualitaetswein:          'Qualitätswein',
  kabinett:                'Kabinett',
  spaetlese:               'Spätlese',
  auslese:                 'Auslese',
  beerenauslese:           'Beerenauslese',
  ausbruch:                'Ausbruch',
  trockenbeerenauslese:    'Trockenbeerenauslese',
  eiswein:                 'Eiswein',
  strohwein:               'Strohwein',
  dac:                     'DAC',
  reserve:                 'Reserve',
  erste_lage:              'Erste Lage',
  grosses_gewachs:         'Großes Gewächs',
  sekt:                    'Sekt',
  perlwein:                'Perlwein',
  sonstiges:               'Sonstiges',
}

// ── Prädikats-Skala und Abstufungs-Ordnung ───────────────────────────────────
// Nur diese Stufen werden für Abstufungs-Prüfungen herangezogen. DAC, Reserve, Erste Lage,
// Sekt etc. sind eigenständige Bezeichnungen und nicht direkt mit der Skala vergleichbar
// (Ausnahme: istAbstufung/istAufstufung behandeln DAC, Reserve, Erste Lage und Großes
// Gewächs wie Qualitätswein, siehe QUALITAETSWEIN_BEZEICHNUNGEN).
export const PRAEDIKATSWEIN_ORDER = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
  'eiswein', 'strohwein',
] as const

// KAN-73 (25.09.2026): Die Skala ist keine einfache Reihe. Hauptskala nach Mindest-Mostgewicht:
//   Wein < Landwein < Qualitätswein < Kabinett < Spätlese < Auslese < Beerenauslese
//   < Ausbruch < Trockenbeerenauslese
// Eiswein und Strohwein verlangen wie die Beerenauslese mindestens 25 °KMW, dazu eigene
// Lesebedingungen (gefroren gelesen bzw. getrocknet). Sie sind deshalb eigene Zweige auf
// BA-Niveau: abstufbar auf Beerenauslese und darunter, aber weder untereinander noch mit
// Ausbruch/TBA vergleichbar – eine TBA ist kein Eiswein, ein Eiswein keine TBA.
// (Vorher lagen Eiswein und Strohwein über der TBA: eine Eiswein-Charge ließ sich so als
// „Ausbruch“ oder „TBA“ abfüllen, und ein Verschnitt Eiswein + TBA ergab „TBA“.)
const HAUPTSKALA = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
] as const
const ZWEIG_BASIS = new Map<string, string>([
  ['eiswein', 'beerenauslese'],
  ['strohwein', 'beerenauslese'],
])

/** Liegt `s` auf der Prädikats-Skala (Wein … TBA, Eiswein, Strohwein)? */
export function istPraedikatsStufe(s: unknown): s is typeof PRAEDIKATSWEIN_ORDER[number] {
  return typeof s === 'string' && (PRAEDIKATSWEIN_ORDER as readonly string[]).includes(s)
}

/** `a` ist mindestens so hoch wie `b` (gleich oder höher) – beide auf der Prädikats-Skala.
 *  false, wenn eine Stufe nicht auf der Skala liegt oder beide nicht vergleichbar sind
 *  (Eiswein/Strohwein gegenüber Ausbruch, TBA und einander). */
export function istMindestens(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!istPraedikatsStufe(a) || !istPraedikatsStufe(b)) return false
  if (a === b) return true
  if (ZWEIG_BASIS.has(b)) return false   // über einem Zweig liegt nur er selbst
  const ia = (HAUPTSKALA as readonly string[]).indexOf(ZWEIG_BASIS.get(a) ?? a)
  const ib = (HAUPTSKALA as readonly string[]).indexOf(b)
  return ia >= ib
}

/** Prüft ob Stufe `a` im Prädikatswein-Rang niedriger ist als Stufe `b` (echte Abstufung).
 *  Gibt false zurück wenn eine der Stufen nicht auf der Prädikatswein-Skala liegt oder die
 *  beiden nicht vergleichbar sind (z. B. Eiswein und TBA). */
export function istNiedrigerAls(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a === b) return false
  return istMindestens(b, a)
}

/** Höchste Stufe, die beide erreichen (für Verschnitt/Pressung): bei Zweigen die Hauptskala */
function gemeinsameStufe(a: string, b: string): string {
  if (istMindestens(a, b)) return b
  if (istMindestens(b, a)) return a
  // nicht vergleichbar (ein Zweig beteiligt): auf die Hauptskala zurückführen
  return gemeinsameStufe(ZWEIG_BASIS.get(a) ?? a, ZWEIG_BASIS.get(b) ?? b)
}

/** Gibt den niedrigsten Qualitätslevel unter den übergebenen zurück – genauer die höchste
 *  Stufe, die alle erreichen (Eiswein + TBA → Beerenauslese, Eiswein + Eiswein → Eiswein).
 *  Berücksichtigt NUR die Prädikatswein-Stufen (keine DAC, Reserve etc.).
 *  Gibt null zurück wenn keine bekannte Prädikatswein-Stufe dabei ist. */
export function minQualitaet(stufen: (string | null | undefined)[]): string | null {
  let ergebnis: string | null = null
  for (const s of stufen) {
    if (!istPraedikatsStufe(s)) continue
    ergebnis = ergebnis == null ? s : gemeinsameStufe(ergebnis, s)
  }
  return ergebnis
}

/** Gibt den höchsten Qualitätslevel unter den übergebenen zurück.
 *  Berücksichtigt NUR die Prädikatswein-Stufen (keine DAC, Reserve etc.).
 *  Gibt null zurück wenn keine bekannte Stufe dabei ist. */
export function maxQualitaet(stufen: (string | null | undefined)[]): string | null {
  let maxIdx = -1
  let maxVal: string | null = null
  for (const s of stufen) {
    if (!s || s === 'sonstiges') continue
    const idx = PRAEDIKATSWEIN_ORDER.indexOf(s as typeof PRAEDIKATSWEIN_ORDER[number])
    if (idx !== -1 && idx > maxIdx) { maxIdx = idx; maxVal = s }
  }
  return maxVal
}

// ── Mostgewicht ───────────────────────────────────────────────────────────────

/** Mindest-Mostgewicht je Stufe in °KMW (Österreichisches Weingesetz, oesterreichwein.at).
 *  Eiswein und Strohwein wie Beerenauslese 25 °KMW, Ausbruch 27 °KMW. */
export const MINDEST_KMW: Readonly<Record<string, number>> = {
  wein: 0, landwein: 14, qualitaetswein: 15, kabinett: 17, spaetlese: 19, auslese: 21,
  beerenauslese: 25, eiswein: 25, strohwein: 25, ausbruch: 27, trockenbeerenauslese: 30,
}

/** Leitet die Qualitätsstufe aus dem KMW-Grad (Klosterneuburger Mostwaage) ab.
 *  Quelle: Österreichisches Weingesetz (oesterreichwein.at) – Mindest-Mostgewichte:
 *  Landwein 14, Qualitätswein 15, Kabinett 17, Spätlese 19, Auslese 21,
 *  Beerenauslese 25, Trockenbeerenauslese 30 °KMW; darunter „Wein“ (ohne Herkunft).
 *  KAN-73 (25.09.2026): unter 14 °KMW jetzt 'wein' statt 'landwein' – Landwein verlangt
 *  mindestens 14 °KMW. Das Ergebnis ist immer ein Wert aus LESE_QUALITAETEN
 *  (lib/wein/qualitaet.ts), also für ernte_parzellen und weinausbau speicherbar.
 *  Eiswein / Strohwein / Ausbruch werden NICHT auto-abgeleitet (Sonderbedingungen).
 *  Aufrufer übergeben nur gültige Zahlen (NaN/leer vorher abfangen – NaN ergäbe 'wein'). */
export function kmwZuQualitaet(kmw: number): string {
  if (kmw >= 30) return 'trockenbeerenauslese'
  if (kmw >= 25) return 'beerenauslese'
  if (kmw >= 21) return 'auslese'
  if (kmw >= 19) return 'spaetlese'
  if (kmw >= 17) return 'kabinett'
  if (kmw >= 15) return 'qualitaetswein'
  if (kmw >= 14) return 'landwein'
  return 'wein'
}

/** Trägt das Mostgewicht `kmw` die Stufe `stufe` (KAN-73, Lese)? Ohne gültigen KMW-Wert und für
 *  Stufen außerhalb der Prädikats-Skala immer true – ob eine Stufe ohne KMW höchstens bis zu
 *  einer bestimmten Grenze zulässig ist, ist fachlich noch offen. */
export function stufeMitKmwMoeglich(stufe: string | null | undefined, kmw: number | null | undefined): boolean {
  if (kmw == null || !Number.isFinite(kmw) || !istPraedikatsStufe(stufe)) return true
  return kmw >= MINDEST_KMW[stufe]
}

// ── Abstufung bei Füllung (KAN-73) ───────────────────────────────────────────

/** Qualitätswein-Bezeichnungen ohne eigenes Mindest-Mostgewicht: für Abstufungen auf
 *  Qualitätswein-Niveau (eine DAC-Charge ohne Prüfnummer kann als Qualitätswein, Landwein
 *  oder Wein abgefüllt werden, aber nicht als Kabinett oder Eiswein). */
export const QUALITAETSWEIN_BEZEICHNUNGEN = ['dac', 'reserve', 'erste_lage', 'grosses_gewachs'] as const

function istQualitaetsweinBezeichnung(s: string): boolean {
  return (QUALITAETSWEIN_BEZEICHNUNGEN as readonly string[]).includes(s)
}

/** Niveau einer Stufe auf der Prädikats-Skala – DAC & Co. auf Qualitätswein-Niveau, sonst null */
function niveau(s: string): string | null {
  if (istPraedikatsStufe(s)) return s
  return istQualitaetsweinBezeichnung(s) ? 'qualitaetswein' : null
}

/** Echte Abstufung von `von` (Charge) auf `nach` (Füllung): `nach` liegt auf der Prädikats-
 *  Skala unter `von` bzw. – bei DAC, Reserve, Erste Lage, Großem Gewächs – auf Qualitätswein-
 *  Niveau oder darunter. Grundlage der Auswahlliste der Füllung und des Abstufungs-Vermerks. */
export function istAbstufung(von: string | null | undefined, nach: string | null | undefined): boolean {
  if (!von || !nach || von === nach) return false
  const basis = niveau(von)
  return basis != null && istPraedikatsStufe(nach) && istMindestens(basis, nach)
}

/** Aufstufung von `von` (Charge) auf `nach` (Füllung) – serverseitig hart gesperrt (KAN-73).
 *  Prädikats-Stufen verlangen, dass die Charge sie erreicht (Eiswein → Ausbruch/TBA ist eine
 *  Aufstufung); DAC, Reserve, Erste Lage, Großes Gewächs und Sekt verlangen mindestens
 *  Qualitätswein (eine Charge „Wein“ oder „Landwein“ wird nie DAC). Sonstiges, Perlwein und
 *  Chargen ohne Niveau (Sekt, Perlwein, Sonstiges, leer) sperren nichts – wie bisher. */
export function istAufstufung(von: string | null | undefined, nach: string | null | undefined): boolean {
  if (!von || !nach || von === nach || nach === 'sonstiges') return false
  const basis = niveau(von)
  const mindestens = istPraedikatsStufe(nach)
    ? nach
    : (istQualitaetsweinBezeichnung(nach) || nach === 'sekt') ? 'qualitaetswein' : null
  if (!basis || !mindestens) return false
  return !istMindestens(basis, mindestens)
}

// ── Stufe einer neuen Pressungs-Charge (KAN-73) ──────────────────────────────

/** Lese-Eintrag (ernte_parzellen) für die Stufe einer Pressung */
export type LeseStufe = {
  weingartenId: string | null
  grundstueckId: string | null
  /** Lesedatum 'JJJJ-MM-TT' */
  datum: string | null
  stufe: string | null
}

/**
 * Lese-Stufe einer Pressungszeile (Weingarten, ggf. GST): die Lese-Einträge desselben
 * Weingartens (mit GST: desselben GST) bis zum Pressungsdatum. Gibt es mehrere, zählt die
 * letzte Lese vor der Pressung (z. B. Eiswein im Dezember nach der Hauptlese im September);
 * mehrere Einträge an diesem Tag bzw. ohne Lesedatum → die niedrigste Stufe. null = keine
 * Lese-Stufe bekannt (dann gilt für diese Trauben die Ableitung aus den °KMW).
 */
export function leseStufeFuerPressung(
  lese: readonly LeseStufe[],
  zeile: { weingartenId: string | null; grundstueckId: string | null },
  pressungsDatum: string | null | undefined,
): string | null {
  if (!zeile.weingartenId) return null
  const tag = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null)
  const bis = tag(pressungsDatum)
  const passend = lese.filter(e =>
    e.weingartenId === zeile.weingartenId
    && (!zeile.grundstueckId || e.grundstueckId === zeile.grundstueckId)
    && (!bis || !tag(e.datum) || (tag(e.datum) as string) <= bis))
  const datiert = passend.map(e => tag(e.datum)).filter((d): d is string => !!d)
  const letzte = datiert.length > 0 ? datiert.reduce((a, b) => (b > a ? b : a)) : null
  const gruppe = letzte ? passend.filter(e => !tag(e.datum) || tag(e.datum) === letzte) : passend
  return minQualitaet(gruppe.map(e => e.stufe))
}

/**
 * Qualitätsstufe einer neuen Pressungs-Charge (KAN-73): je gepresster Zeile die Lese-Stufe
 * (leseStufeFuerPressung; null = unbekannt, z. B. Zukauf), gedeckelt durch die Ableitung aus
 * dem Ø-KMW der Pressung; über alle Zeilen die niedrigste – die Pressung stuft nie auf.
 *  - Eiswein/Strohwein (nicht aus den °KMW ableitbar) bleiben, solange der Ø-KMW BA-Niveau
 *    (25 °KMW) erreicht – bzw. ohne KMW-Wert.
 *  - Zeilen ohne Lese-Stufe: Ableitung aus den °KMW, ohne KMW 'qualitaetswein' (wie bisher).
 * Beispiele: Lese „Wein“ ohne KMW → Wein; Lese „Wein“ bei 16 °KMW → Wein; Lese „Eiswein“ bei
 * 26 °KMW → Eiswein; Lese „Qualitätswein“ bei 18 °KMW → Qualitätswein (vorher Kabinett).
 */
export function pressungsQualitaet(leseStufen: readonly (string | null | undefined)[], kmw: number | null | undefined): string {
  const ausKmw = kmw != null && Number.isFinite(kmw) && kmw > 0 ? kmwZuQualitaet(kmw) : null
  const unbekannt = ausKmw ?? 'qualitaetswein'
  if (leseStufen.length === 0) return unbekannt
  const jeZeile = leseStufen.map(s => {
    if (!istPraedikatsStufe(s)) return unbekannt
    if (!ausKmw) return s
    const zweig = ZWEIG_BASIS.get(s)
    if (zweig && istMindestens(ausKmw, zweig)) return s
    return gemeinsameStufe(s, ausKmw)
  })
  return minQualitaet(jeZeile) ?? unbekannt
}
