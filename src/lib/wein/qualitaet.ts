// Österreichische Weingesetz-Qualitätsstufen (aufsteigend nach Rang)
// Enthält alle Werte die in den Formularen vorkommen können
//
// KAN-74 (02.10.2026): `rang` ist die Stufe der einen Rangfolge aus lib/wein/qualitaetsrang.ts (Test prüft das):
// Eiswein/Strohwein = Beerenauslese, Ausbruch zwischen BA und TBA, DAC/Reserve/Erste Lage/Großes Gewächs und Sekt
// auf Qualitätswein, Perlwein und Sonstiges auf Wein. Vorher DAC = Kabinett und Eiswein über TBA.
//
// KAN-73 (25.09.2026): Jede Auswahlliste bietet genau die Werte an, die der CHECK ihrer
// Zieltabelle zulässt (scripts/tests/qualitaet.test.mjs liest die CHECKs aus den Migrationen):
//   QUALITAET_OPTS        → weinausbau.qualitaetsstufe (Charge, Eröffnungsbestand, Datenimport,
//                           Zukauf mit Zielcharge, Pressung) – weinausbau_qualitaetsstufe_check
//   LESE_QUALITAETEN      → ernte_parzellen.qualitaetsstufe (Lese) – ernte_parzellen_qualitaetsstufe_check;
//                           dieselbe Liste für die Trauben-Qualität beim Traubenverkauf
//                           (traubenverkauf.qualitaetsstufe, ohne CHECK)
//   FUELLUNG_QUALITAETEN  → fuellungen.qualitaet (Füllung neu/bearbeiten) – fuellungen_qualitaet_check
// Server Actions prüfen vor dem Schreiben mit qualitaetFehler() (verständliche Meldung statt 23514).
// Importe: die Rangfolge und der Erzeugnis-Katalog (mit .ts-Endung, damit node:test die Dateien direkt laden kann).
//
// KAN-186 Etappe 2b/2c (02.10.2026): Die Qualitätsauswahl bietet Reserve, Erste Lage, Großes Gewächs, Sekt und
// Perlwein nicht mehr an. Dafür gibt es die Felder „Zusatzbezeichnung“ (ZUSATZ_OPTS, nur Stillwein auf Qualitätswein)
// und „Erzeugnis“ (ERZEUGNIS_OPTS, leer = Wein). Prüfung vor dem Schreiben: qualitaetsAngabeFehler(); Anzeige mit
// Stufe, Zusatz und Erzeugnis: qualitaetAnzeige().

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/buchhaltung/bmd.ts)
import { niedrigsteQualitaet, normalisiereQualitaet, qualitaetsRang, istZusatz, istAltwertQualitaet, GRUNDSTUFE_ZUSATZ, type QualitaetsAngabe, type QualitaetsZeile, type Zusatz } from './qualitaetsrang.ts'
// @ts-expect-error TS5097 – siehe oben
import { KAT_ERZEUGNIS } from '../katalog/bki.ts'

export const QUALITAET_OPTS = [
  { value: 'wein',                 label: 'Wein (ohne Herkunft)',           rang: 0 },
  { value: 'landwein',             label: 'Landwein',                       rang: 1 },
  { value: 'qualitaetswein',       label: 'Qualitätswein',                  rang: 2 },
  { value: 'kabinett',             label: 'Kabinett',                       rang: 3 },
  { value: 'spaetlese',            label: 'Spätlese',                       rang: 4 },
  { value: 'auslese',              label: 'Auslese',                        rang: 5 },
  { value: 'beerenauslese',        label: 'Beerenauslese (BA)',             rang: 6 },
  { value: 'ausbruch',             label: 'Ausbruch',                       rang: 7 },
  { value: 'trockenbeerenauslese', label: 'Trockenbeerenauslese (TBA)',     rang: 8 },
  { value: 'eiswein',              label: 'Eiswein',                        rang: 6 },
  { value: 'strohwein',            label: 'Strohwein / Schilfwein',         rang: 6 },
  // Herkunftsbezeichnung auf Qualitätswein. KAN-186: Reserve, Erste Lage, Großes Gewächs stehen in ZUSATZ_OPTS
  // (Spalte zusatzbezeichnung), Sekt und Perlwein in ERZEUGNIS_OPTS (Spalte erzeugnis)
  { value: 'dac',                  label: 'DAC',                            rang: 2 },
  { value: 'sonstiges',            label: 'Sonstiges',                      rang: 0 },
] as const

