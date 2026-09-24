// ── CSV-Baustein „Behördenmeldung“ (Anforderung 24.09.2026) ───────────────────
//
// „Alle Behördenmeldungen müssen zusätzlich mittels CSV ausgegeben werden können.“
// Jede CSV entsteht ausschließlich hier: typisierte Spalten (CsvSpalte) + Profil
// (CsvProfil) → csvText()/csvDatei(). Eigene Serializer (join(';'), new Blob mit
// BOM …) gibt es für Behördenmeldungen nicht mehr.
//
// Profile:
//   PROFIL_EXCEL_AT – Standard für jede Behörden-CSV: UTF-8 mit BOM (U+FEFF), Semikolon,
//                     CRLF auch nach der letzten Zeile, Dezimalkomma ohne Tausenderpunkt,
//                     feste Stellen je Spalte, kaufmännische Rundung, TT.MM.JJJJ, eine
//                     Kopfzeile, Formelschutz (Apostroph) für Text-/Code-Zellen. Wegen des
//                     Apostrophs NICHT für Maschinen-Uploads – dafür gibt es Empfängerprofile.
//   PROFIL_BKI      – EDV-Liste Weindatenbank (BKI): Vorspann (Titel + Leerzeile), BOM,
//                     KEIN abschließendes CRLF, Ja/Nein als „J“/leer, Formelschutz durch ENTFERNEN
//                     führender = + - @ samt Hinweis (ein Apostroph verfälschte den Upload),
//                     Menge_kg ganzzahlig wie bisher, nur Bruchteile mit Dezimalkomma (statt Punkt).
//                     Vor der Freigabe per Test-Upload prüfen.
//   PROFIL_BMD      – BMD-NTCS-Import, byte-identisch zur bisherigen bmdCsv()
//                     (Golden-Files unter scripts/tests/golden/bmd_*.csv).
//
// Regeln (siehe CLAUDE.md „Behördenmeldungen immer auch als CSV“):
//  • Zahl- und Datumsspalten sind typisiert: Werte werden mit Number()/isFinite bzw.
//    einem strengen Datumsmuster geprüft; Ungültiges bleibt leer und erzeugt eine
//    Warnung (X-Warnungen) – so kann ein Text wie „=HYPERLINK(…)“ in einer
//    Zahlspalte den Formelschutz nicht umgehen.
//  • Fehlender Wert = leeres Feld, nie „0“, „–“ oder „null“.
//  • DATE-Werte („JJJJ-MM-TT“) werden stringbasiert formatiert (keine Zeitzone);
//    Zeitpunkte (timestamptz, Date) immer in Europe/Vienna umgerechnet.
//  • Codes (KG-Nr. „04023“, BBCH „05“) gehen unverändert hinaus – kein ="…"-Trick.
//    Wer sie in Excel exakt sehen will, importiert über „Daten › Aus Text/CSV“.
//  • Steuerzeichen U+0000–U+001F (außer TAB), U+007F, U+0085, U+2028/2029 → Leerzeichen,
//    alle Texte NFC-normalisiert.
//
// Diese Datei ist isomorph (Server und Client) und hat bewusst KEINE Imports:
// scripts/tests/csv.test.mjs lädt sie direkt mit Node (Type-Stripping). Deshalb nur
// „löschbare“ TypeScript-Syntax (keine enum/namespace/Parameter-Properties) und keine
// '@/'-Aliase. Den BOM nie als unsichtbares Zeichen in den Quelltext schreiben, immer
// als Escape \uFEFF.

// ── Typen ───────────────────────────────────────────────────────────────────

