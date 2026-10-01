// ── Behördenmeldung „belegverzeichnis“: Belegverzeichnis der E&A-Rechnung (24.09.2026) ──
//
// Für die Außenprüfung (§§ 131, 132 BAO): je hochgeladenem Beleg (ea_belege) eine Zeile
// mit Datei, Status, Upload- und Buchungszeitpunkt und – falls verbucht – der Buchung
// (Datum, Bezeichnung, Kategorie, Brutto). Die von der Belegerkennung vorgeschlagenen
// Werte (erkannte_daten) stehen daneben, klar als „erkannt“ gekennzeichnet.
// Jahr: bei verbuchten Belegen das Buchungsdatum, sonst der Upload-Tag in Wiener Zeit.
// Eine Ladefunktion für die Druckseite /buchhaltung/belege/verzeichnis UND die CSV
// (/meldungen/belegverzeichnis/csv?jahr=).

import { momentaufnahmeAnwenden } from '../stammdaten/momentaufnahme'
import { STELLEN, wienDatum, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { betrag, istIsoDatum, text, zahl } from './buchhaltung-gemeinsam'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type BelegParameter = { jahr: number }

export const BELEG_STATUS: Record<string, string> = {
  verbucht: 'Verbucht', erkannt: 'Zu verbuchen', fehler: 'Erkennung fehlgeschlagen',
}

export type BelegZeile = {
  lfdNr: number
  id: string
  dateiname: string
  dateityp: string | null
  status: string
  /** timestamptz */
  hochgeladenAm: string | null
  /** timestamptz */
  verbuchtAm: string | null
  buchungsdatum: string | null
  buchungstyp: string | null
  buchungstext: string | null
  kategorie: string | null
  brutto: number | null
  /** Vorschlag der Belegerkennung (nicht geprüft) */
  erkanntDatum: string | null
  erkanntBrutto: number | null
  erkanntLieferant: string | null
}

export const SPALTEN_BELEGVERZEICHNIS: CsvSpalte<BelegZeile>[] = [
  { kopf: 'Lfd. Nr.', typ: 'ganzzahl', wert: z => z.lfdNr },
  { kopf: 'Belegdatei', typ: 'text', wert: z => z.dateiname },
  { kopf: 'Dateityp', typ: 'code', wert: z => z.dateityp },
  { kopf: 'Status', typ: 'text', wert: z => z.status },
  { kopf: 'Hochgeladen am', typ: 'zeitpunkt', wert: z => z.hochgeladenAm },
  { kopf: 'Verbucht am', typ: 'zeitpunkt', wert: z => z.verbuchtAm },
  { kopf: 'Buchungsdatum', typ: 'datum', wert: z => z.buchungsdatum },
  { kopf: 'Buchungstyp', typ: 'text', wert: z => z.buchungstyp },
  { kopf: 'Buchungstext', typ: 'text', wert: z => z.buchungstext },
  { kopf: 'Kategorie', typ: 'text', wert: z => z.kategorie },
  { kopf: 'Brutto (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.brutto },
  { kopf: 'Belegdatum (erkannt)', typ: 'datum', wert: z => z.erkanntDatum },
  { kopf: 'Brutto erkannt (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.erkanntBrutto },
  { kopf: 'Lieferant (erkannt)', typ: 'text', wert: z => z.erkanntLieferant },
]

/** Jahr, dem ein Beleg zugeordnet ist: Buchungsdatum, sonst Upload-Tag in Wien */
export function belegJahr(b: R): number | null {
  const buchung = (b.buchung ?? null) as R | null
  const tag = buchung?.datum ? String(buchung.datum).slice(0, 10) : wienDatum(b.hochgeladen_am)
  return tag ? Number(tag.slice(0, 4)) : null
}

/** Rohzeile (ea_belege mit eingebetteter Buchung) → Verzeichniszeile (ohne lfdNr) */
export function belegZeile(b: R): Omit<BelegZeile, 'lfdNr'> {
  const e = (b.erkannte_daten && typeof b.erkannte_daten === 'object' ? b.erkannte_daten : {}) as R
  const buchung = (b.buchung ?? null) as R | null
  const status = String(b.status ?? '')
  return {
    id: String(b.id),
    dateiname: text(b.dateiname) ?? '',
    dateityp: text(b.dateityp),
    // KAN-149 D2c: Buchung storniert – der Beleg bleibt, die Gegenbuchung hebt die Buchung auf
    status: `${BELEG_STATUS[status] ?? status}${buchung?.storniert_am ? ' (Buchung storniert)' : ''}`,
    hochgeladenAm: text(b.hochgeladen_am),
    verbuchtAm: text(b.verbucht_am),
    buchungsdatum: buchung?.datum ? String(buchung.datum).slice(0, 10) : null,
    buchungstyp: buchung ? (buchung.typ === 'einnahme' ? 'Einnahme' : 'Ausgabe') : null,
    buchungstext: text(buchung?.beschreibung),
    kategorie: text(buchung?.kategorie?.name),
    brutto: betrag(buchung?.betrag_brutto),
    erkanntDatum: istIsoDatum(e.datum) ? e.datum : null,
    erkanntBrutto: zahl(e.betrag_brutto) === null ? null : betrag(e.betrag_brutto),
    erkanntLieferant: text(e.lieferant_name),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeBelegverzeichnis(supabase: any, tenantId: string, p: BelegParameter): Promise<{ zeilen: BelegZeile[]; warnungen: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle<R>((supabase.from('ea_belege') as any)
    .select(`id, dateiname, dateityp, status, erkannte_daten, hochgeladen_am, verbucht_am, ea_transaktion_id,
      buchung:ea_transaktionen!ea_transaktion_id(datum, typ, beschreibung, betrag_brutto, storniert_am, stamm_daten, kategorie:ea_kategorien!kategorie_id(name))`)
    .eq('tenant_id', tenantId)
    .order('hochgeladen_am').order('id'))
  if (error) throw new Error(`Laden fehlgeschlagen (ea_belege): ${error.message}`)

  for (const b of data) momentaufnahmeAnwenden(b.buchung, ['kategorie'], 'stamm_daten')   // KAN-150 F1c
  const imJahr = data.filter(b => belegJahr(b) === p.jahr)
  const basis = imJahr.map(belegZeile)
  basis.sort((a, b) =>
    (a.buchungsdatum ?? wienDatum(a.hochgeladenAm) ?? '').localeCompare(b.buchungsdatum ?? wienDatum(b.hochgeladenAm) ?? '')
    || (a.hochgeladenAm ?? '').localeCompare(b.hochgeladenAm ?? '') || a.id.localeCompare(b.id))
  const zeilen = basis.map((z, i) => ({ lfdNr: i + 1, ...z }))

  const warnungen: string[] = []
  const offen = zeilen.filter(z => z.status !== BELEG_STATUS.verbucht).length
  if (offen > 0) warnungen.push(`${offen} ${offen === 1 ? 'Beleg ist' : 'Belege sind'} noch nicht verbucht – Beträge dort nur „erkannt“ (Vorschlag der Belegerkennung, ungeprüft).`)
  const verwaist = imJahr.filter(b => b.status === 'verbucht' && !b.buchung).length
  if (verwaist > 0) warnungen.push(`${verwaist} verbuchte ${verwaist === 1 ? 'Beleg verweist' : 'Belege verweisen'} auf keine Buchung mehr (Buchung gelöscht).`)
  return { zeilen, warnungen }
}
