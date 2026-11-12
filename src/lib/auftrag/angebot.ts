// ── Angebot (KAN-418 Teil 4, 12.11.2026) ────────────────────────────────────────────────────────────
//
// Ein Angebot liegt in derselben Tabelle wie die Aufträge (art = 'angebot'), reserviert aber nichts und ist nicht
// lieferbar. Entscheidungen Jörgen 12.11.2026 (alle A):
//   1A mit Preisen als Momentaufnahme (Bruttopreis je Flasche, Kunden- und Sonderrabatt, USt. je Position)
//   2A bearbeitbar, solange „offen“
//   3A ein Auftrag aus einem Angebot trägt dessen Preise – „Liefern“ belegt sie vor (änderbar)
//   4A Übernahme einmal und als Ganzes; danach „angenommen“
// „Abgelaufen“ ist kein Status, sondern ein Hinweis (gültig bis vor heute) – übernehmen bleibt möglich.
// Dieselben Regeln in Formular, Server Action und Datenbank (s112_angebot_anlegen/_aendern). Isomorph, ohne '@/'-Importe.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund2, rundText } from '../zahl/runden.ts'

export const ANGEBOT_POSITIONEN_MAX = 100
export const ANGEBOT_NOTIZ_MAX = 2000
export const ANGEBOT_STORNO_GRUND_MIN = 10
export const ANGEBOT_GRUND_MAX = 500

export type AngebotStatus = 'offen' | 'angenommen' | 'abgelehnt' | 'storniert'
export const ANGEBOT_STATUS_LABEL: Record<AngebotStatus, string> = {
  offen: 'Offen', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt', storniert: 'Storniert',
}

/** Lässt sich das Angebot noch bearbeiten, ablehnen, stornieren bzw. in einen Auftrag übernehmen? */
export function angebotOffen(a: { status?: string | null; storniert_am?: string | null }): boolean {
  return a.status === 'offen' && !a.storniert_am
}

/** Gültigkeit vorbei? (nur Hinweis – ein offenes Angebot bleibt übernehmbar) */
export function angebotAbgelaufen(a: { status?: string | null; gueltig_bis?: string | null }, heute: string): boolean {
  return a.status === 'offen' && !!a.gueltig_bis && a.gueltig_bis < heute
}

export type AngebotPosition = {
  fuellung_id: string
  menge: number
  preis_brutto: number
  rabatt_pct: number
  sonderrabatt_pct: number
  ust_satz: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG = /^\d{4}-\d{2}-\d{2}$/

/** Zahl aus einem Zahlenfeld (type="number": Dezimalpunkt, höchstens zwei Nachkommastellen) bzw. JSON-Zahl; NaN = ungültig.
 *  Bewusst ohne Deutung von Komma oder Tausenderpunkt. */
function zahlFeld(v: unknown, leerIst: number | null): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  const t = typeof v === 'string' ? v.trim() : ''
  if (t === '') return leerIst === null ? NaN : leerIst
  return /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN
}

/** Positionen aus dem Formularfeld (JSON); ganz leere Zeilen fallen weg, null = nicht lesbar */
export function angebotPositionenAus(roh: unknown): AngebotPosition[] | null {
  if (typeof roh !== 'string') return null
  let daten: unknown
  try { daten = JSON.parse(roh) } catch { return null }
  if (!Array.isArray(daten)) return null
  const aus: AngebotPosition[] = []
  for (const z of daten) {
    if (!z || typeof z !== 'object' || Array.isArray(z)) return null
    const r = z as Record<string, unknown>
    const f = typeof r.fuellung_id === 'string' ? r.fuellung_id.trim() : ''
    const leer = (v: unknown) => v === '' || v === null || v === undefined
    if (!f && leer(r.menge) && leer(r.preis_brutto)) continue
    if (f && !UUID.test(f)) return null
    const menge = typeof r.menge === 'number' ? r.menge : typeof r.menge === 'string' && /^\d{1,7}$/.test(r.menge.trim()) ? Number(r.menge.trim()) : NaN
    aus.push({
      fuellung_id: f, menge,
      preis_brutto: zahlFeld(r.preis_brutto, null),
      rabatt_pct: zahlFeld(r.rabatt_pct, 0),
      sonderrabatt_pct: zahlFeld(r.sonderrabatt_pct, 0),
      ust_satz: zahlFeld(r.ust_satz, null),
    })
  }
  return aus
}