/**
 * Spaltentyp – bestimmt Formatierung, Prüfung und Formelschutz.
 *  text      Freitext (Formelschutz, Umbrüche → Leerzeichen)
 *  code      Kennung/Nummer als Text (KG-Nr., BBCH, Prüfnummer, Betriebsnummer) – Wert unverändert
 *  ganzzahl  Zahl ohne Nachkommastellen
 *  dezimal   Zahl mit festen Stellen je Spalte (Standard 2, siehe STELLEN)
 *  betrag    Euro-Betrag, 2 Stellen, ohne €-Zeichen (Einheit in den Kopf: „Betrag (€)“)
 *  prozent   Prozentpunkte, 2 Stellen, ohne %-Zeichen: 13 % → „13,00“ (nie 0,13)
 *  datum     Kalendertag TT.MM.JJJJ (DATE stringbasiert, Zeitpunkte in Wiener Zeit)
 *  zeitpunkt TT.MM.JJJJ HH:MM in Europe/Vienna
 *  janein    boolean → „Ja“/„Nein“ (Profil BKI: „J“/leer)
 */
export type CsvTyp = 'text' | 'code' | 'ganzzahl' | 'dezimal' | 'betrag' | 'prozent' | 'datum' | 'zeitpunkt' | 'janein'

export type CsvSpalte<Z> = {
  /** Spaltenkopf wie in der Druckfassung, mit Umlauten und Einheit: „Menge (kg)“, „Fläche (ha)“ */
  kopf: string
  typ: CsvTyp
  /** Rohwert der Zeile – Zahlen als number, Datum als 'JJJJ-MM-TT' bzw. ISO-Zeitpunkt, Ja/Nein als boolean */
  wert: (z: Z) => unknown
  /** Nachkommastellen dieser Spalte (gilt für jede Zeile gleich). 'roh' = String(n) ohne Rundung – nur für
   *  Empfängerprofile mit festgeschriebenem Altverhalten (PROFIL_BMD; PROFIL_BKI Menge_kg, Wert vorher gerundet). */
  stellen?: number | 'roh'
}

export type CsvProfil = {
  name: string
  trenner: ';' | ','
  dezimal: ',' | '.'
  datum: 'TT.MM.JJJJ' | 'JJJJ-MM-TT'
  /** UTF-8-BOM (U+FEFF) an den Anfang */
  bom: boolean
  /** CRLF auch nach der letzten Zeile */
  abschlussCrlf: boolean
  /** bedarf: Trenner, ", CR, LF, Rand-Leerzeichen · minimal: nur Trenner und " · immer: jede Zelle */
  quoten: 'bedarf' | 'minimal' | 'immer'
  /** weitere Zeichen, die Anführungszeichen auslösen (BKI: ',') */
  quoteAuch?: string
  /** leerzeichen: alle Steuerzeichen außer TAB → Leerzeichen · nur_umbrueche: nur [\r\n]+ → ein Leerzeichen (BMD) */
  steuerzeichen: 'leerzeichen' | 'nur_umbrueche'
  /** Texte vor der Ausgabe nach NFC normalisieren */
  nfc: boolean
  /** true: Apostroph vor Text-/Code-Zellen, die mit = + - @ TAB CR beginnen (OWASP CSV-Injection) ·
   *  'entfernen': diese Zeichen am Feldanfang entfernen und als Hinweis melden (Maschinen-Upload, wo ein
   *  Apostroph den Wert verfälschen würde – PROFIL_BKI) · false: unverändert (nur PROFIL_BMD, Golden-File) */
  formelschutz: boolean | 'entfernen'
  /** kaufmaennisch: vorzeichensymmetrisch über den Dezimalstring · legacy: Math.round(x·10ⁿ)/10ⁿ (nur BMD) */
  rundung: 'kaufmaennisch' | 'legacy'
  /** Ausgabe für true/false */
  janein: readonly [string, string]
  /** Zeilen vor der Kopfzeile (nur wenn ein Empfänger es vorschreibt) */
  vorspann?: readonly string[]
  /** Text-Zellen auf diese Länge kürzen (mit „…“) */
  maxText?: number
}

// ── Profile ─────────────────────────────────────────────────────────────────

export const PROFIL_EXCEL_AT: CsvProfil = Object.freeze({
  name: 'EXCEL_AT',
  trenner: ';',
  dezimal: ',',
  datum: 'TT.MM.JJJJ',
  bom: true,
  abschlussCrlf: true,
  quoten: 'bedarf',
  steuerzeichen: 'leerzeichen',
  nfc: true,
  formelschutz: true,
  rundung: 'kaufmaennisch',
  janein: ['Ja', 'Nein'] as const,
})

