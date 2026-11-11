// ── Verkauf aus einer E-Mail (KAN-411 Teil 1, 11.11.2026) ────────────────────────────────────────────────────────────
//
// An einer Mail eines bekannten Absenders (Kontakt bzw. Firma) startet „Verkauf anlegen“ das Formular „Neuer Verkauf“
// mit vorbelegtem Kunden; der Mailtext steht daneben. Der Verkauf merkt sich die Unterhaltung der Mail
// (verkaufsposten.email_conversation_id, email_betreff) – die Mail-Ansicht zeigt damit, dass es zu dieser Unterhaltung
// schon einen Verkauf gibt. Nach dem Speichern wird eine Antwort an den Kunden vorbereitet (Entwurf im Verfassen-Fenster,
// gesendet wird erst durch den Benutzer). Nur Microsoft-365-Postfächer (dort liefert die App den Mailtext).
// Ohne KI: Positionen trägt der Benutzer selbst ein (KI-Vorschlag = Teil 2).
// Isomorph, ohne '@/'-Importe (node:test) – gemeinsam für Mail-Ansicht, Formular und Server Action.

/** Höchstlänge wie die CHECKs verkaufsposten_email_conversation_chk und verkaufsposten_email_betreff_chk */
export const EMAIL_BEZUG_MAX = 300
/** sessionStorage-Schlüssel für den Antwort-Entwurf (Text gehört nicht in die URL) */
export const ENTWURF_SCHLUESSEL = 's112.verkaufAntwort'

export type Postfach = 'own' | 'shared'
export type MailBezug = {
  /** Nachrichten-ID im Postfach (nur zum Laden der Mail – ändert sich beim Verschieben) */
  mailId: string
  postfach: Postfach
  /** Kunde im Format der Partnersuche: „kontakt:<id>“ bzw. „firma:<id>“; leer = nicht zugeordnet */
  kunde: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ziel des Knopfs „Verkauf anlegen“ an einer Mail */
export function verkaufAusMailPfad(kunde: { typ: string; id: string } | null, mailId: string, postfach: Postfach): string {
  const p = new URLSearchParams()
  if (kunde && UUID.test(kunde.id)) p.set(kunde.typ === 'firma' ? 'firma' : 'kontakt', kunde.id)
  p.set('mail', mailId)
  if (postfach === 'shared') p.set('postfach', 'shared')
  return '/weinhandel/verkauf/neu?' + p.toString()
}

/** Bezug aus der Adresszeile des Formulars; null = normaler neuer Verkauf */
export function mailBezugAusSuche(suche: string): MailBezug | null {
  const p = new URLSearchParams(suche)
  const mailId = (p.get('mail') ?? '').trim()
  if (!mailId || mailId.length > 500) return null
  const firma = p.get('firma') ?? '', kontakt = p.get('kontakt') ?? ''
  const kunde = UUID.test(firma) ? 'firma:' + firma : UUID.test(kontakt) ? 'kontakt:' + kontakt : ''
  return { mailId, postfach: p.get('postfach') === 'shared' ? 'shared' : 'own', kunde }
}

function tagWien(zeitpunkt: string | null | undefined): string {
  if (!zeitpunkt) return ''
  const d = new Date(zeitpunkt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Vorschlag für die interne Notiz des Verkaufs */
export function notizAusMail(betreff: string | null | undefined, datum: string | null | undefined): string {
  const tag = tagWien(datum)
  const b = (betreff ?? '').replace(/\s+/g, ' ').trim()
  return 'Bestellung per E-Mail' + (tag ? ' vom ' + tag : '') + (b ? ' („' + b.slice(0, 120) + '“)' : '')
}

function kurz(wert: unknown): string | null {
  const t = wert == null ? '' : String(wert).replace(/\s+/g, ' ').trim()
  return t === '' ? null : t.slice(0, EMAIL_BEZUG_MAX)
}

/** Werte für verkaufsposten aus dem Formular: ohne Unterhaltung kein Bezug (auch kein Betreff) */
export function emailBezugWerte(unterhaltung: unknown, betreff: unknown): { email_conversation_id: string | null; email_betreff: string | null } {
  const u = unterhaltung == null ? '' : String(unterhaltung).trim()
  if (u === '' || u.length > EMAIL_BEZUG_MAX) return { email_conversation_id: null, email_betreff: null }
  return { email_conversation_id: u, email_betreff: kurz(betreff) }
}

/**
 * Mailtext für die Anzeige neben dem Formular: reiner Text. Liefert das Postfach nur HTML, werden Tags entfernt
 * (Zeilenumbrüche an <br>, </p>, </div>, </li>, </tr> bleiben) – angezeigt wird das Ergebnis immer als Text, nie als HTML.
 */
export function mailTextOhneHtml(text: string | null | undefined, html: string | null | undefined): string {
  const roh = html ?? text ?? ''
  const istHtml = html != null || /<\/?(p|div|br|span|table|html|body)\b/i.test(roh)
  if (!istHtml) return roh.replace(/\r\n?/g, '\n').trim()
  return roh
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim()
}

export type EntwurfPosition = { menge: number; einheit: string; name: string }

function mengeText(m: number): string {
  return String(m).replace('.', ',')   // die eingegebene Menge, unverändert
}

/** Text der vorbereiteten Antwort an den Kunden (Bestätigung der Bestellung) – der Benutzer prüft und sendet selbst */
export function antwortEntwurf(positionen: readonly EntwurfPosition[]): string {
  const zeilen = positionen
    .filter(p => p.name.trim() !== '' && p.menge > 0)
    .map(p => '– ' + mengeText(p.menge) + ' ' + p.einheit + ' ' + p.name.trim())
  return [
    'Guten Tag,',
    '',
    'vielen Dank für die Bestellung. Wir haben sie wie folgt erfasst:',
    '',
    ...(zeilen.length ? zeilen : ['–']),
    '',
    'Freundliche Grüße',
  ].join('\n')
}

export type AntwortEntwurf = { mailId: string; postfach: Postfach; text: string }

/** Entwurf aus dem Zwischenspeicher lesen; alles Unerwartete = kein Entwurf */
export function entwurfAus(roh: string | null | undefined): AntwortEntwurf | null {
  if (!roh) return null
  try {
    const o = JSON.parse(roh) as Partial<AntwortEntwurf> | null
    if (!o || typeof o.mailId !== 'string' || !o.mailId || typeof o.text !== 'string') return null
    return { mailId: o.mailId, postfach: o.postfach === 'shared' ? 'shared' : 'own', text: o.text.slice(0, 5000) }
  } catch {
    return null
  }
}
