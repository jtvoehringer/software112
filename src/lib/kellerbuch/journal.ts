// ── Bewegungsjournal kellerbuch_buchungen (KAN-40 Etappe E1, 02.10.2026) ──
//
// Die Datenbank schreibt das Journal ausschließlich selbst (Trigger auf den Bewegungstabellen, Migration kan40a_journal):
// eine unveränderliche Zeile je Mengenwirkung – Liter offen (Charge) bzw. Stück Flaschen (Füllung) – mit den Merkmalen
// zum Buchungszeitpunkt. Storno = Gegenbuchung (gleiche Buchungsart, umgekehrtes Vorzeichen, storno_von_id); Merkmals-
// änderung = Umstufungspaar AB_ABW/ZU_ABW; direkte Mengenänderung ohne Bewegung = Korrektur INV_PLUS/INV_MIN über
// journal_abgleichen. Aktiv erst ab tenant_einstellungen.journal_ab (journal_eroeffnen).
//
// Hier nur Typen und Lesezugriffe (Seite /kellerbuch/journal); die App schreibt nie direkt ins Journal.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'
export type JournalBestand = 'offen' | 'flasche'

/** Eine Zeile aus kellerbuch_buchungen */
export type JournalBuchung = {
  id: string
  beleg_nr: number
  pos: number
  datum: string
  buchungsart_code: string
  bestand: JournalBestand
  weinausbau_id: string | null
  fuellung_id: string | null
  menge_liter: number
  menge_stk: number
  partner_name: string | null
  partner_land: string | null
  quelle_tabelle: string
  quelle_id: string | null
  storno_von_id: string | null
  rekonstruiert: boolean
  charge_name: string | null
  fuellung_name: string | null
  qualitaetsstufe: string | null
  zusatzbezeichnung: string | null
  erzeugnis: string | null
  weinart: string | null
  land_iso: string | null
  rebsorte: string | null
  jahrgang: number | null
  hinweis: string | null
  erstellt_am: string
}

/** Ergebnis von journal_konsistenz(p_tenant_id): nur Abweichungen Ist ↔ Journal-Saldo */
export type JournalAbweichung = {
  art: 'charge' | 'fuellung'
  id: string
  bezeichnung: string | null
  ist: number
  journal: number
  differenz: number
  einheit: 'l' | 'Stk'
  letzte_aenderung: string | null
}

/** Woher eine Journalzeile stammt (quelle_tabelle) – Anzeige */
export const JOURNAL_QUELLE_LABEL: Record<string, string> = {
  journal_eroeffnen:    'Eröffnung des Journals',
  keller_umzuege:       'Umzug / Filtration / Schwund',
  pressung_behaelter:   'Pressung',
  zukauf_posten:        'Zukauf',
  verschneidung_quellen: 'Verschnitt',
  fuellungen:           'Füllung',
  fuellung_bewegungen:  'Flaschenbuchung',
  verkauf_positionen:   'Verkauf',
  weinausbau:           'Eröffnungsbestand',
  weinausbau_merkmale:  'Umstufung (Charge)',
  fuellungen_merkmale:  'Umstufung (Füllung)',
  weinausbau_bestand:   'Bestandskorrektur (Charge)',
  fuellungen_bestand:   'Bestandskorrektur (Füllung)',
  keller_verarbeitungen: 'Verarbeitung',
  produktionen:         'Produktion',   // KAN-118
}

export const JOURNAL_SPALTEN = 'id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, fuellung_id, menge_liter, menge_stk, partner_name, partner_land, quelle_tabelle, quelle_id, storno_von_id, rekonstruiert, charge_name, fuellung_name, qualitaetsstufe, zusatzbezeichnung, erzeugnis, weinart, land_iso, rebsorte, jahrgang, hinweis, erstellt_am'

const zahl = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Journalbeginn des Betriebs (null = Journal aus) */
export async function ladeJournalBeginn(supabase: any, tenantId: string): Promise<string | null> {
  const { data, error } = await (supabase.from('tenant_einstellungen') as any)
    .select('journal_ab')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new AktionsFehler(`Journalbeginn konnte nicht geladen werden (${error.message})`)
  return (data?.journal_ab as string | null | undefined) ?? null
}

/** Die neuesten Journalzeilen (Beleg absteigend) */
export async function ladeJournalZeilen(supabase: any, tenantId: string, anzahl = 200): Promise<JournalBuchung[]> {
  const { data, error } = await (supabase.from('kellerbuch_buchungen') as any)
    .select(JOURNAL_SPALTEN)
    .eq('tenant_id', tenantId)
    .order('beleg_nr', { ascending: false })
    .order('pos', { ascending: true })
    .limit(Math.min(Math.max(anzahl, 1), 1000))
  if (error) throw new AktionsFehler(`Bewegungsjournal konnte nicht geladen werden (${error.message})`)
  return ((data ?? []) as any[]).map(z => ({ ...z, menge_liter: zahl(z.menge_liter), menge_stk: zahl(z.menge_stk) })) as JournalBuchung[]
}

