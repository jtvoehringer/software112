// ── Weinexport: Ausfuhr- und Gelangensnachweis (KAN-440 Teil 2, 13.11.2026) ──
// Bisher gab es am Exportauftrag keinen Platz für den Nachweis der steuerfreien Lieferung: keine MRN der
// Ausfuhranmeldung, keinen Beleg, keine Frist. Jetzt: mehrere Belege je Auftrag (Tabelle export_nachweise, Datei im
// privaten Speicher export-nachweise) und eine Fristanzeige (Entscheidungen Jörgen 13.11.2026):
//
//   Frist ab dem Rechnungsdatum (Lieferung), ersatzweise dem Versanddatum – für Ausfuhr (Drittland) und
//   innergemeinschaftliche Lieferung (EU) gleich: offen → Hinweis ab 30 Tagen → Warnung ab 5 Monaten → überfällig
//   ab 6 Monaten. Mustersendungen und Lieferungen im Inland haben keine Frist.
//
// Die 6 Monate sind die Frist für den Ausfuhrnachweis; für den Gelangensnachweis gibt es keine feste Frist – die
// gleiche Staffel ist eine betriebliche Vorgabe, keine Rechtsauskunft. Isomorph, ohne '@/'-Importe (node:test).

export const NACHWEIS_BUCKET = 'export-nachweise'

export const NACHWEIS_ARTEN = {
  ausgangsvermerk: 'Ausgangsvermerk / Ausfuhrbestätigung (Zoll)',
  gelangensbestaetigung: 'Gelangensbestätigung des Abnehmers',
  frachtbrief: 'Frachtbrief (CMR) mit Empfangsbestätigung',
  spediteurbescheinigung: 'Spediteurbescheinigung',
  sonstiger: 'Sonstiger Nachweis',
} as const
export type NachweisArt = keyof typeof NACHWEIS_ARTEN

export function istNachweisArt(v: unknown): v is NachweisArt {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(NACHWEIS_ARTEN, v)
}

export type NachweisGebiet = 'inland' | 'eu' | 'drittland' | null

/** Arten in der Reihenfolge, die zum Lieferfall passt (die übliche zuerst – Vorbelegung der Auswahl) */
export function nachweisArtenFuer(gebiet: NachweisGebiet): NachweisArt[] {
  return gebiet === 'eu'
    ? ['gelangensbestaetigung', 'frachtbrief', 'spediteurbescheinigung', 'sonstiger', 'ausgangsvermerk']
    : ['ausgangsvermerk', 'spediteurbescheinigung', 'frachtbrief', 'sonstiger', 'gelangensbestaetigung']
}

/** „Ausfuhrnachweis“ (Drittland) bzw. „Gelangensnachweis“ (EU) */
export function nachweisName(gebiet: NachweisGebiet): string {
  return gebiet === 'eu' ? 'Gelangensnachweis' : 'Ausfuhrnachweis'
}

// ── Datei ──
export const NACHWEIS_TYPEN: Record<string, string> = {
  'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP',
}
export const NACHWEIS_ACCEPT = Object.keys(NACHWEIS_TYPEN).join(',')
/** Vercel nimmt höchstens 4,5 MB je Anfrage an */
export const NACHWEIS_MAX_BYTES = 4 * 1024 * 1024

export function nachweisDateiFehler(d: { name: string; type: string; size: number } | null | undefined): string | null {
  if (!d || !d.name) return 'Bitte den Beleg als Datei wählen.'
  if (!d.size) return `Die Datei „${d.name}“ ist leer.`
  if (!NACHWEIS_TYPEN[d.type]) return `„${d.name}“: nicht unterstütztes Dateiformat – bitte PDF, JPEG, PNG oder WebP.`
  if (d.size > NACHWEIS_MAX_BYTES) return 'Die Datei ist zu groß (höchstens 4 MB).'
  return null
}

/** Ablagepfad: <betrieb>/<auftrag>/<zeit>-<dateiname> – so prüft ihn auch die Datenbank (CHECK, Speicher-Policies) */
export function nachweisPfad(tenantId: string, auftragId: string, dateiname: string, zeitstempel: number): string {
  const sicher = dateiname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'nachweis'
  return `${tenantId}/${auftragId}/${zeitstempel}-${sicher}`
}

const TAG = /^\d{4}-\d{2}-\d{2}$/

/** Art, Datum und Notiz eines Nachweises; null = in Ordnung */
export function nachweisEingabeFehler(e: { art: unknown; datum: unknown; notiz?: unknown }, heute: string): string | null {
  if (!istNachweisArt(e.art)) return 'Bitte die Art des Nachweises wählen.'
  if (typeof e.datum !== 'string' || !TAG.test(e.datum) || Number.isNaN(Date.parse(`${e.datum}T00:00:00Z`))) return 'Bitte das Datum des Nachweises angeben.'
  if (e.datum > heute) return 'Das Datum des Nachweises liegt in der Zukunft.'
  if (typeof e.notiz === 'string' && e.notiz.trim().length > 400) return 'Die Notiz darf höchstens 400 Zeichen lang sein.'
  return null
}

// ── Ausfuhranmeldung ──
/** MRN ohne Leerzeichen, in Großbuchstaben ('' = keine) */
export function mrnBereinigt(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : ''
}

