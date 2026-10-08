// ── Support-Anfrage aus software:112 an Jira Service Management (KAN-230 Phase 2, 08.10.2026) ──────────
//
// Fachliche Regeln ohne Server-Importe (node:test): welche Anfragearten ein Betrieb sieht, Eingabeprüfung,
// Beschreibung mit Kontext, Priorität aus der Dringlichkeit, Rate-Limit. Die HTTP-Anbindung liegt in
// jsm.ts (server-only), die Route in src/app/api/support/anfragen/route.ts.
//
// Entscheidungen (KAN-227/KAN-230): Melder ist der Benutzer selbst (raiseOnBehalfOf), der Kunde sieht den
// Stand im Portal und in der App; der Mandant schlägt die Priorität vor, wir können sie ändern; Premium-
// Support hat einen eigenen Kanal (Anfragetyp „Premium-Support“, nur mit aktivem Premium-Support);
// Screenshots nur mit ausdrücklicher Zustimmung. Keine Geheimnisse und keine Tokens im Kontext.

export const JSM_SITE = 'https://jorgena.atlassian.net'
/** Service-Desk-ID des Projekts SUP „software:112 Support“ */
export const JSM_SERVICEDESK_ID = '1'

export type AnfrageArt = 'fehler' | 'wunsch' | 'frage' | 'premium'

/** Anfragetyp-Namen in SUP – die Queue „Premium“ und das SLA filtern auf „Premium-Support“ */
export const ANFRAGE_ARTEN: Record<AnfrageArt, { name: string; label: string }> = {
  fehler:  { name: 'Fehler melden',   label: 'Fehler melden' },
  wunsch:  { name: 'Wunsch/Idee',     label: 'Wunsch oder Idee' },
  frage:   { name: 'Frage',           label: 'Frage zur Bedienung' },
  premium: { name: 'Premium-Support', label: 'Premium-Support (Reaktion in 2–4 Stunden)' },
}

export function erlaubteArten(premiumAktiv: boolean): AnfrageArt[] {
  return premiumAktiv ? ['premium', 'fehler', 'wunsch', 'frage'] : ['fehler', 'wunsch', 'frage']
}

export function istAnfrageArt(v: unknown): v is AnfrageArt {
  return v === 'fehler' || v === 'wunsch' || v === 'frage' || v === 'premium'
}

export type Dringlichkeit = 'niedrig' | 'normal' | 'hoch'
export const DRINGLICHKEITEN: Record<Dringlichkeit, { label: string; prioritaet: string }> = {
  niedrig: { label: 'Niedrig – kann warten',               prioritaet: 'Low' },
  normal:  { label: 'Normal',                              prioritaet: 'Medium' },
  hoch:    { label: 'Hoch – behindert die tägliche Arbeit', prioritaet: 'High' },
}

export function istDringlichkeit(v: unknown): v is Dringlichkeit {
  return v === 'niedrig' || v === 'normal' || v === 'hoch'
}

export const MAX_BETREFF = 200
export const MAX_BESCHREIBUNG = 10000
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const SCREENSHOT_TYPEN = ['image/png', 'image/jpeg', 'image/webp'] as const
/** höchstens so viele Anfragen je Benutzer im Zeitfenster */
export const RATE_LIMIT = { anzahl: 5, minuten: 10 } as const

export type AnfrageEingabe = {
  art: unknown
  betreff: unknown
  beschreibung: unknown
  dringlichkeit: unknown
  screenshot?: { typ: string; groesse: number } | null
  screenshotZustimmung?: boolean
}

/** Typ und Größe des Screenshots – dieselbe Prüfung im Browser (Auswahl, Ziehen, Einfügen) und im Server (KAN-234) */
export function screenshotFehler(s: { typ: string; groesse: number }): string | null {
  if (!(SCREENSHOT_TYPEN as readonly string[]).includes(s.typ)) return 'Screenshot bitte als PNG, JPG oder WebP.'
  if (s.groesse > MAX_SCREENSHOT_BYTES) return 'Der Screenshot darf höchstens 5 MB groß sein.'
  return null
}