export type AngebotKopf = { kunde: string; datum: string; gueltig_bis: string; notizen?: string | null }

/** Prüfung des Angebots; null = in Ordnung */
export function angebotFehler(kopf: AngebotKopf, positionen: AngebotPosition[] | null, heute: string): string | null {
  if (!kopf.kunde) return 'Bitte einen Kunden wählen.'
  if (!TAG.test(kopf.datum)) return 'Bitte ein Angebotsdatum angeben.'
  if (kopf.datum > heute) return 'Das Angebotsdatum darf nicht in der Zukunft liegen.'
  if (!TAG.test(kopf.gueltig_bis)) return 'Bitte angeben, bis wann das Angebot gilt.'
  if (kopf.gueltig_bis < kopf.datum) return '„Gültig bis“ darf nicht vor dem Angebotsdatum liegen.'
  if ((kopf.notizen ?? '').length > ANGEBOT_NOTIZ_MAX) return `Die Notiz darf höchstens ${ANGEBOT_NOTIZ_MAX} Zeichen lang sein.`
  if (positionen === null) return 'Die Positionen konnten nicht gelesen werden – bitte die Seite neu laden.'
  if (positionen.length === 0) return 'Bitte mindestens eine Position angeben.'
  if (positionen.length > ANGEBOT_POSITIONEN_MAX) return `Höchstens ${ANGEBOT_POSITIONEN_MAX} Positionen je Angebot.`
  for (const [i, p] of positionen.entries()) {
    const nr = `Position ${i + 1}`
    if (!p.fuellung_id) return `${nr}: Bitte eine Füllung wählen.`
    if (!Number.isInteger(p.menge) || p.menge < 1 || p.menge > 1000000) return `${nr}: Bitte eine Menge ab 1 Flasche angeben.`
    if (!Number.isFinite(p.preis_brutto) || p.preis_brutto < 0) return `${nr}: Bitte einen Preis je Flasche angeben (höchstens zwei Nachkommastellen).`
    if (!Number.isFinite(p.rabatt_pct) || p.rabatt_pct < 0 || p.rabatt_pct > 100) return `${nr}: Der Rabatt muss zwischen 0 und 100 % liegen.`
    if (!Number.isFinite(p.sonderrabatt_pct) || p.sonderrabatt_pct < 0 || p.sonderrabatt_pct > 100) return `${nr}: Der Sonderrabatt muss zwischen 0 und 100 % liegen.`
    if (!Number.isFinite(p.ust_satz) || p.ust_satz < 0 || p.ust_satz > 100) return `${nr}: Bitte den Steuersatz angeben.`
  }
  return null
}

/** Positionen in der Form, die die Datenbank erwartet (Zahlen als Text mit Dezimalpunkt) */
export function angebotPositionenFuerDb(positionen: readonly AngebotPosition[]): Record<string, string>[] {
  return positionen.map(p => ({
    fuellung_id: p.fuellung_id, menge: String(p.menge),
    preis_brutto: rundText(p.preis_brutto, 2), rabatt_pct: rundText(p.rabatt_pct, 2),
    sonderrabatt_pct: rundText(p.sonderrabatt_pct, 2), ust_satz: rundText(p.ust_satz, 2),
  }))
}

export function angebotGrundFehler(status: 'abgelehnt' | 'storniert', grund: unknown): string | null {
  const t = typeof grund === 'string' ? grund.trim() : ''
  if (t.length > ANGEBOT_GRUND_MAX) return `Der Grund darf höchstens ${ANGEBOT_GRUND_MAX} Zeichen lang sein.`
  if (status === 'storniert' && t.length < ANGEBOT_STORNO_GRUND_MIN) return `Bitte einen Grund für den Storno angeben (mindestens ${ANGEBOT_STORNO_GRUND_MIN} Zeichen).`
  return null
}

// ── Beträge ──────────────────────────────────────────────────────────────────────
// Wie im Verkauf (lib/verkauf/rabatt.ts): Zeile brutto = Preis × (1 − Rabatt) × (1 − Sonderrabatt) × Menge, je Zeile
// kaufmännisch auf Cent gerundet; Summen addieren die gerundeten Zeilen (Gesamt = Summe der gedruckten Zeilen).