/** Abweichungen Ist ↔ Journal (leer = konsistent bzw. Journal aus) */
export async function ladeJournalAbweichungen(supabase: any, tenantId: string): Promise<JournalAbweichung[]> {
  const { data, error } = await (supabase.rpc as any)('journal_konsistenz', { p_tenant_id: tenantId })
  if (error) throw new AktionsFehler(`Journal-Konsistenz konnte nicht geprüft werden (${error.message})`)
  return ((data ?? []) as any[]).map(z => ({
    ...z, ist: zahl(z.ist), journal: zahl(z.journal), differenz: zahl(z.differenz),
  })) as JournalAbweichung[]
}

/** KAN-51: Dashboard-Hinweis – Zahl der Abweichungen Ist ↔ Journal; null = Journal nicht aktiv bzw. Prüfung gescheitert
 *  (das Dashboard soll an einer fehlgeschlagenen Prüfung nicht scheitern – die Journalseite zeigt den Fehler). */
export async function journalAbweichungenAnzahl(supabase: any, tenantId: string): Promise<number | null> {
  try {
    if (!(await ladeJournalBeginn(supabase, tenantId))) return null
    return (await ladeJournalAbweichungen(supabase, tenantId)).length
  } catch {
    return null
  }
}

/** Menge einer Journalzeile für die Anzeige (Flaschen in Stück, sonst Liter) */
export function journalMenge(z: Pick<JournalBuchung, 'bestand' | 'menge_liter' | 'menge_stk'>): { wert: number; einheit: 'l' | 'Stk' } {
  return z.bestand === 'flasche' ? { wert: z.menge_stk, einheit: 'Stk' } : { wert: z.menge_liter, einheit: 'l' }
}

export type JournalAbgleichLauf = {
  betriebe: number
  korrekturen: number
  fehler: { tenantId: string; meldung: string }[]
}

/**
 * Täglicher Abgleich (Sammel-Cron /api/cron/taeglich, KAN-40 E1, Entscheidung Jörgen 03.10.2026): für jeden Betrieb mit
 * eröffnetem Journal journal_abgleichen aufrufen – direkte Mengenänderungen ohne Bewegung, die älter als 15 Minuten sind,
 * werden als INV_PLUS/INV_MIN gebucht. Nur mit dem Admin-Client (Service-Role: Zugriffs-, Modul- und Abo-Prüfung entfallen);
 * Betriebe ohne journal_ab bleiben unberührt (Demo-Betrieb Musterhof: Journal vorerst aus, Jörgen 03.10.2026).
 */
export async function journalAbgleichAlle(admin: any): Promise<JournalAbgleichLauf> {
  // tenant-isolation-ignore: Cron über alle Betriebe mit eröffnetem Journal
  const { data, error } = await (admin.from('tenant_einstellungen') as any)
    .select('tenant_id')
    .not('journal_ab', 'is', null)
  if (error) return { betriebe: 0, korrekturen: 0, fehler: [{ tenantId: '-', meldung: error.message }] }
  const lauf: JournalAbgleichLauf = { betriebe: 0, korrekturen: 0, fehler: [] }
  for (const { tenant_id: tenantId } of (data ?? []) as { tenant_id: string }[]) {
    const { data: n, error: e } = await (admin.rpc as any)('journal_abgleichen', { p_tenant_id: tenantId })
    if (e) { lauf.fehler.push({ tenantId, meldung: e.message }); continue }
    lauf.betriebe++
    lauf.korrekturen += zahl(n)
  }
  return lauf
}

/** KAN-192: ein Kellerbuch-Abschluss (Periodensperre) */
export type KellerbuchAbschluss = {
  id: string
  abgeschlossen_bis: string
  abgeschlossen_am: string
  bemerkung: string | null
}

/** Kellerbuch-Abschlüsse des Betriebs, neuester zuerst (der erste ist der wirksame) */
export async function ladeKellerbuchAbschluesse(supabase: any, tenantId: string): Promise<KellerbuchAbschluss[]> {
  const { data, error } = await (supabase.from('kellerbuch_abschluesse') as any)
    .select('id, abgeschlossen_bis, abgeschlossen_am, bemerkung')
    .eq('tenant_id', tenantId)
    .order('abgeschlossen_bis', { ascending: false }).order('id', { ascending: false })
  if (error) throw new AktionsFehler(`Kellerbuch-Abschlüsse konnten nicht geladen werden (${error.message})`)
  return (data ?? []) as KellerbuchAbschluss[]
}

/** Vorschlag für den nächsten Abschluss: der letzte 31. Juli vor heute (Stichtag der Bestandsmeldung), sonst gestern */
export function abschlussVorschlag(heute: string, gesperrtBis: string | null): string {
  const jahr = Number(heute.slice(0, 4))
  const juli = `${heute.slice(5) > '07-31' ? jahr : jahr - 1}-07-31`
  const gestern = new Date(Date.UTC(jahr, Number(heute.slice(5, 7)) - 1, Number(heute.slice(8, 10)) - 1)).toISOString().slice(0, 10)
  return !gesperrtBis || juli > gesperrtBis ? juli : gestern
}
