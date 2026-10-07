'use client'

// KAN-147: CSV der Lese-Auswertung (Standardprofil, keine Behördenmeldung) – im Browser aus den Zeilen der Seite
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvDateiname, csvText } from '@/lib/csv'
import { SPALTEN_ERTRAG, SPALTEN_MOSTGEWICHT, type ErtragZeile, type MostgewichtZeile } from '@/lib/wein/leseAuswertung'

export default function LeseAuswertungCsv({ jahrgang, ertrag, mostgewicht }: { jahrgang: number; ertrag: ErtragZeile[]; mostgewicht: MostgewichtZeile[] }) {
  return (
    <span className="inline-flex gap-2 print:hidden">
      <CsvExportKnopf label="Ertrag (CSV)" erzeugen={() => ({ text: csvText(ertrag, SPALTEN_ERTRAG), dateiname: csvDateiname(['lese-ertrag', jahrgang]).utf8, zeilen: ertrag.length })} />
      <CsvExportKnopf label="Mostgewicht (CSV)" erzeugen={() => ({ text: csvText(mostgewicht, SPALTEN_MOSTGEWICHT), dateiname: csvDateiname(['lese-mostgewicht', jahrgang]).utf8, zeilen: mostgewicht.length })} />
    </span>
  )
}