/** BKI – EDV-Liste zum automatischen Einlesen in die Weindatenbank.
 *  BOM ja und KEIN abschließendes CRLF wie bisher (weinhandel/traubenverkauf/datenblatt);
 *  Quoting wie bisher bei ; " und , (Zeilenumbrüche gibt es nach der Bereinigung nicht mehr).
 *  Formelschutz (Review 25.09.2026): führende = + - @ (auch nach Leerzeichen) werden entfernt und
 *  gemeldet – die Datei öffnet sich wegen des BOM per Doppelklick in Excel, Namen und Adressen
 *  stammen aus den Stammdaten (Kontakte/Firmen).
 *  Geändert gegenüber vorher (nachweislich falsch): Datum mit führenden Nullen statt
 *  toLocaleDateString; Menge_kg mit Bruchteil mit Dezimalkomma statt Punkt (ganze kg unverändert
 *  ohne Nachkommastellen, Spalte mit stellen: 'roh' – siehe SPALTEN_BKI_TRAUBENVERKAUF). */
export const PROFIL_BKI: CsvProfil = Object.freeze({
  name: 'BKI',
  trenner: ';',
  dezimal: ',',
  datum: 'TT.MM.JJJJ',
  bom: true,
  abschlussCrlf: false,
  quoten: 'minimal',
  quoteAuch: ',',
  steuerzeichen: 'leerzeichen',
  nfc: true,
  formelschutz: 'entfernen',
  rundung: 'kaufmaennisch',
  janein: ['J', ''] as const,
  vorspann: ['EDV-Liste zum automatischen Einlesen in die Weindatenbank', ''] as const,
})

/** Tooltip für Knöpfe, die eine PROFIL_BKI-Datei liefern (Maschinen-Upload, nicht zum Bearbeiten in Excel) */
export const HINWEIS_BKI_UPLOAD = 'Datei für den Upload in die Weindatenbank (BKI-EDV-Liste) – nicht in Excel bearbeiten und speichern, sonst ändern sich Format und Zahlen.'

/** BMD NTCS – byte-identisch zur bisherigen bmdCsv()/personenkontenCsv():
 *  Kopf ohne Quoting, " nur bei ; oder ", [\r\n]+ → ein Leerzeichen, sonst keine
 *  Bereinigung, keine NFC-Normalisierung, kein Formelschutz, Beträge mit
 *  Math.round(x·100)/100, Prozent/Skonto per stellen: 'roh'. */
export const PROFIL_BMD: CsvProfil = Object.freeze({
  name: 'BMD',
  trenner: ';',
  dezimal: ',',
  datum: 'TT.MM.JJJJ',
  bom: true,
  abschlussCrlf: true,
  quoten: 'minimal',
  steuerzeichen: 'nur_umbrueche',
  nfc: false,
  formelschutz: false,
  rundung: 'legacy',
  janein: ['J', 'N'] as const,
})

/** Feste Nachkommastellen je fachlicher Einheit – eine Spalte hat durchgehend dieselben Stellen.
 *  kg-Spalten mit Bruchteilen (z. B. Cu-Reinmenge) durchgehend kgGenau.
 *  kmw: 2 = verlustfrei für ernte_parzellen.klosterneuburger / weinausbau.kmw (numeric(5,2)) –
 *  eine Rundung auf 1 Stelle könnte über gesetzliche Mindestgradationen springen (18,95 → 19,0).
 *  kmwBki: 1 = Traubenverkauf (kmw_grad numeric(5,1)), BKI-Schnittstelle „KMW_Grad“, Transportbescheinigung. */
export const STELLEN = Object.freeze({
  betrag: 2,
  liter: 2,
  hl: 2,
  kg: 0,
  kgGenau: 2,
  ha: 4,
  prozent: 2,
  kmw: 2,
  kmwBki: 1,
  oechsle: 0,
  ganzzahl: 0,
})

const STANDARD_STELLEN: Record<'ganzzahl' | 'dezimal' | 'betrag' | 'prozent', number> = {
  ganzzahl: 0, dezimal: 2, betrag: 2, prozent: 2,
}

