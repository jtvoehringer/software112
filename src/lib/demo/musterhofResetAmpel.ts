// ── Ampel für den nächtlichen Demo-Reset des Musterhofs (24.10.2026, Auftrag Jörgen) ─────────────────────────
// Die Hohenstein Suite ruft um 03:00 UTC demo_musterhof_zuruecksetzen() und danach demo_musterhof_y2_kette() auf
// (Service-Role, PostgREST). Vom 12. bis 23.10.2026 scheiterte das unbemerkt mit HTTP 409 (KAN-380). Der Vercel-Cron
// /api/cron/musterhof-reset (35 3 * * * UTC) prüft danach nur lesend und mailt jeden Tag eine Ampel an Jörgen:
//   ROT  – letzter_reset liegt vor dem zuletzt fälligen Reset (heute 02:30 UTC, vor 02:30 UTC der Vortag) oder
//          eine Abfrage ist gescheitert,
//   GELB – Reset da, aber Kennzahlen ≠ Sollwerte, Journal-Abweichungen oder überfüllte Gebinde,
//   GRÜN – sonst.
// Isomorph (node:test) – ohne '@/'-Importe; Laden über einen übergebenen Service-Role-Client.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { dbFehlerText } from '../fehler.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { wienJetzt } from '../datum/wien.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { FASSUNG_TOLERANZ_LITER } from '../keller/fassungsvermoegen.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { zahlLokal } from '../format.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Demo-Betrieb „Weingut Musterhof (Demo)“ */
export const MUSTERHOF_TENANT_ID = '33333333-3333-4333-8333-333333333333'

/** Empfänger der täglichen Ampel-Mail (Umgebung MUSTERHOF_RESET_EMPFAENGER überschreibt, sonst Jörgen) */
export const MUSTERHOF_RESET_EMPFAENGER = 'jv@icp-consultants.at'

/** Der Reset läuft um 03:00 UTC – als fällig gilt er ab 02:30 UTC (Uhrabweichung der Hohenstein Suite) */
export const RESET_FAELLIG_UTC = { stunde: 2, minute: 30 }

/**
 * Sollwerte nach einem erfolgreichen Reset (Stand 24.10.2026) – ändern, wenn Demo-Daten umgebaut werden
 * (demo_musterhof_zuruecksetzen bzw. demo_musterhof_y2_kette). kellerbuch_abgeschlossen_bis = 31.07. des Vorjahres.
 */
export const MUSTERHOF_SOLL = {
  chargen: 31,
  verkaufsposten: 28,
  flaschen_bestand: 41030,
  liter_im_keller: 17186,
  journal_buchungen: 33,
  traubenverkauf: 2,
  exportauftraege: 3,
  betriebsmittel: 6,
} as const

export type Kennzahl = keyof typeof MUSTERHOF_SOLL
export const KENNZAHLEN = Object.keys(MUSTERHOF_SOLL) as Kennzahl[]

const BEZEICHNUNG: Record<Kennzahl, string> = {
  chargen: 'Chargen',
  verkaufsposten: 'Verkaufsposten',
  flaschen_bestand: 'Flaschenbestand',
  liter_im_keller: 'Liter im Keller',
  journal_buchungen: 'Journalbuchungen',
  traubenverkauf: 'Traubenverkäufe',
  exportauftraege: 'Exportaufträge',
  betriebsmittel: 'Betriebsmittel',
}

export const ROT_HINWEIS = 'Ursache in den Supabase-Logs (postgres_logs, 03:00 UTC) prüfen; Reset nur nach Jörgens OK manuell nachholen.'

export type UeberfuelltesGebinde = { name: string; volumen_liter: number; inhalt: number }

/** Ergebnis der lesenden Abfragen; `fehler` sammelt gescheiterte Abfragen (nie still als 0 gewertet) */
export type MusterhofPruefung = {
  info: R | null
  journalAbweichungen: number | null
  ueberfuellt: UeberfuelltesGebinde[] | null
  fehler: string[]
}

export type Ampel = 'gruen' | 'gelb' | 'rot'

export type Bewertung = {
  ampel: Ampel
  /** Zeitpunkt des letzten Resets (ISO) bzw. null */
  letzterReset: string | null
  /** Ab diesem Zeitpunkt (UTC) muss der letzte Reset liegen */
  faelligAb: string
  kennzahlen: { schluessel: Kennzahl; bezeichnung: string; ist: number | null; soll: number; ok: boolean }[]
  kellerbuch: { ist: string | null; soll: string; ok: boolean }
  gruende: string[]
}

const zahl = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Zuletzt fälliger Reset: heute 02:30 UTC, vor 02:30 UTC der Vortag (manueller Lauf in der Nacht) */
export function resetFaelligAb(jetzt: Date): Date {
  const f = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate(), RESET_FAELLIG_UTC.stunde, RESET_FAELLIG_UTC.minute))
  if (f.getTime() > jetzt.getTime()) f.setUTCDate(f.getUTCDate() - 1)
  return f
}