export type Qualitaetsstufe = typeof QUALITAET_OPTS[number]['value']

/** Eine Option einer Qualitäts-Auswahlliste */
export type QualitaetsOption = { readonly value: string; readonly label: string; readonly rang: number }

/**
 * Stufen der Lese (KAN-73): Wein bis Trockenbeerenauslese und Eiswein.
 * Bewusst NICHT dabei:
 *  - DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein, Sonstiges – das sind keine
 *    Lese-Stufen, es gibt sie nur an Charge bzw. Füllung (weinausbau/fuellungen);
 *  - Strohwein und Ausbruch – vorerst draußen, Entscheidung nach AP0 (KAN-38).
 */
const LESE_WERTE = [
  'wein', 'landwein', 'qualitaetswein', 'kabinett', 'spaetlese',
  'auslese', 'beerenauslese', 'trockenbeerenauslese', 'eiswein',
] as const satisfies readonly Qualitaetsstufe[]

export type LeseQualitaet = typeof LESE_WERTE[number]

/** Auswahlliste der Lese (ernte_parzellen) und der Trauben-Qualität – aufsteigend nach Rang */
export const LESE_QUALITAETEN: readonly QualitaetsOption[] = QUALITAET_OPTS
  .filter(o => (LESE_WERTE as readonly string[]).includes(o.value))
  .sort((a, b) => a.rang - b.rang)

/** Auswahlliste der Füllung (fuellungen) – seit KAN-73 dieselben 18 Stufen wie die Charge,
 *  damit jede Charge ohne Umweg abgefüllt werden kann (vorher fehlten „Wein“ und „Ausbruch“). */
export const FUELLUNG_QUALITAETEN: readonly QualitaetsOption[] = QUALITAET_OPTS

function inListe(liste: readonly QualitaetsOption[], wert: unknown): boolean {
  return typeof wert === 'string' && liste.some(o => o.value === wert)
}

/** Zulässig für ernte_parzellen.qualitaetsstufe? */
export function istLeseQualitaet(wert: unknown): wert is LeseQualitaet {
  return inListe(LESE_QUALITAETEN, wert)
}

/** Zulässig für weinausbau.qualitaetsstufe (Charge)? */
export function istChargenQualitaet(wert: unknown): wert is Qualitaetsstufe {
  return inListe(QUALITAET_OPTS, wert)
}

/** Zulässig für fuellungen.qualitaet? */
export function istFuellungQualitaet(wert: unknown): wert is Qualitaetsstufe {
  return inListe(FUELLUNG_QUALITAETEN, wert)
}

export type QualitaetsZiel = 'lese' | 'charge' | 'fuellung'

const ZIELE: Record<QualitaetsZiel, { liste: readonly QualitaetsOption[]; wo: string; zusatz: string }> = {
  lese: {
    liste: LESE_QUALITAETEN,
    wo: 'bei der Lese',
    zusatz: ` Bei der Lese sind nur diese Stufen vorgesehen: ${LESE_QUALITAETEN.map(o => o.label).join(', ')}. Strohwein und Ausbruch derzeit nicht (Entscheidung offen); DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein und Sonstiges gehören nicht zur Lese (nur Charge bzw. Füllung).`,
  },
  charge:   { liste: QUALITAET_OPTS,       wo: 'bei einer Kellerbuch-Charge', zusatz: ' Bitte eine Stufe aus der Auswahlliste wählen.' },
  fuellung: { liste: FUELLUNG_QUALITAETEN, wo: 'bei einer Füllung',           zusatz: ' Bitte eine Stufe aus der Auswahlliste wählen.' },
}

/**
 * Serverprüfung vor dem Schreiben (KAN-73): Meldung, wenn `wert` für das Ziel nicht zulässig
 * ist, sonst null. Leer (null, undefined, '') liefert null – ob ein leerer Wert erlaubt ist,
 * entscheidet der Aufrufer wie bisher.
 *
 *   const fehler = qualitaetFehler('lese', wert)
 *   if (fehler) throw new AktionsFehler(fehler)
 */
