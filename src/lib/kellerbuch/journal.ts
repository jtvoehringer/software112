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
  if (error) throw new Error(`Journalbeginn konnte nicht geladen werden (${error.message})`)
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
  if (error) throw new Error(`Bewegungsjournal konnte nicht geladen werden (${error.message})`)
  return ((data ?? []) as any[]).map(z => ({ ...z, menge_liter: zahl(z.menge_liter), menge_stk: zahl(z.menge_stk) })) as JournalBuchung[]
}

/** Abweichungen Ist ↔ Journal (leer = konsistent bzw. Journal aus) */
export async function ladeJournalAbweichungen(supabase: any, tenantId: string): Promise<JournalAbweichung[]> {
  const { data, error } = await (supabase.rpc as any)('journal_konsistenz', { p_tenant_id: tenantId })
  if (error) throw new Error(`Journal-Konsistenz konnte nicht geprüft werden (${error.message})`)
  return ((data ?? []) as any[]).map(z => ({
    ...z, ist: zahl(z.ist), journal: zahl(z.journal), differenz: zahl(z.differenz),
  })) as JournalAbweichung[]
}

/** Menge einer Journalzeile für die Anzeige (Flaschen in Stück, sonst Liter) */
export function journalMenge(z: Pick<JournalBuchung, 'bestand' | 'menge_liter' | 'menge_stk'>): { wert: number; einheit: 'l' | 'Stk' } {
  return z.bestand === 'flasche' ? { wert: z.menge_stk, einheit: 'Stk' } : { wert: z.menge_liter, einheit: 'l' }
}