/** Soll für kellerbuch_abgeschlossen_bis: 31.07. des Vorjahres (Jahr nach Wiener Kalender) */
export function kellerbuchSoll(jetzt: Date): string {
  return `${wienJetzt(jetzt).getFullYear() - 1}-07-31`
}

export function bewerten(p: MusterhofPruefung, jetzt: Date = new Date()): Bewertung {
  const info = p.info ?? {}
  const gruende: string[] = []
  const faellig = resetFaelligAb(jetzt)

  const letzterReset = typeof info.letzter_reset === 'string' && info.letzter_reset ? info.letzter_reset : null
  const resetZeit = letzterReset ? Date.parse(letzterReset) : NaN
  const resetOk = Number.isFinite(resetZeit) && resetZeit >= faellig.getTime()

  const kennzahlen = KENNZAHLEN.map(k => {
    const ist = zahl(info[k])
    const soll = MUSTERHOF_SOLL[k]
    return { schluessel: k, bezeichnung: BEZEICHNUNG[k], ist, soll, ok: ist !== null && Math.abs(ist - soll) < 0.005 }
  })
  const kbIst = typeof info.kellerbuch_abgeschlossen_bis === 'string' ? info.kellerbuch_abgeschlossen_bis.slice(0, 10) : null
  const kbSoll = kellerbuchSoll(jetzt)
  const kellerbuch = { ist: kbIst, soll: kbSoll, ok: kbIst === kbSoll }

  // ROT: Abfrage gescheitert oder kein Reset seit dem fälligen Zeitpunkt
  for (const f of p.fehler) gruende.push(`Abfrage gescheitert: ${f}`)
  if (!p.fehler.length && !resetOk) {
    gruende.push(letzterReset
      ? `Letzter Reset ${letzterReset} liegt vor dem fälligen Reset (${faellig.toISOString()})`
      : 'Kein letzter Reset gemeldet')
  }
  if (p.fehler.length || !resetOk) return { ampel: 'rot', letzterReset, faelligAb: faellig.toISOString(), kennzahlen, kellerbuch, gruende }

  // GELB: Abweichungen von den Sollwerten
  for (const k of kennzahlen) if (!k.ok) gruende.push(`${k.bezeichnung}: ${k.ist ?? '–'} statt ${k.soll}`)
  if (!kellerbuch.ok) gruende.push(`Kellerbuch abgeschlossen bis ${kbIst ?? '–'} statt ${kbSoll}`)
  if ((p.journalAbweichungen ?? 0) > 0) gruende.push(`${p.journalAbweichungen} Journal-Abweichungen`)
  if ((p.ueberfuellt?.length ?? 0) > 0) gruende.push(`${p.ueberfuellt!.length} überfüllte Gebinde`)

  return { ampel: gruende.length ? 'gelb' : 'gruen', letzterReset, faelligAb: faellig.toISOString(), kennzahlen, kellerbuch, gruende }
}

// ── Laden (nur lesend, Service-Role) ─────────────────────────────────────────────────────────────────────────

/** Lesende Abfragen; jede gescheiterte Abfrage landet in `fehler`, ihr Wert bleibt null */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeMusterhofPruefung(admin: any): Promise<MusterhofPruefung> {
  const fehler: string[] = []
  const [infoRes, journalRes, behaelterRes] = await Promise.all([
    admin.rpc('demo_musterhof_info'),
    admin.rpc('journal_konsistenz', { p_tenant_id: MUSTERHOF_TENANT_ID }),
    admin.rpc('lade_behaelter', { p_tenant_id: MUSTERHOF_TENANT_ID }),
  ])

  let info: R | null = null
  if (infoRes.error) fehler.push(dbFehlerText(infoRes.error, 'demo_musterhof_info'))
  else {
    const d = Array.isArray(infoRes.data) ? infoRes.data[0] : infoRes.data
    if (d && typeof d === 'object') info = d as R
    else fehler.push('demo_musterhof_info lieferte keine Daten')
  }

  let journalAbweichungen: number | null = null
  if (journalRes.error) fehler.push(dbFehlerText(journalRes.error, 'journal_konsistenz'))
  else journalAbweichungen = Array.isArray(journalRes.data) ? journalRes.data.length : 0

  // Überfüllt: Inhalt aller aktiven Chargen (eigen + fremd, lade_behaelter) über Fassungsvermögen + Toleranz (KAN-381)
  let ueberfuellt: UeberfuelltesGebinde[] | null = null
  if (behaelterRes.error) fehler.push(dbFehlerText(behaelterRes.error, 'lade_behaelter'))
  else {
    ueberfuellt = []
    for (const b of (behaelterRes.data ?? []) as R[]) {
      const vol = zahl(b.volumen_liter) ?? 0
      const inhalt = (zahl(b.eigen_liter) ?? 0) + (zahl(b.fremd_liter) ?? 0)
      if (vol > 0 && inhalt > vol + FASSUNG_TOLERANZ_LITER) ueberfuellt.push({ name: String(b.name ?? '?'), volumen_liter: vol, inhalt })
    }
  }

  return { info, journalAbweichungen, ueberfuellt, fehler }
}

