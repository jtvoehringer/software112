'use client'

import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvDatei, csvDateiname } from '@/lib/csv'
import { SPALTEN_RUECKVERFOLGUNG_TREFFER } from '@/lib/behoerden/rueckverfolgung'
import { fehlendeKuerzelHinweise } from '@/lib/wein/bki_kuerzel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Trefferliste der Rückverfolgung als CSV – seit 24.09.2026 über den Baustein lib/csv
// (Semikolon, BOM, CRLF, Formelschutz, Codes unverändert). Die ganze Kette Füllung →
// Charge → Pressung → Weingarten liefert die Meldung „rueckverfolgung“ (Server-CSV).
export default function RueckverfolgungCsvExportButton({
  treffer,
  filter,
}: {
  treffer: R[]
  filter: { jahrgang: number | null; sorte: string | null; bezeichnung: string | null }
}) {
  return (
    <CsvExportKnopf
      label="Trefferliste als CSV"
      erzeugen={() => {
        const datei = csvDatei(treffer, SPALTEN_RUECKVERFOLGUNG_TREFFER)
        return {
          text: datei.text,
          zeilen: datei.zeilen,
          warnungen: [...datei.warnungen, ...fehlendeKuerzelHinweise(treffer.map(t => t.rebsorte), { einheit: ['Füllung', 'Füllungen'] })],
          dateiname: csvDateiname(['Rückverfolgung-Füllungen', filter.jahrgang, filter.sorte, filter.bezeichnung]).utf8,
        }
      }}
    />
  )
}