const BOM = '\uFEFF'
const CRLF = '\r\n'

// ── Rundung ─────────────────────────────────────────────────────────────────

/** Dezimaldarstellung ohne Exponent aus der kürzesten Darstellung von String(n) (n ≥ 0) */
function ohneExponent(s: string): string {
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(s)
  if (!m) return s
  const ziffern = m[1] + (m[2] ?? '')
  const punkt = m[1].length + Number(m[3])
  if (punkt <= 0) return '0.' + '0'.repeat(-punkt) + ziffern
  if (punkt >= ziffern.length) return ziffern + '0'.repeat(punkt - ziffern.length)
  return ziffern.slice(0, punkt) + '.' + ziffern.slice(punkt)
}

function plusEins(ziffern: string): string {
  const a = ziffern.split('')
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] === '9') { a[i] = '0'; continue }
    a[i] = String(Number(a[i]) + 1)
    return a.join('')
  }
  return '1' + a.join('')
}

/**
 * Kaufmännisch gerundet (halbe Einheit vom Nullpunkt weg, vorzeichensymmetrisch) als
 * Dezimalstring mit Punkt und genau `stellen` Nachkommastellen. Grundlage ist die
 * kürzeste Darstellung der Zahl (String(n)) – 1.005 → "1.01", −2.5 → "-3",
 * 0.1 + 0.2 → "0.30". Ergebnis 0 ohne Minuszeichen.
 */
export function rundeText(n: number, stellen: number): string {
  if (!Number.isFinite(n)) throw new RangeError('rundeText: keine endliche Zahl')
  const st = Math.max(0, Math.min(20, Math.trunc(stellen)))
  const [ganz, bruch = ''] = ohneExponent(String(Math.abs(n))).split('.')
  let ergebnis: string
  if (bruch.length <= st) {
    ergebnis = st > 0 ? `${ganz}.${bruch.padEnd(st, '0')}` : ganz
  } else {
    let ziffern = ganz + bruch.slice(0, st)
    if (bruch.charCodeAt(st) >= 53 /* '5' */) ziffern = plusEins(ziffern)
    const g = ziffern.slice(0, ziffern.length - st).replace(/^0+(?=\d)/, '') || '0'
    ergebnis = st > 0 ? `${g}.${ziffern.slice(ziffern.length - st)}` : g
  }
  const null_ = /^[0.]*$/.test(ergebnis)
  return (n < 0 && !null_ ? '-' : '') + ergebnis
}

/** Kaufmännisch gerundete Zahl – Ladefunktionen liefern damit bereits gerundete Zeilenwerte,
 *  Druck-Summen summieren genau diese (CSV und Ausdruck stimmen überein). */
export function runden(n: number, stellen: number): number {
  return Number(rundeText(n, stellen))
}

function legacyText(n: number, stellen: number): string {
  const f = Math.pow(10, stellen)
  return (Math.round(n * f) / f).toFixed(stellen)
}

// ── Wiener Zeit ─────────────────────────────────────────────────────────────

type Teile = { j: number; m: number; t: number; h: number | null; min: number | null }

let wienFormat: Intl.DateTimeFormat | null = null

function wienTeile(d: Date): Teile {
  if (!wienFormat) {
    wienFormat = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
  }
  const p: Record<string, string> = {}
  for (const x of wienFormat.formatToParts(d)) p[x.type] = x.value
  return { j: Number(p.year), m: Number(p.month), t: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) }
}

const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i

function gueltigerTag(j: number, m: number, t: number): boolean {
  if (m < 1 || m > 12 || t < 1 || t > 31) return false
  const d = new Date(Date.UTC(j, m - 1, t))
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t
}

