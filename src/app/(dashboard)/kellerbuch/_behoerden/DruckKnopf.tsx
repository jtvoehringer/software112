'use client'

// Druckknopf der Kellerbuch-Aufzeichnungen (Bewegungsbuch, Kellerbehandlungen) – gleiche
// Optik wie der CSV-Knopf daneben (CsvExportKnopf). Der Browser-Druck ergibt das PDF.
// KAN-172: Hoch- oder Querformat wählbar (DruckFormatKnopf)
import DruckFormatKnopf from '@/components/DruckFormatKnopf'

export default function DruckKnopf({ label = 'Drucken / PDF' }: { label?: string }) {
  return <DruckFormatKnopf label={label} klein />
}
