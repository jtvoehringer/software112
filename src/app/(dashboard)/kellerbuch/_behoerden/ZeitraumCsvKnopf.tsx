'use client'

import { useState } from 'react'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad, type MeldungsId } from '@/lib/behoerden/katalog'

// CSV einer Behördenmeldung mit Zeitraum von–bis (ohne eigene Druckseite, z. B. das
// Änderungsprotokoll auf /kellerbuch/gebinde). Leere Felder = gesamter Zeitraum.
export default function ZeitraumCsvKnopf({
  meldung,
  label,
  parameter = {},
}: {
  meldung: MeldungsId
  label?: string
  parameter?: Record<string, string>
}) {
  const [von, setVon] = useState('')
  const [bis, setBis] = useState('')
  const ok = !von || !bis || von <= bis
  const feld = 'border border-s112-border rounded-lg px-2.5 py-1.5 text-sm bg-white'
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <label className="text-xs text-s112-text-2">
        <span className="block mb-0.5 font-medium">Von</span>
        <input type="date" value={von} onChange={e => setVon(e.target.value)} aria-label="Zeitraum von" className={feld} />
      </label>
      <label className="text-xs text-s112-text-2">
        <span className="block mb-0.5 font-medium">Bis</span>
        <input type="date" value={bis} onChange={e => setBis(e.target.value)} aria-label="Zeitraum bis" className={feld} />
      </label>
      {ok
        ? <CsvExportKnopf label={label} href={csvPfad(meldung, { ...parameter, von, bis })} />
        : <span role="alert" className="text-xs text-s112-err-fg py-1.5">„Von“ liegt nach „Bis“.</span>}
    </div>
  )
}