export function qualitaetFehler(ziel: QualitaetsZiel, wert: string | null | undefined): string | null {
  if (wert == null || wert === '') return null
  const z = ZIELE[ziel]
  if (inListe(z.liste, wert)) return null
  const bekannt = inListe(QUALITAET_OPTS, wert)
  return `Die Qualitätsstufe „${bekannt ? qualitaetLabel(wert) : wert}“ ist ${z.wo} ${bekannt ? 'nicht zulässig' : 'unbekannt'}.${z.zusatz}`
}

/** Vergleichsschlüssel ohne Groß-/Kleinschreibung, Umlaute, Akzente und Satzzeichen */
function textSchluessel(s: string): string {
  return s.normalize('NFC').trim().toLocaleLowerCase('de')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * KAN-42 (CSV-Import Eröffnungsbestand): Stufe aus Wert oder Bezeichnung der Liste des Ziels – „Qualitätswein“,
 * „qualitaetswein“, „Spätlese“, „Beerenauslese (BA)“, „BA“, „Strohwein“. null = leer oder nicht in der Liste
 * (Altwerte wie „Reserve“ normalisiert der Aufrufer, die Meldung liefert qualitaetFehler()).
 */
export function qualitaetAusText(text: string | null | undefined, ziel: QualitaetsZiel): string | null {
  const s = textSchluessel(String(text ?? ''))
  if (!s) return null
  for (const o of ZIELE[ziel].liste) {
    const ohneKlammer = o.label.replace(/\s*\(.*\)\s*$/, '')
    const kurz = /\(([^)]+)\)/.exec(o.label)?.[1] ?? null
    const teile = o.label.split(/\s*\/\s*/)
    if ([o.value, o.label, ohneKlammer, kurz, ...teile].some(k => k && textSchluessel(k) === s)) return o.value
  }
  return null
}

/**
 * Optionen für Bearbeitungsformulare: Steht der gespeicherte Wert nicht (mehr) in `liste`,
 * bleibt er als eigene Option vorne sichtbar – sonst spränge die Auswahl beim Öffnen still
 * auf die erste Option und das Speichern änderte die Stufe unbemerkt.
 */
export function mitGespeichertemWert(
  liste: readonly QualitaetsOption[],
  gespeichert: string | null | undefined,
): readonly QualitaetsOption[] {
  if (!gespeichert || liste.some(o => o.value === gespeichert)) return liste
  return [{ value: gespeichert, label: `${qualitaetLabel(gespeichert)} (bisheriger Wert)`, rang: 99 }, ...liste]
}

export function qualitaetLabel(value: string | null | undefined): string {
  if (!value) return '–'
  // KAN-186: Altwert im Qualitätsfeld (bis zur Datenumstellung) → „Qualitätswein Reserve“ bzw. „Sekt g.U. (Qualitätswein)“
  if (istAltwertQualitaet(value)) return qualitaetAnzeige({ qualitaetsstufe: value })
  return QUALITAET_OPTS.find(o => o.value === value)?.label ?? value
}

// ── KAN-186: Zusatzbezeichnung und Erzeugnis ─────────────────────────────────────────────────────────────

/** Zusatzbezeichnungen (Spalte zusatzbezeichnung; CHECK reserve | grosse_reserve | erste_lage | grosses_gewachs) */
export const ZUSATZ_OPTS: readonly { readonly value: Zusatz; readonly label: string }[] = [
  { value: 'reserve',         label: 'Reserve' },
  { value: 'grosse_reserve',  label: 'Große Reserve' },
  { value: 'erste_lage',      label: 'Erste Lage (ÖTW)' },
  { value: 'grosses_gewachs', label: 'Großes Gewächs' },
]

/** Erzeugnisse, bei denen es keine Zusatzbezeichnung gibt (Sekt-Stufen eigenes Ticket KAN-190) */
export const ERZEUGNIS_OHNE_ZUSATZ: readonly string[] = ['SEKTGU', 'PERLWEIN', 'SCHAUMW', 'PETNAT']

/** Kurze Anzeigenamen einzelner Erzeugnisse (sonst die Katalogbezeichnung) */
const ERZEUGNIS_LABEL: Record<string, string> = { SEKTGU: 'Sekt g.U.', PERLWEIN: 'Perlwein', SCHAUMW: 'Schaumwein', PETNAT: 'PetNat (Pétillant Naturel)' }