export function anfrageEingabeFehler(e: AnfrageEingabe, premiumAktiv: boolean): string | null {
  if (!istAnfrageArt(e.art) || !erlaubteArten(premiumAktiv).includes(e.art)) return 'Bitte eine Anfrageart wählen.'
  const betreff = typeof e.betreff === 'string' ? e.betreff.trim() : ''
  const beschreibung = typeof e.beschreibung === 'string' ? e.beschreibung.trim() : ''
  if (betreff.length < 3) return 'Bitte einen Betreff mit mindestens 3 Zeichen angeben.'
  if (betreff.length > MAX_BETREFF) return `Der Betreff darf höchstens ${MAX_BETREFF} Zeichen haben.`
  if (beschreibung.length < 10) return 'Bitte beschreiben Sie Ihr Anliegen mit mindestens 10 Zeichen.'
  if (beschreibung.length > MAX_BESCHREIBUNG) return `Die Beschreibung darf höchstens ${MAX_BESCHREIBUNG} Zeichen haben.`
  if (!istDringlichkeit(e.dringlichkeit)) return 'Bitte eine Dringlichkeit wählen.'
  if (e.screenshot) {
    if (!e.screenshotZustimmung) return 'Bitte bestätigen Sie, dass der Screenshot mitgesendet werden darf.'
    const f = screenshotFehler(e.screenshot)
    if (f) return f
  }
  return null
}

/** Nur der Pfad der Seite, von der gemeldet wird – ohne Query/Fragment (könnten Daten enthalten) */
export function seiteBereinigen(roh: unknown): string | null {
  if (typeof roh !== 'string' || !roh.trim()) return null
  let pfad = roh.trim()
  try {
    pfad = new URL(pfad, 'https://x.invalid').pathname
  } catch {
    return null
  }
  if (!pfad.startsWith('/')) return null
  return pfad.slice(0, 300)
}

/** Browser kurz – nur die User-Agent-Zeile, gekürzt */
function browserText(ua: string | null | undefined): string {
  return (ua ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300) || 'unbekannt'
}

export type AnfrageKontext = {
  betriebName: string
  tenantId: string
  benutzerName: string | null
  benutzerEmail: string
  rolle: string
  seite: string | null
  userAgent: string | null
  appVersion: string | null
  zeitpunkt: string
}

/** Beschreibung für Jira: Text des Benutzers + Kontextblock (nur IDs und Namen, keine Geheimnisse) */
export function beschreibungMitKontext(text: string, k: AnfrageKontext): string {
  const zeilen = [
    text.trim(),
    '',
    '----',
    'Gemeldet aus software:112',
    `Betrieb: ${k.betriebName} (${k.tenantId})`,
    `Benutzer: ${k.benutzerName ? `${k.benutzerName} <${k.benutzerEmail}>` : k.benutzerEmail}, Rolle: ${k.rolle}`,
    `Seite: ${k.seite ?? 'unbekannt'}`,
    `Browser: ${browserText(k.userAgent)}`,
    `App-Version: ${k.appVersion ?? 'unbekannt'}`,
    `Zeitpunkt: ${k.zeitpunkt}`,
  ]
  return zeilen.join('\n')
}

export function rateLimitFehler(anzahlImFenster: number): string | null {
  return anzahlImFenster >= RATE_LIMIT.anzahl
    ? `Sie haben in den letzten ${RATE_LIMIT.minuten} Minuten bereits ${RATE_LIMIT.anzahl} Anfragen gesendet. Bitte versuchen Sie es etwas später noch einmal.`
    : null
}

export function portalLink(issueKey: string): string {
  return `${JSM_SITE}/servicedesk/customer/portal/${JSM_SERVICEDESK_ID}/${encodeURIComponent(issueKey)}`
}

