// ── Lesen je Jahrgang (KAN-129, 29.09.2026) ───────────────────────────────────────────────────────────────
//
// Ein Jahrgang je Betrieb, darunter beliebig viele Lesen mit laufender Nummer: 2026/1 Hauptlese,
// 2026/2 Eiswein im Jänner 2027 … (Tabelle lesen, Migration 20260929154715_lesen_je_jahrgang). Die Nummer
// vergibt die Datenbank; Lese-Einträge und Pressungen hängen an genau einer Lese.
//
// Entscheidungen Jörgen (29.09.2026): Beginn und Ende einer Lese liegen im Jahrgangsjahr oder im Folgejahr
// bis zum 31.03. (Eiswein, wie das Lesedatum der Pressung, KAN-126); löschen dürfen nur Betriebsleiter –
// und nur die höchste, leere Lese, nie die einzige (prüft auch die Datenbank).
//
// Ohne '@/'-Importe und ohne JSX, damit node:test sie prüfen kann (Formular und Server nutzen dieselben Regeln).

export const LESE_ARTEN = ['hauptlese', 'vorlese', 'nachlese', 'eiswein', 'sonstige'] as const
export type LeseArt = typeof LESE_ARTEN[number]

export const LESE_ART_LABEL: Record<LeseArt, string> = {
  hauptlese: 'Hauptlese',
  vorlese:   'Vorlese',
  nachlese:  'Nachlese',
  eiswein:   'Eiswein',
  sonstige:  'Sonstige',
}

/** Lese, soweit Liste, Reiter und Formulare sie brauchen */
export type Lese = {
  id: string
  lfd_nr: number
  art: string
  bezeichnung: string | null
  beginn: string | null
  ende: string | null
  notizen: string | null
}

/** Letzter zulässiger Tag im Folgejahr des Jahrgangs (Eiswein), als 'MM-TT' – wie LESE_FOLGEJAHR_BIS (KAN-126) */
export const LESE_ZEITRAUM_FOLGEJAHR_BIS = '03-31'

const TAG = /^\d{4}-\d{2}-\d{2}$/

function kalendertag(d: string | null | undefined): string | null {
  const t = String(d ?? '').slice(0, 10)
  if (!TAG.test(t)) return null
  const [j, m, tt] = t.split('-').map(Number)
  const x = new Date(Date.UTC(j, m - 1, tt))
  return x.getUTCFullYear() === j && x.getUTCMonth() === m - 1 && x.getUTCDate() === tt ? t : null
}

function tagText(t: string): string {
  const [j, m, d] = t.split('-')
  return `${d}.${m}.${j}`
}

export function istLeseArt(v: unknown): v is LeseArt {
  return typeof v === 'string' && (LESE_ARTEN as readonly string[]).includes(v)
}

export function leseArtText(art: string | null | undefined): string {
  return istLeseArt(art) ? LESE_ART_LABEL[art] : (art || '–')
}

/** „2026/2“ */
export function leseNummer(jahrgang: number | string, lfdNr: number): string {
  return `${jahrgang}/${lfdNr}`
}

/** „2026/2 Eiswein“ bzw. „2026/2 Eiswein – Grüner Veltliner Hohenstein“ */
export function leseTitel(jahrgang: number | string, lese: Pick<Lese, 'lfd_nr' | 'art' | 'bezeichnung'>): string {
  const basis = `${leseNummer(jahrgang, lese.lfd_nr)} ${leseArtText(lese.art)}`
  return lese.bezeichnung?.trim() ? `${basis} – ${lese.bezeichnung.trim()}` : basis
}

/** „12.09.2026 – 10.10.2026“, „ab 12.09.2026“, „bis …“ oder null */
export function leseZeitraumText(beginn: string | null | undefined, ende: string | null | undefined): string | null {
  const b = kalendertag(beginn)
  const e = kalendertag(ende)
  if (b && e) return b === e ? tagText(b) : `${tagText(b)} – ${tagText(e)}`
  if (b) return `ab ${tagText(b)}`
  if (e) return `bis ${tagText(e)}`
  return null
}

/** Jahrgang, den „Neue Lese“ vorschlägt: im Jänner und Februar der Vorjahrgang (Eiswein), sonst das laufende Jahr.
 *  `heute` = lokaler Tag in Wien ('JJJJ-MM-TT', lokalerTag(wienJetzt())). */
export function vorgeschlagenerJahrgang(heute: string): number {
  const jahr = Number(heute.slice(0, 4))
  const monat = Number(heute.slice(5, 7))
  return monat <= 2 ? jahr - 1 : jahr
}

/** Jahrgang aus dem Formular: ganze Zahl von 1900 bis 2100, sonst null */
export function jahrgangAusEingabe(v: unknown): number | null {
  const t = String(v ?? '').trim()
  if (!/^\d{4}$/.test(t)) return null
  const n = Number(t)
  return n >= 1900 && n <= 2100 ? n : null
}

/**
 * Prüft Beginn und Ende einer Lese: gültige Kalendertage, Ende nicht vor Beginn, beide im Jahrgangsjahr
 * oder im Folgejahr bis zum 31.03. Leere Felder sind erlaubt. Liefert den Fehlertext oder null.
 */