/** null = leer, undefined = ungültig */
function datumTeile(v: unknown): Teile | null | undefined {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : wienTeile(v)
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s === '') return null
  const m = DATUM_RE.exec(s)
  if (!m) return undefined
  const j = Number(m[1]), mo = Number(m[2]), t = Number(m[3])
  if (!gueltigerTag(j, mo, t)) return undefined
  if (m[4] === undefined) return { j, m: mo, t, h: null, min: null }        // DATE: stringbasiert
  const h = Number(m[4]), mi = Number(m[5]), sek = Number(m[6] ?? 0)
  if (h > 23 || mi > 59 || sek > 60) return undefined
  const zone = m[8]
  if (!zone) return { j, m: mo, t, h, min: mi }                              // ohne Zone: Wandzeit
  let versatzMin = 0
  if (zone.toUpperCase() !== 'Z') {
    const vz = zone[0] === '-' ? -1 : 1
    const ziffern = zone.slice(1).replace(':', '')
    versatzMin = vz * (Number(ziffern.slice(0, 2)) * 60 + Number(ziffern.slice(2, 4) || 0))
  }
  const ms = Number((m[7] ?? '').padEnd(3, '0').slice(0, 3))
  return wienTeile(new Date(Date.UTC(j, mo - 1, t, h, mi, sek, ms) - versatzMin * 60000))
}

const zwei = (n: number) => String(n).padStart(2, '0')
const vier = (n: number) => String(n).padStart(4, '0')

/** Heutiges Datum in Wien als 'JJJJ-MM-TT' (Vercel läuft in UTC) */
export function wienHeute(jetzt: Date = new Date()): string {
  const t = wienTeile(jetzt)
  return `${vier(t.j)}-${zwei(t.m)}-${zwei(t.t)}`
}

/** Zeitpunkt (timestamptz-String oder Date) in Wiener Zeit: { datum: 'JJJJ-MM-TT', uhrzeit: 'HH:MM' }.
 *  Ein reines DATE ('JJJJ-MM-TT') bleibt der Tag selbst mit uhrzeit null. Ungültig/leer → null. */
export function wienZeitpunkt(wert: unknown): { datum: string; uhrzeit: string | null } | null {
  const t = datumTeile(wert)
  if (!t) return null
  return { datum: `${vier(t.j)}-${zwei(t.m)}-${zwei(t.t)}`, uhrzeit: t.h === null ? null : `${zwei(t.h)}:${zwei(t.min ?? 0)}` }
}

/** Kalendertag eines Zeitpunkts in Wien als 'JJJJ-MM-TT' (z. B. storniert_am mit einem Stichtag vergleichen) */
export function wienDatum(wert: unknown): string | null {
  return wienZeitpunkt(wert)?.datum ?? null
}

// ── Zellen ──────────────────────────────────────────────────────────────────

/** fehler = Wert ungültig (Feld leer gelassen) · hinweis = Wert verändert ausgegeben */
type ZellErgebnis = { text: string; fehler?: string; hinweis?: string }

const ZAHL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** null = leer, undefined = ungültig */
function alsZahl(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '') return null
    if (!ZAHL_RE.test(s)) return undefined
    const n = Number(s)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function alsText(v: unknown): string | undefined {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'bigint' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v) && v.every(x => x === null || x === undefined || ['string', 'number', 'bigint', 'boolean'].includes(typeof x))) {
    return v.filter(x => x !== null && x !== undefined && x !== '').map(String).join(', ')
  }
  return undefined
}