/** MRN (18 Zeichen, Buchstaben und Ziffern) und Datum der Ausfuhranmeldung; beide dürfen leer sein */
export function ausfuhranmeldungFehler(e: { mrn: unknown; datum: unknown }, heute: string): string | null {
  const mrn = mrnBereinigt(e.mrn)
  if (mrn && !/^[A-Z0-9]{18}$/.test(mrn)) return 'Die MRN hat 18 Zeichen (Buchstaben und Ziffern), z. B. 26AT100000ABCDEFG1.'
  const d = typeof e.datum === 'string' ? e.datum.trim() : ''
  if (d) {
    if (!TAG.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return 'Das Datum der Ausfuhranmeldung ist ungültig.'
    if (d > heute) return 'Das Datum der Ausfuhranmeldung liegt in der Zukunft.'
  }
  return null
}

// ── Frist ──
export const NACHWEIS_FRIST_MONATE = 6
export const NACHWEIS_WARNUNG_MONATE = 5
export const NACHWEIS_HINWEIS_TAGE = 30

export type NachweisStufe = 'keine' | 'erledigt' | 'ohne' | 'offen' | 'hinweis' | 'warnung' | 'ueberfaellig'

export type NachweisFrist = {
  stufe: NachweisStufe
  /** letzter Tag der Frist (JJJJ-MM-TT) – null ohne Fristbeginn bzw. ohne Frist */
  faelligAm: string | null
  /** Text für Auftrag, Liste und Dashboard ('' bei „keine“) */
  text: string
}

export type NachweisStand = {
  status?: string | null
  storniert_am?: string | null
  mustersendung?: boolean | null
  verkaufsposten_id?: string | null
  abschluss_ohne_nachweis?: string | null
  versanddatum?: string | null
  /** Anzahl erfasster Nachweise */
  nachweise: number
  /** Datum der Rechnung zum Auftrag (Lieferung) */
  rechnungsdatum?: string | null
  gebiet: NachweisGebiet
}

/** Kalendertag plus Monate (Monatsende bleibt Monatsende: 31.08. + 6 Monate = 28./29.02.) – reine Datumsrechnung in UTC */
export function plusMonate(tag: string, monate: number): string {
  const [j, m, t] = tag.split('-').map(Number)
  const ziel = new Date(Date.UTC(j, m - 1 + monate, 1))
  const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0)).getUTCDate()
  ziel.setUTCDate(Math.min(t, letzter))
  return `${ziel.getUTCFullYear()}-${String(ziel.getUTCMonth() + 1).padStart(2, '0')}-${String(ziel.getUTCDate()).padStart(2, '0')}`
}

function plusTage(tag: string, tage: number): string {
  const d = new Date(`${tag}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

const at = (tag: string) => tag.split('-').reverse().join('.')
const tagAus = (v: unknown): string | null => (typeof v === 'string' && TAG.test(v.slice(0, 10)) ? v.slice(0, 10) : null)

/** Stand des Nachweises eines Exportauftrags zum Stichtag `heute` (JJJJ-MM-TT, Wiener Kalendertag) */
export function nachweisFrist(a: NachweisStand, heute: string): NachweisFrist {
  const keine: NachweisFrist = { stufe: 'keine', faelligAm: null, text: '' }
  if (a.storniert_am || a.mustersendung || (a.gebiet !== 'eu' && a.gebiet !== 'drittland')) return keine
  const name = nachweisName(a.gebiet)
  if (a.nachweise > 0) return { stufe: 'erledigt', faelligAm: null, text: `${name} liegt vor.` }
  if (a.abschluss_ohne_nachweis) return { stufe: 'ohne', faelligAm: null, text: `Ohne ${name} abgeschlossen: ${a.abschluss_ohne_nachweis}` }
  // erst mit der Lieferung läuft etwas: Rechnung gestellt bzw. Status ab „Versendet“
  if (!a.verkaufsposten_id && a.status !== 'versendet' && a.status !== 'abgeschlossen') return keine
  const beginn = tagAus(a.rechnungsdatum) ?? tagAus(a.versanddatum)
  if (!beginn) return { stufe: 'offen', faelligAm: null, text: `${name} fehlt noch.` }
  const faelligAm = plusMonate(beginn, NACHWEIS_FRIST_MONATE)
  if (heute > faelligAm) return { stufe: 'ueberfaellig', faelligAm, text: `${name} fehlt – Frist am ${at(faelligAm)} abgelaufen (${NACHWEIS_FRIST_MONATE} Monate nach der Lieferung).` }
  if (heute >= plusMonate(beginn, NACHWEIS_WARNUNG_MONATE)) return { stufe: 'warnung', faelligAm, text: `${name} fehlt – Frist bis ${at(faelligAm)}.` }
  if (heute >= plusTage(beginn, NACHWEIS_HINWEIS_TAGE)) return { stufe: 'hinweis', faelligAm, text: `${name} fehlt seit über ${NACHWEIS_HINWEIS_TAGE} Tagen – Frist bis ${at(faelligAm)}.` }
  return { stufe: 'offen', faelligAm, text: `${name} noch offen – Frist bis ${at(faelligAm)}.` }
}

/** Stufen, die in Liste und Dashboard als offene Aufgabe erscheinen */
export function nachweisOffen(f: NachweisFrist): boolean {
  return f.stufe === 'offen' || f.stufe === 'hinweis' || f.stufe === 'warnung' || f.stufe === 'ueberfaellig'
}