/** Erzeugnisse im Weg der Stufe: Wein ohne/mit g.g.A./g.U. ergibt sich aus der Qualitätsstufe, Traubensaft ist kein Wein */
const ERZEUGNIS_AUS_STUFE = ['WEIN', 'WEINSORT', 'WEINGGA', 'WEINGU']

/**
 * Auswahl „Erzeugnis“ (Spalte erzeugnis, FK kat_erzeugnis): bestandsmeldepflichtige Erzeugnisse ohne die, die sich
 * aus der Stufe ergeben. Sekt g.U. und Perlwein zuerst; leer (eigene Option im Formular) = Wein.
 */
export const ERZEUGNIS_OPTS: readonly { readonly value: string; readonly label: string }[] = (() => {
  const liste = (KAT_ERZEUGNIS as readonly { code: string; bezeichnung: string; bsmRelevant: boolean }[])
    .filter(e => e.bsmRelevant && !ERZEUGNIS_AUS_STUFE.includes(e.code))
    .map(e => ({ value: e.code, label: ERZEUGNIS_LABEL[e.code] ?? e.bezeichnung }))
  const vorne = ['SEKTGU', 'PERLWEIN']
  return [...vorne.map(v => liste.find(o => o.value === v)!).filter(Boolean), ...liste.filter(o => !vorne.includes(o.value))]
})()

/** Bezeichnung eines Erzeugnisses (Katalog) – leer → null */
export function erzeugnisLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return ERZEUGNIS_LABEL[code] ?? (KAT_ERZEUGNIS as readonly { code: string; bezeichnung: string }[]).find(e => e.code === code)?.bezeichnung ?? code
}

/** Bezeichnung einer Zusatzbezeichnung – leer → null */
export function zusatzLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return ZUSATZ_OPTS.find(o => o.value === code)?.label ?? code
}

/**
 * Anzeige einer Qualitätsangabe für Listen und Berichte (lange Labels): „Qualitätswein Reserve“,
 * „Sekt g.U. (Qualitätswein)“, „Kabinett“. Nimmt eine Zeile (Altwerte werden normalisiert) oder eine Angabe.
 */
export function qualitaetAnzeige(q: QualitaetsZeile | QualitaetsAngabe | null | undefined): string {
  if (!q) return '–'
  const a: QualitaetsAngabe = 'stufe' in q ? q as QualitaetsAngabe : normalisiereQualitaet(q as QualitaetsZeile)
  const basis = a.stufe ? (QUALITAET_OPTS.find(o => o.value === a.stufe)?.label ?? a.stufe) : ''
  const mitZusatz = [basis, zusatzLabel(a.zusatz)].filter(Boolean).join(' ')
  const e = a.erzeugnis && !ERZEUGNIS_AUS_STUFE.includes(a.erzeugnis) ? erzeugnisLabel(a.erzeugnis) : null
  if (e) return mitZusatz ? `${e} (${mitZusatz})` : e
  return mitZusatz || '–'
}

/** Wie qualitaetAnzeige, aber null statt „–“, wenn die Zeile keine Stufe hat (Berichte, CSV) */
export function qualitaetAnzeigeOderNull(q: QualitaetsZeile | null | undefined): string | null {
  const a = normalisiereQualitaet(q)
  return a.stufe ? qualitaetAnzeige(a) : null
}

