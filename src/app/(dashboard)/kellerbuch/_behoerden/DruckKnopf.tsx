'use client'

// Druckknopf der Kellerbuch-Aufzeichnungen (Bewegungsbuch, Kellerbehandlungen) – gleiche
// Optik wie der CSV-Knopf daneben (CsvExportKnopf). Der Browser-Druck ergibt das PDF.
export default function DruckKnopf({ label = 'Drucken / PDF' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="text-xs bg-[#F2F3F5] hover:bg-s112-line text-s112-text-2 font-medium px-3 py-1.5 rounded-lg transition-colors print:hidden"
    >
      {label}
    </button>
  )
}
