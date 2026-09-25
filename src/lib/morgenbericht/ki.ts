// ── Morgenbericht: KI-Zusammenfassung (optional) ─────────────────────────────
// Die Befunde sind deterministisch; die KI formuliert daraus drei bis fünf
// Sätze in Priorität und nennt, was heute als Erstes zu tun ist. Zählt als
// eine Abfrage gegen das KI-Kontingent des Pakets (check_und_increment_
// ki_abfrage, Migration 194) - ist das Limit erreicht oder kein Schlüssel
// gesetzt, bleibt der Bericht ohne Zusammenfassung (Fallback-Text).
// KAN-123 (25.09.2026): Aufruf mit Zeitlimit 20 s und ohne Wiederholungen (SDK-Standard
// 10 min + 2 Wiederholungen hätte den Cron blockiert); reicht die Restzeit des Betriebs
// nicht (zeitplan.ts: KI_MINDESTZEIT_MS), startet die KI gar nicht und wird nicht gezählt.

import Anthropic from '@anthropic-ai/sdk'
import type { Befund } from '@/lib/wetter/regeln'
import type { WetterAuswertung } from '@/lib/wetter/regeln'
import { kiStartErlaubt } from './zeitplan'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type KiErgebnis = { text: string | null; modell: string | null; grund: 'ok' | 'kein-schluessel' | 'limit' | 'inaktiv' | 'gesperrt' | 'fehler' | 'nichts' | 'zeit' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fasseZusammen(client: any, tenantId: string, tenantName: string, befunde: Befund[], wetter: WetterAuswertung | null, heute: Date, opts: { deadline?: number } = {}): Promise<KiErgebnis> {
  if (befunde.length === 0 && !wetter) return { text: null, modell: null, grund: 'nichts' }
  if (!process.env.ANTHROPIC_API_KEY) return { text: null, modell: null, grund: 'kein-schluessel' }

  const { data: einst } = await (client.from('tenant_einstellungen') as any).select('ki_abfragen_aktiv').eq('tenant_id', tenantId).maybeSingle()
  if (!(einst as R | null)?.ki_abfragen_aktiv) return { text: null, modell: null, grund: 'inaktiv' }

  // KAN-123: vor der Zählung – ohne genug Restzeit weder Aufruf noch Abfrage im Kontingent
  if (!kiStartErlaubt(opts.deadline)) return { text: null, modell: null, grund: 'zeit' }

  const { data: limitCheck, error: limitFehler } = await (client.rpc as any)('check_und_increment_ki_abfrage', { p_tenant_id: tenantId })
  // KAN-5: Fehler der Zählung nicht überspringen (fail-closed) – sperrt die Datenbank das Abo
  // (HINT 'abo_gesperrt', auch im Service-Kontext), bleibt der Bericht ohne KI-Zusammenfassung
  if (limitFehler) return { text: null, modell: null, grund: (limitFehler as R).hint === 'abo_gesperrt' ? 'gesperrt' : 'fehler' }
  const check = limitCheck as R | null
  if (check && check.erlaubt === false) return { text: null, modell: null, grund: 'limit' }

  const modell = process.env.MORGENBERICHT_MODEL || process.env.KI_ABFRAGE_MODEL || 'claude-sonnet-4-5-20250929'
  const datum = heute.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Vienna' })
  const wetterText = wetter ? [
    wetter.jetzt ? `Aktuell ${wetter.jetzt.t2m ?? '?'} °C, ${wetter.jetzt.rh2m ?? '?'} % rF, Wind ${wetter.jetzt.windKmh ?? '?'} km/h.` : '',
    `Regen: ${wetter.regen24h} mm in 24 h, ${wetter.regen72h} mm in 72 h, ${wetter.regen7d} mm in 7 Tagen.`,
    wetter.prognose ? `Prognose 48 h: ${wetter.prognose.regen48h} mm, ${wetter.prognose.tmin}–${wetter.prognose.tmax} °C, Wind bis ${wetter.prognose.windMaxKmh} km/h (Böen ${wetter.prognose.boeMaxKmh}).` : '',
    wetter.spritzfenster.length ? `Spritzfenster: ${wetter.spritzfenster.map(f => f.label).join(', ')}.` : 'Kein Spritzfenster in den nächsten 48 h.',
    wetter.rieden.filter(r => r.schutz !== 'keine' && r.schutz !== 'unbekannt').slice(0, 12).map(r => `- ${r.ried || r.name}: ${r.hinweis}`).join('\n'),
  ].filter(Boolean).join('\n') : 'Keine Wetterdaten (Standard/Premium mit Rieden-Koordinaten).'

  const befundText = befunde.map(b => `[${b.stufe}] ${b.bereich}: ${b.titel} – ${b.detail}`).join('\n') || '(keine Befunde)'
  const system = `Du bist der Morgenbericht von software:112 für den Weinbaubetrieb „${tenantName}“ (Österreich). Du bekommst geprüfte Befunde (Stufe hoch/mittel/info) und eine Wetterauswertung.
Schreibe auf Deutsch (österreichische Schreibweise, Du-Form), 3 bis 5 kurze Sätze als Fließtext, keine Aufzählung, keine Überschrift, keine Begrüßung.
Regeln: Nenne zuerst, was heute als Erstes zu tun ist (Stufe hoch), dann das Wichtigste aus mittel, dann in einem Halbsatz das Wetter für die Weingartenarbeit. Erfinde nichts, nenne keine Zahlen, die nicht in den Daten stehen, keine Rechts- oder Pflanzenschutzberatung über die Daten hinaus. Gibt es keine Befunde, sage das in einem Satz und beschreibe kurz das Wetter.`
  const user = `Datum: ${datum}\n\nBefunde:\n${befundText}\n\nWetter:\n${wetterText}`

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 0 })
    const msg = await anthropic.messages.create({ model: modell, max_tokens: 400, system, messages: [{ role: 'user', content: user }] })
    const text = (msg.content[0] as R)?.text?.trim() as string | undefined
    await (client.rpc as any)('increment_ki_tokens', { p_tenant_id: tenantId, p_input_tokens: msg.usage.input_tokens, p_output_tokens: msg.usage.output_tokens })
    return text ? { text, modell, grund: 'ok' } : { text: null, modell, grund: 'fehler' }
  } catch {
    return { text: null, modell, grund: 'fehler' }
  }
}

/** Fallback ohne KI: ein Satz aus den Zählern */
export function fallbackText(befunde: Befund[], wetter: WetterAuswertung | null): string {
  const hoch = befunde.filter(b => b.stufe === 'hoch').length, mittel = befunde.filter(b => b.stufe === 'mittel').length
  const teile: string[] = []
  if (hoch === 0 && mittel === 0) teile.push(befunde.length ? 'Nichts Dringendes – nur Hinweise.' : 'Nichts Dringendes – alle Prüfungen ohne Befund.')
  else teile.push(`${hoch} ${hoch === 1 ? 'dringender Punkt' : 'dringende Punkte'}, ${mittel} zur Erledigung.`)
  if (wetter?.jetzt) teile.push(`Wetter an den Rieden: ${wetter.jetzt.t2m ?? '–'} °C, ${wetter.regen24h} mm in 24 h${wetter.prognose ? `, Prognose 48 h ${wetter.prognose.regen48h} mm` : ''}.`)
  return teile.join(' ')
}