export function leseZeitraumFehler(jahrgang: number, beginn: string | null, ende: string | null): string | null {
  const felder: [string, string | null][] = [['Beginn', beginn], ['Ende', ende]]
  const von = `${jahrgang}-01-01`
  const bis = `${jahrgang + 1}-${LESE_ZEITRAUM_FOLGEJAHR_BIS}`
  for (const [name, wert] of felder) {
    if (wert == null || wert === '') continue
    const t = kalendertag(wert)
    if (!t) return `${name} der Lese ist kein gültiges Datum.`
    if (t < von || t > bis) {
      return `${name} der Lese (${tagText(t)}) liegt außerhalb des Jahrgangs ${jahrgang} – zulässig ist der `
        + `${tagText(von)} bis ${tagText(bis)} (Eiswein im Folgejahr bis Ende März).`
    }
  }
  const b = kalendertag(beginn)
  const e = kalendertag(ende)
  if (b && e && e < b) return `Das Ende der Lese (${tagText(e)}) liegt vor ihrem Beginn (${tagText(b)}).`
  return null
}

/**
 * Welche Lese die Jahrgangsseite zeigt: `?lese=<Nr.>`, sonst die mit der höchsten Nummer (die jüngste
 * Lesekampagne). Unbekannte Nummer → ebenfalls die höchste. Leere Liste → null.
 */
export function gewaehlteLese<L extends Pick<Lese, 'lfd_nr'>>(lesen: L[], param: string | string[] | undefined): L | null {
  if (lesen.length === 0) return null
  const roh = Array.isArray(param) ? param[0] : param
  const nr = roh != null && /^\d{1,2}$/.test(roh.trim()) ? Number(roh.trim()) : null
  const treffer = nr == null ? undefined : lesen.find(l => l.lfd_nr === nr)
  return treffer ?? lesen.reduce((max, l) => (l.lfd_nr > max.lfd_nr ? l : max))
}

/**
 * Warum eine Lese nicht gelöscht werden kann (null = löschbar) – dieselben Regeln wie der Trigger
 * a_lesen_vor_loeschen und der Fremdschlüssel (Einträge, Pressungen, Traubenverkäufe).
 */
export function leseLoeschsperre(
  lese: Pick<Lese, 'lfd_nr'>, alleNummern: number[],
  belegt: { eintraege: number; pressungen: number; traubenverkaeufe: number },
): string | null {
  if (alleNummern.length <= 1) return 'Die einzige Lese eines Jahrgangs kann nicht gelöscht werden.'
  const max = Math.max(...alleNummern)
  if (lese.lfd_nr < max) return `Nur die Lese mit der höchsten Nummer (${max}) kann gelöscht werden.`
  const gruende: string[] = []
  if (belegt.eintraege > 0) gruende.push(`${belegt.eintraege} ${belegt.eintraege === 1 ? 'Lese-Eintrag' : 'Lese-Einträge'}`)
  if (belegt.pressungen > 0) gruende.push(`${belegt.pressungen} ${belegt.pressungen === 1 ? 'Pressung' : 'Pressungen'}`)
  if (belegt.traubenverkaeufe > 0) gruende.push(`${belegt.traubenverkaeufe} ${belegt.traubenverkaeufe === 1 ? 'Traubenverkauf' : 'Traubenverkäufe'}`)
  return gruende.length > 0
    ? `Die Lese kann nicht gelöscht werden: Es sind noch ${gruende.join(', ')} erfasst. Bitte diese zuerst löschen.`
    : null
}

// ── Eiswein (KAN-129 Soll 2) ──────────────────────────────────────────────────────────────────────────────
// Bei einer Lese der Art „Eiswein“ ist die Stufe Eiswein – nicht die Ableitung aus den °KMW (ab 25 °KMW ergäbe
// die Beerenauslese). Mindestmostgewicht 25 °KMW (§ 11 Abs. 1 Z 6 WeinG) – darunter nur ein Hinweis.

export const EISWEIN_MIN_KMW = 25

/** Stufe einer Lese bzw. Pressung: Eiswein-Lese → 'eiswein', sonst die übergebene Ableitung aus den °KMW */
export function leseStufe(art: string | null | undefined, ausKmw: string): string {
  return art === 'eiswein' ? 'eiswein' : ausKmw
}

/** Hinweis bei einer Eiswein-Lese unter 25 °KMW bzw. ohne Mostgewicht, sonst null */
export function eisweinHinweis(art: string | null | undefined, kmw: number | null | undefined): string | null {
  if (art !== 'eiswein') return null
  if (kmw === null || kmw === undefined || !Number.isFinite(kmw)) {
    return `Eiswein: Mostgewicht nicht erfasst – Eiswein verlangt mindestens ${EISWEIN_MIN_KMW} °KMW (§ 11 Abs. 1 Z 6 WeinG).`
  }
  return kmw < EISWEIN_MIN_KMW
    ? `Eiswein verlangt mindestens ${EISWEIN_MIN_KMW} °KMW (§ 11 Abs. 1 Z 6 WeinG) – erfasst sind ${String(kmw).replace('.', ',')} °KMW. Bitte Mostgewicht bzw. Stufe prüfen.`
    : null
}
