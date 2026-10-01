// ── Behördenmeldung „ea-journal“: Einnahmen-Ausgaben-Journal (24.09.2026) ─────────
//
// Aufzeichnungen der E&A-Rechnung (§ 4 Abs. 3 EStG, §§ 126, 131 BAO) für Finanzamt bzw.
// Betriebsprüfung und Steuerberatung. Eine Ladefunktion für die Buchungsliste
// /buchhaltung UND die CSV (/meldungen/ea-journal/csv) – Zeitraum und Filter wie die
// Seite (?jahr=&typ=&q=). Ersetzt den früheren Browser-Export (CsvExportButton): Datum
// mit führenden Nullen, feste 2 Nachkommastellen, fehlender USt-Satz bleibt leer,
// Formelschutz – und neu die Spalten Zahlungskonto (Bank/Kassa) und Belegverweis.
// Chronologisch aufsteigend (Datum, Erfassung); die Seite zeigt die Liste umgekehrt.
// KAN-149 D2c (01.10.2026): Stornierte Buchungen und ihre Gegenbuchungen (negativer Betrag) bleiben im Journal –
// gekennzeichnet (Spalten Storno, Storno-Grund, Storniert am/von); Summen über alle Zeilen stimmen damit.

import { momentaufnahmeAnwenden } from '../stammdaten/momentaufnahme'
import { STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { betrag, KONTOART_LABEL, sachkonto, text, zahl } from './buchhaltung-gemeinsam'
import { parameterFehler, type ParameterFehler } from './typen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type EaJournalParameter = { jahr: number; typ: 'einnahme' | 'ausgabe' | null; q: string | null }

export type EaJournalZeile = {
  id: string
  datum: string
  typ: 'einnahme' | 'ausgabe'
  bezeichnung: string
  kategorie: string | null
  /** Konto der Kategorie (Sachkonto), vierstellig */
  sachkonto: string | null
  ustSatz: number | null
  netto: number | null
  ust: number | null
  brutto: number | null
  abzugsfaehigPct: number | null
  /** nicht abzugsfähiger Nettoanteil (nur Ausgaben, sonst 0) */
  nichtAbzugsfaehig: number
  zahlungskonto: string | null
  kontoart: string | null
  rechnungsnummer: string | null
  bankRef: string | null
  geschaeftspartner: string | null
  debitorNr: string | null
  belegdatei: string | null
  /** ea_belege.hochgeladen_am (timestamptz) des ersten Belegs */
  belegErfasstAm: string | null
  quelle: string
  gesperrt: boolean
  notizen: string | null
  /** KAN-149 D2c: 'storniert' (Original), 'gegenbuchung' (negative Kopie) oder null */
  stornoStatus: 'storniert' | 'gegenbuchung' | null
  stornoGrund: string | null
  /** timestamptz des Stornos (nur am Original) */
  storniertAm: string | null
  storniertVon: string | null
  // nur für die Buchungsliste
  /** Gegenbuchung: id des stornierten Originals */
  stornoVonId: string | null
  verkaufspostenId: string | null
  /** KAN-167: Ausgabe aus einem Betriebsmittel-Einkauf – Storno über den Einkauf (Betriebsmittel) */
  ausBetriebsmittel: boolean
  anlageId: string | null
  /** ea_kategorien.konto_nr als Zahl (Kontenklasse 0 → Anlagenkauf) */
  kategorieKontoNr: number | null
}

const QUELLE_LABEL: Record<string, string> = {
  manuell: 'manuell', verkauf: 'Automatisch (Verkauf)', camt053: 'Bankimport (camt.053)', csv: 'CSV-Import',
  betriebsmittel: 'Automatisch (Betriebsmittel-Einkauf)',
}

export function eaQuelle(r: R): string {
  if (r.anlage_id) return 'AfA (Anlagenverzeichnis)'
  if (r.dauerauftrag_id) return 'Dauerauftrag'
  const q = text(r.import_quelle) ?? 'manuell'
  return QUELLE_LABEL[q] ?? q
}

function name(k: R | null | undefined): string | null {
  if (!k) return null
  return text([k.vorname, k.nachname].filter(Boolean).join(' '))
}

/** Rohzeile (ea_transaktionen mit Einbettungen) → Journalzeile, Beträge kaufmännisch auf 2 Stellen */
export function eaJournalZeile(r: R): EaJournalZeile {
  const vp = (r.verkaufsposten ?? null) as R | null
  const belege = ((r.ea_belege ?? []) as R[]).slice().sort((a, b) => String(a.hochgeladen_am ?? '').localeCompare(String(b.hochgeladen_am ?? '')))
  const typ = r.typ === 'einnahme' ? 'einnahme' : 'ausgabe'
  const netto = betrag(r.betrag_netto)
  const abzugsfaehig = betrag(r.betrag_abzugsfaehig)
  const konto = (r.konto ?? null) as R | null
  const gegen = !!r.storno_von_id
  return {
    id: String(r.id),
    datum: String(r.datum).slice(0, 10),
    typ,
    bezeichnung: text(r.beschreibung) ?? '',
    kategorie: text(r.kategorie?.name),
    sachkonto: sachkonto(r.kategorie?.konto_nr),
    ustSatz: zahl(r.ust_satz),
    netto,
    ust: betrag(r.ust_betrag),
    brutto: betrag(r.betrag_brutto),
    abzugsfaehigPct: zahl(r.abzugsfaehig_pct),
    // mit Vorzeichen: Gegenbuchungen (negativ) heben den Anteil des Originals auf
    nichtAbzugsfaehig: typ === 'ausgabe' && netto !== null ? (betrag(netto - (abzugsfaehig ?? netto)) ?? 0) : 0,
    zahlungskonto: text(konto?.name),
    kontoart: konto?.typ ? (KONTOART_LABEL[konto.typ] ?? String(konto.typ)) : null,
    rechnungsnummer: text(vp?.rechnungsnummer),
    bankRef: text(r.bank_ref),
    geschaeftspartner: text(r.firma?.name) ?? text(vp?.firma?.name) ?? name(vp?.kontakt),
    // DebitorNr. (BMD-Konto) der Firma, ersatzweise die interne Accountnummer (wie bisher)
    debitorNr: text(vp?.firma?.debitor_nr) ?? text(vp?.firma?.accountnummer) ?? text(vp?.kontakt?.accountnummer),
    belegdatei: text(belege.map(b => b.dateiname).filter(Boolean).join(', ')),
    belegErfasstAm: text(belege[0]?.hochgeladen_am),
    quelle: eaQuelle(r),
    gesperrt: !!r.is_locked,
    notizen: text(r.notizen),
    stornoStatus: gegen ? 'gegenbuchung' : r.storniert_am ? 'storniert' : null,
    // Gegenbuchung: der Grund steht dort in den Notizen (s112_ea_gegenbuchung)
    stornoGrund: text(r.storno_grund) ?? (gegen ? text(r.notizen) : null),
    storniertAm: text(r.storniert_am),
    storniertVon: text(r.storniert_von_name),
    stornoVonId: text(r.storno_von_id),
    verkaufspostenId: text(r.verkaufsposten_id),
    ausBetriebsmittel: r.import_quelle === 'betriebsmittel',
    anlageId: text(r.anlage_id),
    kategorieKontoNr: zahl(r.kategorie?.konto_nr),
  }
}

export const SPALTEN_EA_JOURNAL: CsvSpalte<EaJournalZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Typ', typ: 'text', wert: z => (z.typ === 'einnahme' ? 'Einnahme' : 'Ausgabe') },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Kategorie', typ: 'text', wert: z => z.kategorie },
  { kopf: 'Sachkonto', typ: 'code', wert: z => z.sachkonto },
  { kopf: 'USt-Satz (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.ustSatz },
  { kopf: 'Netto (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.netto },
  { kopf: 'USt (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.ust },
  { kopf: 'Brutto (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.brutto },
  { kopf: 'Abzugsfähig (%)', typ: 'prozent', stellen: STELLEN.prozent, wert: z => z.abzugsfaehigPct },
  { kopf: 'Zahlungskonto', typ: 'text', wert: z => z.zahlungskonto },
  { kopf: 'Kontoart', typ: 'text', wert: z => z.kontoart },
  { kopf: 'Rechnungsnr. (Verkauf)', typ: 'code', wert: z => z.rechnungsnummer },
  { kopf: 'Bankreferenz', typ: 'code', wert: z => z.bankRef },
  { kopf: 'Geschäftspartner', typ: 'text', wert: z => z.geschaeftspartner },
  { kopf: 'DebitorNr.', typ: 'code', wert: z => z.debitorNr },
  { kopf: 'Belegdatei', typ: 'text', wert: z => z.belegdatei },
  { kopf: 'Beleg erfasst am', typ: 'datum', wert: z => z.belegErfasstAm },
  { kopf: 'Quelle', typ: 'text', wert: z => z.quelle },
  { kopf: 'Gesperrt', typ: 'janein', wert: z => z.gesperrt },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
  { kopf: 'Storno', typ: 'text', wert: z => (z.stornoStatus === 'storniert' ? 'storniert' : z.stornoStatus === 'gegenbuchung' ? 'Gegenbuchung' : null) },
  { kopf: 'Storno-Grund', typ: 'text', wert: z => z.stornoGrund },
  { kopf: 'Storniert am', typ: 'datum', wert: z => z.storniertAm },
  { kopf: 'Storniert von', typ: 'text', wert: z => z.storniertVon },
]

/** ?typ= (optional: einnahme | ausgabe) und ?q= (Suche in der Bezeichnung) */
export function eaFilterAus(sp: URLSearchParams): { typ: 'einnahme' | 'ausgabe' | null; q: string | null } | ParameterFehler {
  const typ = (sp.get('typ') ?? '').trim()
  if (typ && typ !== 'einnahme' && typ !== 'ausgabe') return parameterFehler('Ungültiger Buchungstyp – erwartet „einnahme“ oder „ausgabe“.')
  const q = (sp.get('q') ?? '').trim()
  if (q.length > 200) return parameterFehler('Der Suchbegriff ist zu lang (höchstens 200 Zeichen).')
  return { typ: typ === 'einnahme' || typ === 'ausgabe' ? typ : null, q: q || null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeEaJournal(supabase: any, tenantId: string, p: EaJournalParameter): Promise<{ zeilen: EaJournalZeile[]; warnungen: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('ea_transaktionen') as any)
    .select(`id, typ, datum, beschreibung, betrag_netto, ust_satz, ust_betrag, betrag_brutto, abzugsfaehig_pct, betrag_abzugsfaehig,
      is_locked, import_quelle, bank_ref, notizen, verkaufsposten_id, anlage_id, dauerauftrag_id, erstellt_am,
      storniert_am, storniert_von_name, storno_grund, storno_von_id, stamm_daten,
      kategorie:ea_kategorien!kategorie_id(name, konto_nr),
      konto:konten!konto_id(name, typ),
      firma:firmen!firma_id(name),
      verkaufsposten(rechnungsnummer, partner_daten, kontakt:kontakte!kontakt_id(vorname, nachname, accountnummer), firma:firmen!firma_id(name, debitor_nr, accountnummer)),
      ea_belege(dateiname, hochgeladen_am)`)
    .eq('tenant_id', tenantId)
    .gte('datum', `${p.jahr}-01-01`)
    .lte('datum', `${p.jahr}-12-31`)
  if (p.typ) q = q.eq('typ', p.typ)
  if (p.q) q = q.ilike('beschreibung', `%${p.q}%`)
  const { data, error } = await alle<R>(q.order('datum').order('erstellt_am').order('id'))
  if (error) throw new Error(`Laden fehlgeschlagen (ea_transaktionen): ${error.message}`)

  // KAN-150 F1c: Kategorie, Firma und Käufer wie beim Buchen
  for (const r of data) {
    momentaufnahmeAnwenden(r, ['kategorie', 'firma'], 'stamm_daten')
    momentaufnahmeAnwenden(r.verkaufsposten, ['kontakt', 'firma'])
  }
  const zeilen = data.map(eaJournalZeile)
  const warnungen: string[] = []
  if (p.typ || p.q) {
    warnungen.push(`Gefilterter Auszug (${[p.typ ? (p.typ === 'einnahme' ? 'nur Einnahmen' : 'nur Ausgaben') : null, p.q ? `Suche „${p.q}“` : null].filter(Boolean).join(', ')}) – für die vollständigen Aufzeichnungen ohne Filter exportieren.`)
  }
  // Nur melden, wenn der Betrieb Zahlungskonten überhaupt nutzt (sonst wäre jede Zeile betroffen)
  const ohneKonto = zeilen.filter(z => !z.zahlungskonto && !z.anlageId).length
  if (ohneKonto > 0 && zeilen.some(z => z.zahlungskonto)) {
    warnungen.push(`${ohneKonto} ${ohneKonto === 1 ? 'Buchung ist' : 'Buchungen sind'} keinem Zahlungskonto (Bank/Kassa) zugeordnet.`)
  }
  return { zeilen, warnungen }
}