// U+0000–U+001F außer TAB (U+0009), U+007F, U+0085, U+2028, U+2029
const STEUER_RE = /[\u0000-\u0008\u000A-\u001F\u007F\u0085\u2028\u2029]/g
const UMBRUCH_RE = /\r\n/g
const FORMEL_RE = /^(?:[\t\r]|[ \u00A0\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/

function bereinigen(s: string, profil: CsvProfil): string {
  let t = profil.nfc ? s.normalize('NFC') : s
  if (profil.steuerzeichen === 'leerzeichen') t = t.replace(UMBRUCH_RE, ' ').replace(STEUER_RE, ' ')
  else t = t.replace(/[\r\n]+/g, ' ')
  return t
}

function quoten(s: string, profil: CsvProfil, erzwingen = false): string {
  let noetig = erzwingen || profil.quoten === 'immer' || s.includes(profil.trenner) || s.includes('"')
  if (!noetig && profil.quoten === 'bedarf') noetig = /[\r\n]/.test(s) || /^[ \t]|[ \t]$/.test(s)
  if (!noetig && profil.quoteAuch) noetig = [...profil.quoteAuch].some(c => s.includes(c))
  return noetig ? `"${s.replace(/"/g, '""')}"` : s
}

const FORMEL_ANFANG_RE = /^[\s 　=+\-@＝＋－＠]+/
const HINWEIS_FORMEL_ENTFERNT = 'mit Formelzeichen am Anfang (= + - @) – Zeichen entfernt, Stammdaten prüfen'

/** Text-/Code-Zelle bereinigen, kürzen und gegen Formeln schützen; entfernt = Formelzeichen entfernt */
function textZelleMitHinweis(roh: string, typ: 'text' | 'code', profil: CsvProfil): { text: string; entfernt: boolean } {
  let s = bereinigen(roh, profil)
  if (typ === 'text' && profil.maxText && profil.maxText > 1) {
    const zeichen = Array.from(s)
    if (zeichen.length > profil.maxText) s = zeichen.slice(0, profil.maxText - 1).join('') + '…'
  }
  if (profil.formelschutz && FORMEL_RE.test(s)) {
    if (profil.formelschutz === 'entfernen') return { text: s.replace(FORMEL_ANFANG_RE, ''), entfernt: true }
    s = `'${s}`
  }
  return { text: s, entfernt: false }
}

function textZelle(roh: string, typ: 'text' | 'code', profil: CsvProfil): string {
  return textZelleMitHinweis(roh, typ, profil).text
}

function zahlText(n: number, stellen: number | 'roh', profil: CsvProfil): string {
  const s = stellen === 'roh'
    ? String(n)
    : profil.rundung === 'legacy' ? legacyText(n, stellen) : rundeText(n, stellen)
  return profil.dezimal === '.' ? s : s.replace('.', profil.dezimal)
}

function datumText(t: Teile, profil: CsvProfil, mitZeit: boolean): string {
  const d = profil.datum === 'JJJJ-MM-TT' ? `${vier(t.j)}-${zwei(t.m)}-${zwei(t.t)}` : `${zwei(t.t)}.${zwei(t.m)}.${vier(t.j)}`
  return mitZeit && t.h !== null ? `${d} ${zwei(t.h)}:${zwei(t.min ?? 0)}` : d
}

function janein(v: unknown): boolean | null | undefined {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  if (v === 1 || v === 0) return v === 1
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 't') return true
    if (s === 'false' || s === 'f') return false
  }
  return undefined
}

/** Zelle formatieren – ohne Quoting (Rohtext) plus Grund, falls der Wert ungültig war */
function zelleRoh(wert: unknown, typ: CsvTyp, profil: CsvProfil, stellen?: number | 'roh'): ZellErgebnis {
  switch (typ) {
    case 'text':
    case 'code': {
      const s = alsText(wert)
      if (s === undefined) return { text: '', fehler: 'nicht als Text darstellbar' }
      const t = textZelleMitHinweis(s, typ, profil)
      return t.entfernt ? { text: t.text, hinweis: HINWEIS_FORMEL_ENTFERNT } : { text: t.text }
    }
    case 'ganzzahl':
    case 'dezimal':
    case 'betrag':
    case 'prozent': {
      const n = alsZahl(wert)
      if (n === null) return { text: '' }
      if (n === undefined) return { text: '', fehler: 'keine gültige Zahl' }
      return { text: zahlText(n, stellen ?? STANDARD_STELLEN[typ], profil) }
    }
    case 'datum':
    case 'zeitpunkt': {
      const t = datumTeile(wert)
      if (t === null) return { text: '' }
      if (t === undefined) return { text: '', fehler: 'kein gültiges Datum' }
      return { text: datumText(t, profil, typ === 'zeitpunkt') }
    }
    case 'janein': {
      const b = janein(wert)
      if (b === null) return { text: '' }
      if (b === undefined) return { text: '', fehler: 'kein Ja/Nein-Wert' }
      return { text: textZelle(b ? profil.janein[0] : profil.janein[1], 'code', profil) }
    }
  }
}