// ── Mail ────────────────────────────────────────────────────────────────────────────────────────────────────

const ZEICHEN: Record<Ampel, string> = { gruen: '🟢', gelb: '🟡', rot: '🔴' }
const ZUSTAND: Record<Ampel, string> = { gruen: 'ok', gelb: 'mit Abweichungen', rot: 'gescheitert' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const datumWien = (d: Date) => d.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })
const zeitWien = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? `${d.toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Uhr (Wien)`
    : iso
}
const zahlText = (n: number | null) => n === null ? '–' : zahlLokal(n, { maximumFractionDigits: 2 })
const tagText = (t: string | null) => t ? `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}` : '–'

export function mailInhalt(b: Bewertung, p: MusterhofPruefung, jetzt: Date = new Date()): { betreff: string; text: string; html: string } {
  const betreff = `${ZEICHEN[b.ampel]} Musterhof-Reset ${datumWien(jetzt)} ${ZUSTAND[b.ampel]}`
  const zeilen: string[] = []
  const html: string[] = [`<p><strong>${esc(betreff)}</strong></p>`]

  const reset = b.letzterReset ? zeitWien(b.letzterReset) : '–'
  zeilen.push(`Letzter Reset: ${reset}`)
  html.push(`<p>Letzter Reset: ${esc(reset)}</p>`)

  if (b.gruende.length) {
    zeilen.push('', 'Befunde:', ...b.gruende.map(g => `- ${g}`))
    html.push('<p>Befunde:</p><ul>', ...b.gruende.map(g => `<li>${esc(g)}</li>`), '</ul>')
  }
  if (b.ampel === 'rot') {
    zeilen.push('', ROT_HINWEIS)
    html.push(`<p><strong>${esc(ROT_HINWEIS)}</strong></p>`)
  }

  zeilen.push('', 'Kennzahlen (Ist/Soll):')
  html.push('<table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">Kennzahl</th><th align="right">Ist</th><th align="right">Soll</th></tr>')
  for (const k of b.kennzahlen) {
    zeilen.push(`- ${k.bezeichnung}: ${zahlText(k.ist)}${k.ok ? '' : ` / ${zahlText(k.soll)}`}${k.ok ? '' : ' (Abweichung)'}`)
    html.push(`<tr${k.ok ? '' : ' style="color:#b45309"'}><td>${esc(k.bezeichnung)}</td><td align="right">${esc(zahlText(k.ist))}</td><td align="right">${esc(zahlText(k.soll))}</td></tr>`)
  }
  const kb = b.kellerbuch
  zeilen.push(`- Kellerbuch abgeschlossen bis: ${tagText(kb.ist)}${kb.ok ? '' : ` / ${tagText(kb.soll)} (Abweichung)`}`)
  html.push(`<tr${kb.ok ? '' : ' style="color:#b45309"'}><td>Kellerbuch abgeschlossen bis</td><td align="right">${esc(tagText(kb.ist))}</td><td align="right">${esc(tagText(kb.soll))}</td></tr>`)
  const ja = p.journalAbweichungen
  zeilen.push(`- Journal-Abweichungen: ${ja === null ? '–' : ja} (Soll 0)`)
  html.push(`<tr${ja ? ' style="color:#b45309"' : ''}><td>Journal-Abweichungen</td><td align="right">${ja === null ? '–' : ja}</td><td align="right">0</td></tr>`)
  const ue = p.ueberfuellt
  zeilen.push(`- Überfüllte Gebinde: ${ue === null ? '–' : ue.length} (Soll 0)`)
  html.push(`<tr${ue?.length ? ' style="color:#b45309"' : ''}><td>Überfüllte Gebinde</td><td align="right">${ue === null ? '–' : ue.length}</td><td align="right">0</td></tr></table>`)
  if (ue?.length) {
    const liste = ue.map(g => `${g.name}: ${zahlText(g.inhalt)} l bei ${zahlText(g.volumen_liter)} l Fassungsvermögen`)
    zeilen.push(...liste.map(l => `  · ${l}`))
    html.push('<ul>', ...liste.map(l => `<li>${esc(l)}</li>`), '</ul>')
  }

  zeilen.push('', 'Automatische Prüfung von software:112 (/api/cron/musterhof-reset).')
  html.push('<p style="color:#6b7280;font-size:12px">Automatische Prüfung von software:112 (/api/cron/musterhof-reset).</p>')
  return { betreff, text: zeilen.join('\n'), html: html.join('\n') }
}
