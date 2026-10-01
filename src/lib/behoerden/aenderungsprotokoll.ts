/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import 'server-only'

// ── Änderungs- und Löschprotokoll (bestandsprotokoll, KAN-35) – CSV (24.09.2026) ──
//
// Zusatzfund der Vollständigkeitsprüfung: Nachträgliche Änderungen und Löschungen im
// Kellerbuch, bei Lese und Verkauf schreibt der Trigger bestandsprotokoll_schreiben()
// lückenlos mit (Migration 20260924170709_kan35_datenintegritaet). Eine Ausgabe gab es
// nicht. Lesen dürfen laut RLS nur Betriebs-Manager und Super-Admins – andere Rollen
// bekämen eine leere Datei, deshalb hier ausdrücklich 403.
//
// Eine Zeile je Protokolleintrag: Zeitpunkt (Wien), Bereich, Aktion, geänderte Spalten,
// alt → neu (kompakt), Rollen, Benutzer. Die E-Mail-Adresse wird nur für Mitglieder des
// eigenen Betriebs ermittelt (wie in /benutzer, per Service-Role).
//
// UUIDs (Standard: „keine UUIDs“) nur mit fachlicher Begründung (Review 25.09.2026):
//   Datensatz-ID  einziger stabiler Schlüssel des geänderten bzw. gelöschten Datensatzes –
//                 bei Änderungen stehen nur die geänderten Spalten im Protokoll, eine
//                 Bezeichnung fehlt meist; mehrere Zeilen zum selben Datensatz lassen sich
//                 nur über die ID zuordnen.
//   Benutzer-ID   nur, wenn keine E-Mail-Adresse ermittelbar ist (ehemalige Mitglieder) –
//                 sonst wäre die Änderung niemandem zuzuordnen.
// Zeitpunkte in „Alt → Neu“ (timestamptz) in Wiener Zeit, Kalendertage als TT.MM.JJJJ.

import { STELLEN, wienZeitpunkt, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Membership } from '@/lib/auth/roles'
import { VERWALTUNG_ROLLEN } from '@/lib/auth/pflichtmeldung'
import { MeldungsFehler } from './typen'
import { folgetag, kuerzen, text, wienTagesbeginnUtc, type R, type Zeitraum } from './kellerbuch-hilfen'

/** Rollen, die das Protokoll lesen dürfen – Katalog-Zugriff 'verwaltung'; hier als zweite Linie geprüft */
export const PROTOKOLL_ROLLEN = VERWALTUNG_ROLLEN

export const TABELLE_LABEL: Record<string, string> = {
  weinausbau: 'Charge',
  keller_umzuege: 'Umzug / Filtration / Schwund',
  verschneidungen: 'Verschneidung',
  verschneidung_quellen: 'Verschneidung – Quelle',
  keller_behandlungen: 'Kellerbehandlung',
  fuellungen: 'Füllung',
  fuellung_chargen: 'Füllung – Chargenanteil',
  fuellung_bewegungen: 'Flaschenbewegung',
  zukauf_posten: 'Zukauf',
  pressungen: 'Pressung',
  pressung_behaelter: 'Pressung – Gebinde',
  pressung_weingaerten: 'Pressung – Weingarten',
  ernte_parzellen: 'Lese (Parzelle)',
  traubenverkauf: 'Traubenverkauf',
  verkaufsposten: 'Verkauf',
  verkauf_positionen: 'Verkaufsposition',
  ama_erntemeldungen: 'AMA-Erntemeldung',
  ama_meldepositionen: 'AMA-Meldeposition',
  weinjahrgaenge: 'Jahrgang',
  // KAN-149 D3 / KAN-150 F1a: E&A-Abschluss und Stammdaten (Löschen, Deaktivieren)
  ea_transaktionen: 'E&A-Buchung',
  zahlungen: 'Zahlung',
  konto_umbuchungen: 'Umbuchung',
  ea_uva: 'UVA',
  ea_monatsabschluss: 'Monatsabschluss',
  ea_belege: 'Beleg',
  weingarten: 'Ried',
  grundstuecke: 'Grundstück',
  pflanzenschutzmittel: 'Pflanzenschutzmittel',
  duengemittel: 'Düngemittel',
  ea_kategorien: 'E&A-Kategorie',
  ea_dauerauftraege: 'Dauerauftrag',
  keller_behandlungstypen: 'Kellerbehandlungstyp',
}

const AKTION_LABEL: Record<string, string> = { UPDATE: 'Änderung', DELETE: 'Löschung' }

const DB_ROLLE_LABEL: Record<string, string> = {
  authenticated: 'App-Benutzer',
  service_role: 'System (Service-Role)',
  postgres: 'Datenbank (SQL-Editor)',
  anon: 'nicht angemeldet',
}

const BETRIEBSROLLE_LABEL: Record<string, string> = {
  system_admin: 'Super-Admin', tenant_admin: 'Betriebs-Manager', winzer: 'Mitarbeiter', leser: 'Leser',
}

