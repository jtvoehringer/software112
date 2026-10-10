// ── BKI-Schnittstelle laden (KAN-50) – Server: alle Blätter über die Register-Meldungen ──────────────────────────
//
// Je Blatt dieselbe Zugriffsprüfung, Parameterprüfung und Ladefunktion wie /meldungen/<id>/csv. Ein Blatt ohne Zugriff,
// mit Parameterfehler oder Ladefehler bricht die Mappe nicht ab, sondern steht als Fehler im Prüfbericht.

import type { Membership } from '@/lib/auth/roles'
import { meldungFinden } from './register'
import { zugriffsFehler, type ModulSchalter } from './zugriff'
import { istParameterFehler, MeldungsFehler, parameterFehler, type Betriebsdaten, type ParameterFehler } from './typen'
import { BKI_BLAETTER, blattPruefen, parameterFuer, weinwirtschaftsjahr, type BkiZeitraum, type BlattErgebnis } from './bki-schnittstelle'
import { wienHeute, type CsvSpalte } from '@/lib/csv'

const TAG = /^\d{4}-\d{2}-\d{2}$/
const gueltig = (t: string) => TAG.test(t) && !Number.isNaN(Date.parse(t))

/** Zeitraum aus der URL: bis = heute, von = Beginn des Weinwirtschaftsjahrs von „bis“, Stichtag = bis */
export function bkiZeitraumAus(sp: URLSearchParams, heute: string = wienHeute()): BkiZeitraum | ParameterFehler {
  const bis = sp.get('bis')?.trim() || heute
  const von = sp.get('von')?.trim() || `${weinwirtschaftsjahr(bis)}-08-01`
  const stichtag = sp.get('stichtag')?.trim() || bis
  for (const [n, t] of [['von', von], ['bis', bis], ['stichtag', stichtag]] as const) {
    if (!gueltig(t)) return parameterFehler(`Ungültiges Datum für „${n}“ – bitte als JJJJ-MM-TT angeben.`)
  }
  if (von > bis) return parameterFehler('Der Beginn liegt nach dem Ende des Zeitraums.')
  if (bis > heute || stichtag > heute) return parameterFehler('Der Zeitraum bzw. Stichtag liegt in der Zukunft.')
  return { von, bis, stichtag }
}

export async function ladeBkiSchnittstelle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Projektkonvention, siehe CLAUDE.md
  ctx: { supabase: any; tenantId: string; membership: Membership; betrieb: Betriebsdaten; module: ModulSchalter },
  zeitraum: BkiZeitraum,
): Promise<BlattErgebnis[]> {
  const ergebnisse: BlattErgebnis[] = []
  for (const blatt of BKI_BLAETTER) {
    if (!blatt.meldung) { ergebnisse.push({ blatt, daten: null, hinweise: [] }); continue }
    const fehler = (text: string): BlattErgebnis => ({ blatt, daten: null, hinweise: [{ blatt: blatt.blatt, art: 'fehler', text }] })
    const m = meldungFinden(blatt.meldung)
    if (!m) { ergebnisse.push(fehler(`Meldung „${blatt.meldung}“ fehlt im Register`)); continue }
    const verboten = zugriffsFehler(m, ctx.membership, ctx.module)
    if (verboten) { ergebnisse.push(fehler(`kein Zugriff: ${verboten}`)); continue }
    const p = m.parameter(parameterFuer(blatt.meldung, zeitraum))
    if (istParameterFehler(p)) { ergebnisse.push(fehler(p.fehler)); continue }
    try {
      const r = await m.laden({ supabase: ctx.supabase, tenantId: ctx.tenantId, membership: ctx.membership, betrieb: ctx.betrieb }, p)
      const spalten = m.spalten as readonly CsvSpalte<unknown>[]
      const { hinweise } = blattPruefen(blatt.meldung, blatt.blatt, spalten, r.zeilen)
      ergebnisse.push({ blatt, daten: { spalten, zeilen: r.zeilen, warnungen: r.warnungen ?? [] }, hinweise })
    } catch (e) {
      if (e instanceof MeldungsFehler) { ergebnisse.push(fehler(e.message)); continue }
      throw e
    }
  }
  return ergebnisse
}
