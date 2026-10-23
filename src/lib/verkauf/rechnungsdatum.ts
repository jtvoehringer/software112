// KAN-355 (23.10.2026): Rechnungsdatum vorab gegen den offenen Zeitraum prüfen – dieselbe Regel wie die Datenbank
// (Trigger a_ea_periodensperre an rechnungen → s112_ea_zeitraum_sperrgrund; App über pruefe_ea_zeitraum_offen wie E&A und
// Zahlungen). Aufrufer: Verkauf mit „Rechnung sofort“ (createVerkauf), Rechnung zum Lieferschein bzw. Sammelrechnung
// (rechnungErstellen), Traubenverkauf mit Rechnung. Liefert die Meldung (string) oder null; ein Fehler der Prüfung zählt
// als „nicht möglich“ (KAN-253: nie still „offen“).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler, dbFehlerText } from '../fehler.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { ersterOffenerTag, gesperrteMonate, rechnungsdatumMeldung, stornoSperreMeldung, type Monatsabschluss, type UvaZeitraum } from './rechnungsdatumSperre.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const TAG_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Erster offener Tag vor „heute“ (Erster des Monats nach dem letzten gesperrten Monat) – für Hinweis und min-Wert des
 * Datumsfelds. null: nichts gesperrt bzw. nicht ermittelbar. Wirft bei einem Lesefehler (KAN-254).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ersterOffenerRechnungstag(supabase: any, tenantId: string, heute: string): Promise<string | null> {
  const abJahr = Number(heute.slice(0, 4)) - 3
  // alle-ausnahme: höchstens 12 Abschlüsse bzw. 16 UVA-Zeiträume je Jahr, auf die letzten vier Jahre begrenzt
  const [abschl, uva] = await Promise.all([
    supabase.from('ea_monatsabschluss').select('jahr, monat').eq('tenant_id', tenantId).gte('jahr', abJahr).limit(100),
    supabase.from('ea_uva').select('jahr, zeitraum, gesperrt').eq('tenant_id', tenantId).eq('gesperrt', true).gte('jahr', abJahr).limit(100),
  ])
  if (abschl.error) throw new AktionsFehler(dbFehlerText(abschl.error, 'Monatsabschlüsse konnten nicht geladen werden'))
  if (uva.error) throw new AktionsFehler(dbFehlerText(uva.error, 'UVA-Zeiträume konnten nicht geladen werden'))
  return ersterOffenerTag(heute, gesperrteMonate((abschl.data ?? []) as Monatsabschluss[], (uva.data ?? []) as UvaZeitraum[]))
}

/**
 * Meldung, wenn eine Rechnung mit diesem Datum nicht möglich ist (abgeschlossener Monat bzw. per UVA übermittelt),
 * sonst null. `mitRechnungSpaeter`: Hinweis auf „Rechnung später“ (Verkauf mit sofortiger Rechnung).
 */
export async function rechnungsdatumFehler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, datum: string, heute: string, mitRechnungSpaeter = false,
): Promise<string | null> {
  if (!TAG_RE.test(datum)) return 'Bitte ein gültiges Rechnungsdatum angeben.'
  const { data, error } = await supabase.rpc('pruefe_ea_zeitraum_offen', { p_tenant_id: tenantId, p_datum: datum })
  if (error) return dbFehlerText(error, 'Buchungszeitraum konnte nicht geprüft werden')
  const pruef = (Array.isArray(data) ? data[0] : data) as R | null
  if (!pruef || pruef.offen !== false) return null
  let offenAb: string | null = null
  try { offenAb = await ersterOffenerRechnungstag(supabase, tenantId, heute) } catch { offenAb = null }   // nur Hinweis
  return rechnungsdatumMeldung(datum, String(pruef.grund ?? 'Zeitraum ist geschlossen.'), offenAb, mitRechnungSpaeter)
}

/**
 * KAN-355 (Entscheidung Jörgen 23.10.2026, vorläufig bis KAN-379): Storno einer Rechnung im gesperrten Zeitraum ist nicht
 * möglich – Rechnungsstorno wie Verkaufsstorno (Spiegel). Meldung oder null (keine Rechnung, schon storniert, inaktiv,
 * Zeitraum offen). Lese- und Prüffehler zählen als „nicht möglich“ (KAN-253).
 */
export async function rechnungStornoFehler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, rechnungId: string | null | undefined,
): Promise<string | null> {
  if (!rechnungId) return null
  // storno-sichtbar: Einzelzeile per ID – storniert wird unten ausgewertet (stornierte Rechnung = keine Sperre)
  const { data: r, error } = await supabase.from('rechnungen')
    .select('rechnungsnummer, datum, storniert, aktiv').eq('id', rechnungId).eq('tenant_id', tenantId).maybeSingle()
  if (error) return dbFehlerText(error, 'Rechnung konnte nicht geladen werden')
  const re = r as R | null
  if (!re || re.storniert || re.aktiv === false) return null
  const datum = String(re.datum ?? '').slice(0, 10)
  if (!TAG_RE.test(datum)) return null
  const { data, error: pErr } = await supabase.rpc('pruefe_ea_zeitraum_offen', { p_tenant_id: tenantId, p_datum: datum })
  if (pErr) return dbFehlerText(pErr, 'Buchungszeitraum konnte nicht geprüft werden')
  const pruef = (Array.isArray(data) ? data[0] : data) as R | null
  return pruef && pruef.offen === false ? stornoSperreMeldung(re.rechnungsnummer ?? null, datum) : null
}