/** Eine Zelle fertig formatiert (inkl. Quoting). Ungültige Werte ergeben ein leeres Feld. */
export function csvZelle(wert: unknown, typ: CsvTyp, profil: CsvProfil = PROFIL_EXCEL_AT, stellen?: number | 'roh'): string {
  return quoten(zelleRoh(wert, typ, profil, stellen).text, profil)
}

// ── Datei ───────────────────────────────────────────────────────────────────

export type CsvErgebnis = { text: string; zeilen: number; warnungen: string[] }

function zeileVerbinden(zellen: string[], profil: CsvProfil): string {
  return zellen.join(profil.trenner)
}

/** Datei als Text plus Warnungen zu ungültigen Werten (je Spalte zusammengefasst). */
export function csvDatei<Z>(zeilen: readonly Z[], spalten: readonly CsvSpalte<Z>[], profil: CsvProfil = PROFIL_EXCEL_AT): CsvErgebnis {
  if (spalten.length === 0) throw new Error('csvDatei: keine Spalten definiert')
  const linien: string[] = []
  for (const v of profil.vorspann ?? []) linien.push(quoten(textZelle(v, 'text', { ...profil, formelschutz: false }), profil))

  const kopf = spalten.map((s, i) => {
    const t = textZelle(s.kopf, 'text', profil)
    // SYLK-Falle: ohne BOM hält Excel eine Datei, die mit „ID“ beginnt, für SYLK
    const erzwingen = i === 0 && !profil.bom && linien.length === 0 && /^ID/.test(t)
    return quoten(t, profil, erzwingen)
  })
  linien.push(zeileVerbinden(kopf, profil))

  // Ungültige Werte (Feld leer) und Hinweise (Wert verändert) je Spalte zusammenfassen
  const fehler = new Map<string, { kopf: string; grund: string; leer: boolean; nr: number[] }>()
  const merken = (si: number, kopf: string, grund: string, leer: boolean, nr: number) => {
    const key = `${si}|${leer ? 'f' : 'h'}|${grund}`
    const f = fehler.get(key) ?? { kopf, grund, leer, nr: [] }
    f.nr.push(nr)
    fehler.set(key, f)
  }
  zeilen.forEach((z, zi) => {
    linien.push(zeileVerbinden(spalten.map((s, si) => {
      const e = zelleRoh(s.wert(z), s.typ, profil, s.stellen)
      if (e.fehler) merken(si, s.kopf, e.fehler, true, zi + 1)
      if (e.hinweis) merken(si, s.kopf, e.hinweis, false, zi + 1)
      return quoten(e.text, profil)
    }), profil))
  })

  const warnungen = [...fehler.values()].map(f => {
    const liste = f.nr.slice(0, 5).join(', ') + (f.nr.length > 5 ? ' …' : '')
    const menge = `${f.nr.length} ${f.nr.length === 1 ? 'Wert' : 'Werte'}`
    return f.leer
      ? `Spalte „${f.kopf}“: ${menge} ${f.grund} – Feld leer gelassen (Datensatz ${liste})`
      : `Spalte „${f.kopf}“: ${menge} ${f.grund} (Datensatz ${liste})`
  })

  const text = (profil.bom ? BOM : '') + linien.join(CRLF) + (profil.abschlussCrlf ? CRLF : '')
  return { text, zeilen: zeilen.length, warnungen }
}

/** Datei als Text: BOM, Vorspann, eine Kopfzeile, eine Zeile je Datensatz, CRLF (Leermeldung = nur Kopf). */
export function csvText<Z>(zeilen: readonly Z[], spalten: readonly CsvSpalte<Z>[], profil: CsvProfil = PROFIL_EXCEL_AT): string {
  return csvDatei(zeilen, spalten, profil).text
}

// ── Dateiname ───────────────────────────────────────────────────────────────

export type CsvDateiname = { ascii: string; utf8: string }

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', ẞ: 'SS' }

function teilUtf8(s: string): string {
  return s.normalize('NFC')
    .replace(/[^A-Za-z0-9._\-\u00C0-\u024F]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 80)
}