/** Felder, die bei Löschungen nichts zur Nachvollziehbarkeit beitragen */
const TECHNISCH = new Set(['tenant_id', 'created_at', 'updated_at', 'erstellt_am', 'aktualisiert_am', 'importiert_am', 'import_quelle'])

/** Höchstlänge der Spalte „Alt → Neu“ (Excel-Zellen fassen 32.767 Zeichen) */
export const MAX_AENDERUNG = 2000

const TAG_TEXT_RE = /^\d{4}-\d{2}-\d{2}$/
const ZEITPUNKT_TEXT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i

/** Datum/Zeitpunkt aus jsonb lesbar: DATE → TT.MM.JJJJ, timestamptz → TT.MM.JJJJ HH:MM (Wien) */
function zeitText(s: string): string | null {
  if (!TAG_TEXT_RE.test(s) && !ZEITPUNKT_TEXT_RE.test(s)) return null
  const w = wienZeitpunkt(s)
  if (!w) return null
  const d = `${w.datum.slice(8, 10)}.${w.datum.slice(5, 7)}.${w.datum.slice(0, 4)}`
  return w.uhrzeit ? `${d} ${w.uhrzeit}` : d
}

/** Einzelwert aus alt/neu (jsonb) lesbar machen */
export function wertText(v: unknown): string {
  if (v === null || v === undefined) return 'leer'
  if (typeof v === 'boolean') return v ? 'ja' : 'nein'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : String(v)
  if (typeof v === 'string') return v.trim() === '' ? 'leer' : (zeitText(v.trim()) ?? kuerzen(v.trim(), 200))
  return kuerzen(JSON.stringify(v), 200)
}

