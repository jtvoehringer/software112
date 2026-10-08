// ── Microsoft-365-Token: Fehlereinstufung, Refresh-Scope, „Neu verbinden nötig“ (KAN-125, 08.10.2026) ───────────
//
// Bis KAN-125 wurde jeder Fehler beim Token-Refresh zu einem rohen „Token-Refresh fehlgeschlagen: {JSON}“, und jeder
// Cron-Lauf bzw. Seitenaufruf fragte Microsoft erneut – bei fehlender Zustimmung (AADSTS65001 consent_required nach
// einer Scope-Erweiterung) täglich derselbe Fehler, und /nachrichten zeigte rohes JSON ohne Ausweg.
//   - invalid_grant (Zustimmung fehlt, Refresh-Token abgelaufen oder widerrufen, interaction_required): die Verbindung
//     kann sich nicht selbst erholen → „neu verbinden“. Die Verbindung verliert ihre Tokens (sie sind wertlos) und
//     bekommt in email_spiegel_info den Vermerk „Neu verbinden nötig seit … (AADSTS…)“; Spiegelung und Seiten
//     fragen Microsoft dann nicht mehr, /nachrichten zeigt den Hinweis mit „Neu verbinden“ und „Trennen“.
//   - invalid_client / unauthorized_client: Problem der App des Betriebs (z. B. Client-Secret abgelaufen) – keine
//     Markierung je Benutzer, aber eigene Meldung.
//   - alles andere (Netzwerk, 5xx, Drosselung): vorübergehend, nichts markieren.
// Refresh-Scope: der gespeicherte, tatsächlich erteilte Scope der Verbindung (Altverbindungen ohne Eintrag: Basis-
// Scope) – immer mit offline_access, sonst liefert Microsoft keinen neuen Refresh-Token und die Verbindung läuft nach
// Ablauf des alten still aus. Der beim Refresh gelieferte Scope wird gespeichert; eine spätere Scope-Erweiterung sperrt
// bestehende Verbindungen damit nicht mehr aus.
// Isomorph und ohne '@/'-Importe (node:test).

export type TokenFehlerArt = 'neu_verbinden' | 'app' | 'voruebergehend'

export class M365TokenFehler extends Error {
  readonly art: TokenFehlerArt
  readonly code: string | null
  constructor(art: TokenFehlerArt, code: string | null, meldung: string) {
    super(meldung)
    this.name = 'M365TokenFehler'
    this.art = art
    this.code = code
  }
}

/** Antwort des Token-Endpunkts einstufen (status = HTTP-Status, text = Antworttext) */
export function tokenFehlerEinstufen(status: number, text: string): { art: TokenFehlerArt; code: string | null } {
  let j: Record<string, unknown> = {}
  try { j = JSON.parse(text) as Record<string, unknown> } catch { /* kein JSON (z. B. HTML einer Störung) */ }
  const fehler = typeof j.error === 'string' ? j.error : ''
  const beschreibung = typeof j.error_description === 'string' ? j.error_description : text
  const code = /AADSTS\d+/.exec(beschreibung)?.[0] ?? null
  if (fehler === 'invalid_grant' || fehler === 'interaction_required' || fehler === 'consent_required') return { art: 'neu_verbinden', code: code ?? fehler }
  if (fehler === 'invalid_client' || fehler === 'unauthorized_client') return { art: 'app', code: code ?? fehler }
  return { art: 'voruebergehend', code: code ?? (status ? `HTTP ${status}` : null) }
}

/** Fehler für die Antwort des Token-Endpunkts – ohne Rohtext (kann Kennungen enthalten) */
export function tokenFehler(status: number, text: string): M365TokenFehler {
  const { art, code } = tokenFehlerEinstufen(status, text)
  const was = art === 'neu_verbinden' ? NEU_VERBINDEN_TEXT
    : art === 'app' ? 'Die Microsoft-365-App des Betriebs wird abgelehnt (Client-Secret abgelaufen oder App geändert) – bitte in der Mandantenverwaltung prüfen.'
    : 'Microsoft 365 ist gerade nicht erreichbar – bitte später erneut versuchen.'
  return new M365TokenFehler(art, code, `${was}${code ? ` (${code})` : ''}`)
}

export const NEU_VERBINDEN_TEXT = 'Die Microsoft-365-Verbindung muss neu hergestellt werden (Zustimmung fehlt oder abgelaufen).'
const NEU_VERBINDEN_PRAEFIX = 'Neu verbinden nötig'

/** Vermerk in user_email_connections.email_spiegel_info */
export function neuVerbindenVermerk(code: string | null, zeitpunkt: Date): string {
  return `${NEU_VERBINDEN_PRAEFIX} seit ${zeitpunkt.toISOString().slice(0, 16)}${code ? ` (${code})` : ''}`
}

/** Ist die Verbindung als „neu verbinden nötig“ markiert? */
export function istNeuVerbinden(info: unknown): boolean {
  return typeof info === 'string' && info.startsWith(NEU_VERBINDEN_PRAEFIX)
}

/** Scope für den Refresh: gespeicherter (erteilter) Scope bzw. Basis-Scope, immer mit offline_access */
export function refreshScope(gespeichert: unknown, basis: string): string {
  const s = (typeof gespeichert === 'string' && gespeichert.trim()) || basis
  const teile = s.split(/\s+/).filter(Boolean)
  return teile.some(t => t.toLowerCase() === 'offline_access') ? teile.join(' ') : ['offline_access', ...teile].join(' ')
}

/** Bezeichnung einer Verbindung für Meldungen – nie leer (Adresse, Name, geteilte Mailbox, Benutzer-ID) */
export function verbindungName(uc: { email_address?: unknown; anzeigename?: unknown; monitored_email?: unknown; user_id?: unknown }): string {
  for (const v of [uc.email_address, uc.anzeigename, uc.monitored_email, uc.user_id]) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return 'Postfach ohne Bezeichnung'
}