function teilAscii(s: string): string {
  return teilUtf8(s)
    .replace(/[äöüÄÖÜßẞ]/g, c => TRANSLIT[c] ?? c)
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
}

/**
 * Dateiname nach Muster <Meldung>_<Betriebsnummer>_<Jahrgang|Zeitraum|Beleg>_<Erstelldatum>.csv,
 * z. B. Erntemeldung_1234567_2026_2026-09-24.csv. Leere Teile entfallen.
 * ascii für filename="…" (ä→ae, ß→ss, nur [A-Za-z0-9._-]), utf8 für filename*=UTF-8''….
 */
export function csvDateiname(teile: readonly (string | number | null | undefined)[], erstellt: string | null = wienHeute()): CsvDateiname {
  const roh = [...teile, erstellt]
    .filter((t): t is string | number => t !== null && t !== undefined && String(t).trim() !== '')
    .map(String)
  const utf8 = roh.map(teilUtf8).filter(Boolean).join('_') || 'Export'
  const ascii = roh.map(teilAscii).filter(Boolean).join('_') || 'Export'
  return { utf8: `${utf8}.csv`, ascii: `${ascii}.csv` }
}

/** Fertigen Dateinamen („Übersicht 2026.csv“) in die ASCII-/UTF-8-Fassung bringen */
export function csvDateinameAus(name: string): CsvDateiname {
  const basis = name.replace(/\.csv$/i, '')
  return { utf8: `${teilUtf8(basis) || 'Export'}.csv`, ascii: `${teilAscii(basis) || 'Export'}.csv` }
}

// ── HTTP-Kopfzeilen (von lib/csv/antwort.ts genutzt, hier testbar) ─────────────

const MAX_WARNUNGEN_HEADER = 3000

/** Einsame Surrogate (halbe Emoji im Rohtext) → U+FFFD – encodeURIComponent würfe sonst URIError.
 *  Bewusst als Schleife statt Lookbehind-Regex (ältere Safari-Versionen kennen keinen Lookbehind). */
function wohlgeformt(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xD800 && c <= 0xDBFF) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++; continue }
      out += '�'
      continue
    }
    out += c >= 0xDC00 && c <= 0xDFFF ? '�' : s[i]
  }
  return out
}

function rfc5987(s: string): string {
  return encodeURIComponent(s).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/**
 * Header einer CSV-Antwort: Content-Type, Content-Disposition (filename + filename*),
 * no-store, nosniff, X-Dateiname/X-Zeilen und – falls vorhanden – X-Warnungen
 * (URI-kodiert, Einträge durch \n getrennt, gekürzt auf ~3 KB) plus X-Warnungen-Anzahl.
 * HTTP-Header sind ByteStrings: alles Nicht-ASCII geht nur URI-kodiert hinaus.
 */
export function csvKopfzeilen(dateiname: CsvDateiname, zeilen: number, warnungen: readonly string[] = []): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${dateiname.ascii.replace(/[^A-Za-z0-9._-]/g, '_')}"; filename*=UTF-8''${rfc5987(dateiname.utf8)}`,
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'X-Dateiname': encodeURIComponent(dateiname.utf8),
    'X-Zeilen': String(zeilen),
  }
  const eindeutig = [...new Set(warnungen.map(w => w.trim()).filter(Boolean))]
  if (eindeutig.length > 0) {
    let kodiert = ''
    for (const w of eindeutig) {
      // nach Codepoints kürzen – ein halbes Surrogatpaar (Emoji in Ried-/Kundennamen) ließe
      // encodeURIComponent mit URIError scheitern und damit den ganzen Export
      const zeichen = Array.from(w)
      const kurz = zeichen.length > 300 ? zeichen.slice(0, 299).join('') + '…' : w
      const teil = encodeURIComponent((kodiert ? '\n' : '') + wohlgeformt(kurz))
      if (kodiert.length + teil.length > MAX_WARNUNGEN_HEADER) break
      kodiert += teil
    }
    h['X-Warnungen'] = kodiert
    h['X-Warnungen-Anzahl'] = String(eindeutig.length)
  }
  return h
}