/** „alt → neu“ kompakt: Änderung je Spalte, Löschung mit den fachlichen Feldern des gelöschten Datensatzes */
export function aenderungText(aktion: string, alt: R | null, neu: R | null, spalten: readonly string[] | null): string {
  if (aktion === 'DELETE') {
    const teile = Object.entries(alt ?? {})
      .filter(([k, v]) => !TECHNISCH.has(k) && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${wertText(v)}`)
    return kuerzen(`gelöscht: ${teile.join(' | ')}`, MAX_AENDERUNG)
  }
  const keys = spalten && spalten.length > 0 ? spalten : [...new Set([...Object.keys(alt ?? {}), ...Object.keys(neu ?? {})])]
  return kuerzen(keys.map(k => `${k}: ${wertText(alt?.[k])} → ${wertText(neu?.[k])}`).join(' | '), MAX_AENDERUNG)
}

/** Bezeichnung des Datensatzes, soweit sie im Protokoll steht (bei Änderungen meist nur die geänderten Spalten) */
export function datensatzText(alt: R | null, neu: R | null): string | null {
  const q = { ...(alt ?? {}), ...(neu ?? {}) }
  for (const k of ['name', 'bezeichnung', 'rechnungsnummer', 'transaktions_nr', 'chargennummer', 'liefernummer', 'weinbezeichnung',
    'gst_nr', 'beschreibung', 'dateiname']) {
    const t = text(q[k])
    if (t) return t
  }
  return null
}

export type AenderungsprotokollZeile = {
  id: number | string
  zeitpunkt: string
  bereich: string
  tabelle: string
  aktion: string
  datensatzId: string | null
  datensatz: string | null
  spalten: string | null
  aenderung: string
  dbRolle: string | null
  betriebsrolle: string | null
  benutzerEmail: string | null
  benutzerId: string | null
}

/** Protokollzeilen formen (reine Umformung, testbar) */
export function protokollZeilen(roh: readonly R[], emails: ReadonlyMap<string, string>, rollen: ReadonlyMap<string, string>): AenderungsprotokollZeile[] {
  return roh.map(p => {
    const spalten = Array.isArray(p.geaenderte_spalten) ? (p.geaenderte_spalten as string[]) : null
    const alt = (p.alt ?? null) as R | null
    const neu = (p.neu ?? null) as R | null
    const benutzer = text(p.benutzer_id)
    const rolle = benutzer ? rollen.get(benutzer) ?? null : null
    return {
      id: p.id,
      zeitpunkt: p.erstellt_am,
      bereich: TABELLE_LABEL[p.tabelle] ?? p.tabelle,
      tabelle: p.tabelle,
      aktion: AKTION_LABEL[p.aktion] ?? p.aktion,
      datensatzId: text(p.datensatz_id),
      datensatz: datensatzText(alt, neu),
      spalten: spalten && spalten.length > 0 ? spalten.join(', ') : null,
      aenderung: aenderungText(p.aktion, alt, neu, spalten),
      dbRolle: p.db_rolle ? (DB_ROLLE_LABEL[p.db_rolle] ?? p.db_rolle) : null,
      betriebsrolle: rolle ? (BETRIEBSROLLE_LABEL[rolle] ?? rolle) : null,
      benutzerEmail: benutzer ? emails.get(benutzer) ?? null : null,
      // UUID nur, wenn keine E-Mail-Adresse bekannt ist (siehe Kopfkommentar)
      benutzerId: benutzer && !emails.has(benutzer) ? benutzer : null,
    }
  })
}

/** E-Mail-Adressen zu Benutzer-IDs (Service-Role, nur die übergebenen – Mitglieder des Betriebs) */
async function emailsUeberAdmin(ids: readonly string[]): Promise<Map<string, string>> {
  const admin = createSupabaseAdminClient()
  const out = new Map<string, string>()
  await Promise.all(ids.map(async id => {
    const { data, error } = await admin.auth.admin.getUserById(id)
    if (!error && data?.user?.email) out.set(id, data.user.email)
  }))
  return out
}

export async function ladeAenderungsprotokoll(
  supabase: any,
  tenantId: string,
  membership: Pick<Membership, 'role'>,
  z: Zeitraum,
  opts: { emailsLaden?: (ids: readonly string[]) => Promise<Map<string, string>> } = {},
): Promise<{ zeilen: AenderungsprotokollZeile[]; warnungen: string[] }> {
  if (!(PROTOKOLL_ROLLEN as readonly string[]).includes(membership.role ?? '')) {
    throw new MeldungsFehler(403, 'Das Änderungsprotokoll dürfen nur Betriebs-Manager und Super-Admins exportieren.')
  }

  let q = (supabase.from('bestandsprotokoll') as any)
    .select('id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, db_rolle, benutzer_id, erstellt_am')
    .eq('tenant_id', tenantId)
  if (z.von) q = q.gte('erstellt_am', wienTagesbeginnUtc(z.von))
  if (z.bis) q = q.lt('erstellt_am', wienTagesbeginnUtc(folgetag(z.bis)))
  const [prot, mitglieder] = await Promise.all([
    alle<R>(q.order('erstellt_am', { ascending: true }).order('id', { ascending: true })),
    alle<R>((supabase.from('tenant_memberships') as any)
      .select('user_id, role')
      .eq('tenant_id', tenantId)
      .order('user_id')),
  ])
  if (prot.error) throw new Error(`Änderungsprotokoll konnte nicht geladen werden: ${prot.error.message}`)
  if (mitglieder.error) throw new Error(`Mitglieder konnten nicht geladen werden: ${mitglieder.error.message}`)

  const rollen = new Map<string, string>(mitglieder.data.map(m => [m.user_id as string, m.role as string]))
  const benutzer = [...new Set(prot.data.map(p => text(p.benutzer_id)).filter((b): b is string => !!b))]
  const imBetrieb = benutzer.filter(b => rollen.has(b))

  const warnungen: string[] = []
  let emails = new Map<string, string>()
  if (imBetrieb.length > 0) {
    try {
      emails = await (opts.emailsLaden ?? emailsUeberAdmin)(imBetrieb)
    } catch {
      warnungen.push('Die E-Mail-Adressen der Benutzer konnten nicht ermittelt werden – es steht nur die Benutzer-ID in der Datei.')
    }
  }
  const fremd = benutzer.length - imBetrieb.length
  if (fremd > 0) warnungen.push(`${fremd} ${fremd === 1 ? 'Benutzer ist' : 'Benutzer sind'} nicht (mehr) Mitglied des Betriebs – nur die Benutzer-ID wird ausgegeben.`)

  return { zeilen: protokollZeilen(prot.data, emails, rollen), warnungen }
}

export const SPALTEN_AENDERUNGSPROTOKOLL: CsvSpalte<AenderungsprotokollZeile>[] = [
  { kopf: 'Nr.', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.id },
  { kopf: 'Zeitpunkt', typ: 'zeitpunkt', wert: z => z.zeitpunkt },
  { kopf: 'Bereich', typ: 'text', wert: z => z.bereich },
  { kopf: 'Tabelle', typ: 'code', wert: z => z.tabelle },
  { kopf: 'Aktion', typ: 'text', wert: z => z.aktion },
  { kopf: 'Datensatz', typ: 'text', wert: z => z.datensatz },
  { kopf: 'Datensatz-ID', typ: 'code', wert: z => z.datensatzId },
  { kopf: 'Geänderte Spalten', typ: 'text', wert: z => z.spalten },
  { kopf: 'Alt → Neu', typ: 'text', wert: z => z.aenderung },
  { kopf: 'Zugriff über', typ: 'text', wert: z => z.dbRolle },
  { kopf: 'Rolle im Betrieb (heute)', typ: 'text', wert: z => z.betriebsrolle },
  { kopf: 'Benutzer (E-Mail)', typ: 'text', wert: z => z.benutzerEmail },
  { kopf: 'Benutzer-ID (nur ohne E-Mail)', typ: 'code', wert: z => z.benutzerId },
]