/** Angabe aus einem Formular: Stufe (Feld `feld`), zusatzbezeichnung, erzeugnis – Altwerte normalisiert */
export function qualitaetsAngabeAusFormular(formData: FormData, feld: 'qualitaetsstufe' | 'qualitaet' = 'qualitaetsstufe'): QualitaetsAngabe {
  const text = (k: string) => {
    const v = formData.get(k)
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const zusatz = text('zusatzbezeichnung')
  const a = normalisiereQualitaet({ qualitaetsstufe: text(feld), zusatzbezeichnung: zusatz, erzeugnis: text('erzeugnis') })
  // Unbekannte Zusatzbezeichnung nicht still verwerfen – qualitaetsAngabeFehler meldet sie
  return zusatz && !istZusatz(zusatz) ? { ...a, zusatz: zusatz as Zusatz } : a
}

/**
 * Serverprüfung von Zusatzbezeichnung und Erzeugnis (KAN-186) – null = zulässig, sonst die Meldung:
 *  - Zusatzbezeichnung nur Reserve, Große Reserve, Erste Lage, Großes Gewächs; nur auf Qualitätswein (auch bei
 *    DAC-Herkunft) und nicht bei Sekt, Perlwein, Schaumwein oder PetNat
 *  - Erzeugnis aus dem Katalog; Sekt g.U. erst ab Qualitätswein
 * Die Stufe selbst prüft qualitaetFehler().
 */
export function qualitaetsAngabeFehler(a: QualitaetsAngabe): string | null {
  const roh = a as { zusatz: unknown; erzeugnis: unknown; stufe: string | null }
  if (roh.zusatz != null && !istZusatz(roh.zusatz)) return `Die Zusatzbezeichnung „${String(roh.zusatz)}“ ist unbekannt. Möglich: ${ZUSATZ_OPTS.map(o => o.label).join(', ')}.`
  if (roh.erzeugnis != null && !(KAT_ERZEUGNIS as readonly { code: string }[]).some(e => e.code === roh.erzeugnis)) {
    return `Das Erzeugnis „${String(roh.erzeugnis)}“ ist unbekannt – bitte aus der Auswahlliste wählen.`
  }
  if (a.zusatz) {
    if (a.erzeugnis && ERZEUGNIS_OHNE_ZUSATZ.includes(a.erzeugnis)) {
      return `Die Zusatzbezeichnung „${zusatzLabel(a.zusatz)}“ gibt es nur bei Stillwein – nicht bei ${erzeugnisLabel(a.erzeugnis)}.`
    }
    if (a.stufe !== GRUNDSTUFE_ZUSATZ) {
      return `Die Zusatzbezeichnung „${zusatzLabel(a.zusatz)}“ setzt die Qualitätsstufe „Qualitätswein“ voraus (auch bei DAC-Herkunft) – bitte als Stufe „Qualitätswein“ wählen.`
    }
  }
  if (a.erzeugnis === 'SEKTGU') {
    const r = qualitaetsRang(a.stufe)
    if (!r || r.stufe < (qualitaetsRang(GRUNDSTUFE_ZUSATZ)?.stufe ?? 2)) {
      return 'Sekt g.U. setzt mindestens die Qualitätsstufe „Qualitätswein“ voraus.'
    }
  }
  return null
}

/** Ergebnis aus zwei Stufen (Umzug/Zusammenführung) – dieselbe Regel wie der Verschnitt (KAN-74):
 *  gleiche bleiben, sonst die niedrigste Stufe der Achse, Zusatzbezeichnungen nur, wenn beide sie tragen */
export function minQualitaet(a: string | null, b: string | null): string | null {
  return niedrigsteQualitaet([a, b])
}

// ── Abstufen (KAN-81, Pressung seit KAN-126-Nachtrag 29.09.2026) ─────────────────────────────────────
// „händisch downgraden, aber nicht upgraden“: Wählbar sind die Lese-Stufen bis zur Obergrenze (bei der
// Pressung die Stufe aus dem °KMW), vorbelegt mit der Obergrenze. Der Server lehnt höhere Stufen ab.

const rangVon = (wert: string) => QUALITAET_OPTS.find(o => o.value === wert)?.rang ?? null

/** Auswahl beim Abstufen: Lese-Stufen bis einschließlich der Obergrenze, absteigend (Obergrenze zuerst) */
export function abstufungsOptionen(obergrenze: string): readonly QualitaetsOption[] {
  const max = rangVon(obergrenze) ?? 2
  return LESE_QUALITAETEN.filter(o => o.rang <= max).slice().sort((a, b) => b.rang - a.rang)
}

/** null = zulässig (gleich oder niedriger als die Obergrenze), sonst die Meldung */
export function abstufungFehler(wert: string | null | undefined, obergrenze: string): string | null {
  if (!wert) return null
  const r = rangVon(wert)
  const max = rangVon(obergrenze)
  if (r == null || max == null) return null
  return r > max
    ? `Die Qualitätsstufe „${qualitaetLabel(wert)}“ liegt über „${qualitaetLabel(obergrenze)}“ aus dem Mostgewicht – nur Abstufen ist möglich.`
    : null
}