/** JQL-Wert sicher in Anführungszeichen */
export function jqlString(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// ── KAN-235: Verlauf und Antworten in software:112 (statt Portal-Login) ─────────────────────────────────────
// Antworten schreibt die App über das Agent-Konto der Anbindung als öffentlichen Kommentar; die erste Zeile nennt den
// Benutzer, damit Support und Verlauf erkennen, dass die Antwort vom Kunden kommt.

export const MAX_ANTWORT = 5000
const ANTWORT_KOPF = /^Antwort von (.+?) \(über software:112\):\n/

/** Anfrage-Schlüssel des Projekts SUP (z. B. „SUP-12“) – alles andere wird abgelehnt */
export function supportKeyGueltig(key: unknown): key is string {
  return typeof key === 'string' && /^SUP-[1-9]\d{0,8}$/.test(key)
}

export function antwortFehler(text: unknown): string | null {
  const t = typeof text === 'string' ? text.trim() : ''
  if (t.length < 2) return 'Bitte eine Antwort eingeben.'
  if (t.length > MAX_ANTWORT) return `Die Antwort darf höchstens ${MAX_ANTWORT} Zeichen haben.`
  return null
}

/** Kommentartext einer Antwort aus software:112 (erste Zeile: wer antwortet) */
export function antwortKommentar(benutzer: string, text: string): string {
  return `Antwort von ${benutzer.replace(/[\r\n]+/g, ' ').trim()} (über software:112):\n${text.trim()}`
}

/** Kommentar zerlegen: Antwort aus software:112 (dann ohne Kopfzeile) oder Nachricht des Supports */
export function kommentarZerlegen(body: string): { vonKunde: boolean; name: string | null; text: string } {
  const m = ANTWORT_KOPF.exec(body.replace(/\r\n/g, '\n'))
  if (!m) return { vonKunde: false, name: null, text: body.trim() }
  return { vonKunde: true, name: m[1], text: body.replace(/\r\n/g, '\n').slice(m[0].length).trim() }
}

/** Beschreibung ohne den angehängten Kontextblock (beschreibungMitKontext) – der Benutzer sieht nur seinen Text */
export function beschreibungOhneKontext(text: string): string {
  const t = text.replace(/\r\n/g, '\n')
  const i = t.lastIndexOf('\n----\nGemeldet aus software:112')
  return (i >= 0 ? t.slice(0, i) : t).trim()
}

// ── KAN-236: Rückruf anfordern ──────────────────────────────────────────────────────────────────────────────
// Eigener Anfragetyp in SUP (Name exakt „Rückruf“, legt Jörgen in JSM an), Priorität immer Highest.

export const RUECKRUF_ANFRAGETYP = 'Rückruf'
export const RUECKRUF_PRIORITAET = 'Highest'
export const MAX_RUECKRUF_TEXT = 500

/** Telefonnummer bereinigen: Ziffern, führendes +, Leerzeichen und / - ( ); 6–20 Ziffern – sonst null */
export function telefonNormalisieren(roh: unknown): string | null {
  if (typeof roh !== 'string') return null
  const t = roh.trim().replace(/\s+/g, ' ')
  if (!/^\+?[\d\s/()-]+$/.test(t)) return null
  const ziffern = t.replace(/\D/g, '').length
  return ziffern >= 6 && ziffern <= 20 ? t : null
}

export type RueckrufEingabe = { telefon: unknown; anliegen?: unknown; zeitfenster?: unknown }

export function rueckrufFehler(e: RueckrufEingabe): string | null {
  if (!telefonNormalisieren(e.telefon)) return 'Bitte eine gültige Telefonnummer angeben (z. B. +43 664 1234567).'
  for (const [wert, name] of [[e.anliegen, 'Anliegen'], [e.zeitfenster, 'Erreichbarkeit']] as const) {
    if (wert != null && typeof wert !== 'string') return `${name}: ungültige Eingabe.`
    if (typeof wert === 'string' && wert.trim().length > MAX_RUECKRUF_TEXT) return `${name}: höchstens ${MAX_RUECKRUF_TEXT} Zeichen.`
  }
  return null
}

/** Betreff und Text der Rückruf-Anfrage (Kontextblock hängt beschreibungMitKontext an) */
export function rueckrufText(e: { telefon: string; anliegen?: string | null; zeitfenster?: string | null }): { betreff: string; text: string } {
  const zeilen = [
    `Bitte um Rückruf unter ${e.telefon}.`,
    e.zeitfenster?.trim() ? `Am besten erreichbar: ${e.zeitfenster.trim()}` : null,
    e.anliegen?.trim() ? `Anliegen: ${e.anliegen.trim()}` : null,
  ].filter((z): z is string => !!z)
  return { betreff: `Rückruf erbeten: ${e.telefon}`, text: zeilen.join('\n') }
}
