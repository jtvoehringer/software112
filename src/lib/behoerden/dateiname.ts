// ── Dateiname einer Behördenmeldung (KAN-95, 01.10.2026) ────────────────────────
//
// Isomorph (node:test). Die zentrale CSV-Route (meldungen/[meldung]/csv/route.ts) holt den
// Dateinamen nur hier: BKI-Berichte (Register-Option `bki`) nach dem BKI-Schema
// <Betriebsnummer>_<Jahr>_<Berichtsname>[_von_JJJJMMTT_bis_JJJJMMTT].csv, alle anderen
// unverändert über dateiteile + Erstelldatum (csvDateiname).
// Fehlt die Weinbau-Betriebsnummer (Altbestand vor dem Pflichtfeld aus PR #41), steht ein
// Platzhalter im Namen und eine Warnung geht in X-Warnungen.

import { BKI_BETRIEBSNUMMER_PLATZHALTER, bkiDateiname, csvDateiname, wienHeute, type CsvDateiname } from '@/lib/csv'
import type { Betriebsdaten, MeldungsTeile } from './typen'

export const WARNUNG_BETRIEBSNUMMER_FEHLT =
  `Die Weinbau-Betriebsnummer fehlt (Mein Betrieb › Betrieb) – im Dateinamen steht „${BKI_BETRIEBSNUMMER_PLATZHALTER}“. Bitte die Nummer nachtragen und die Datei neu erstellen.`

export function meldungsDateiname<P>(
  meldung: Pick<MeldungsTeile<P, unknown>, 'dateiteile' | 'bki'>,
  p: P,
  betrieb: Betriebsdaten,
  heute: string = wienHeute(),
): { dateiname: CsvDateiname; warnungen: string[] } {
  if (!meldung.bki) return { dateiname: csvDateiname(meldung.dateiteile(p, betrieb), heute), warnungen: [] }
  const b = meldung.bki(p)
  const nr = betrieb.betriebsnummer?.trim() || null
  return {
    dateiname: bkiDateiname({ betriebsnummer: nr, jahr: b.jahr ?? heute.slice(0, 4), bericht: b.bericht, von: b.von, bis: b.bis }),
    warnungen: nr ? [] : [WARNUNG_BETRIEBSNUMMER_FEHLT],
  }
}