type BetragsZeile = { menge?: unknown; preis_brutto?: unknown; rabatt_pct?: unknown; sonderrabatt_pct?: unknown; ust_satz?: unknown }
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

/** Preis je Flasche nach beiden Rabatten (brutto, auf Cent gerundet) */
export function angebotEinzelpreis(p: BetragsZeile): number {
  return rund2(n(p.preis_brutto) * (1 - n(p.rabatt_pct) / 100) * (1 - n(p.sonderrabatt_pct) / 100))
}

/** Bruttobetrag der Zeile (auf Cent gerundet) */
export function angebotZeileBrutto(p: BetragsZeile): number {
  return rund2(n(p.preis_brutto) * (1 - n(p.rabatt_pct) / 100) * (1 - n(p.sonderrabatt_pct) / 100) * n(p.menge))
}

/** Rabatte einer Zeile als Text („10 % + 5 %“), '' ohne Rabatt */
export function angebotRabattText(p: BetragsZeile): string {
  const teile = [n(p.rabatt_pct), n(p.sonderrabatt_pct)].filter(x => x > 0).map(x => `${String(rund2(x)).replace('.', ',')} %`)
  return teile.join(' + ')
}

export type AngebotSummen = { brutto: number; netto: number; ust: { satz: number; netto: number; steuer: number }[]; flaschen: number }

/** Summen des Angebots: brutto je Steuersatz, daraus Netto und Steuer (herausgerechnet, je Satz gerundet) */
export function angebotSummen(positionen: readonly BetragsZeile[]): AngebotSummen {
  const jeSatz = new Map<number, number>()
  let flaschen = 0
  for (const p of positionen) {
    const satz = n(p.ust_satz)
    jeSatz.set(satz, rund2((jeSatz.get(satz) ?? 0) + angebotZeileBrutto(p)))
    flaschen += Math.max(0, Math.trunc(n(p.menge)))
  }
  const ust = [...jeSatz.entries()].sort((a, b) => a[0] - b[0]).map(([satz, brutto]) => {
    const netto = rund2(brutto / (1 + satz / 100))
    return { satz, netto, steuer: rund2(brutto - netto) }
  })
  const brutto = rund2([...jeSatz.values()].reduce((s, x) => s + x, 0))
  return { brutto, netto: rund2(ust.reduce((s, x) => s + x.netto, 0)), ust, flaschen }
}

// ── Texte (PDF und Mail) ───────────────────────────────────────────────────────────────

/** JJJJ-MM-TT → TT.MM.JJJJ, rein auf dem Text */
export function angebotDatum(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Sätze unter den Positionen (PDF) */
export function angebotHinweise(gueltigBis: string | null | undefined): string[] {
  const bis = angebotDatum(gueltigBis)
  return [
    bis ? `Dieses Angebot gilt bis ${bis}.` : 'Dieses Angebot ist freibleibend.',
    'Das Angebot ist freibleibend, die Ware ist nicht reserviert.',
  ]
}

export function angebotDateiname(nummer: string | null | undefined): string {
  const t = String(nummer ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return `Angebot-${t || 'Angebot'}.pdf`
}

export function angebotBetreff(nummer: string, betrieb: string): string {
  return `Angebot ${nummer} von ${betrieb}`.trim()
}

export function angebotMailText(p: { kundenName: string | null; nummer: string; gueltigBis: string | null | undefined; nachricht?: string | null; betrieb: string }): string {
  const bis = angebotDatum(p.gueltigBis)
  const nachricht = (p.nachricht ?? '').trim()
  return [
    p.kundenName ? `Sehr geehrte Damen und Herren, ${p.kundenName},` : 'Sehr geehrte Damen und Herren,',
    '',
    `anbei erhalten Sie unser Angebot ${p.nummer}.${bis ? ` Es gilt bis ${bis}.` : ''}`,
    ...(nachricht ? ['', nachricht] : []),
    '',
    'Freundliche Grüße',
    p.betrieb,
  ].join('\n')
}

/** Gibt es zu diesem Angebot ein PDF bzw. einen Versand? (nicht bei storniertem Angebot) */
export function angebotVersendbar(a: { status?: string | null; storniert_am?: string | null }): boolean {
  return !a.storniert_am && a.status !== 'storniert'
}
