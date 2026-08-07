'use client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default function RueckverfolgungCsvExportButton({ treffer }: { treffer: R[] }) {
  function handleCSV() {
    const BOM = '﻿'
    const headers = ['Produktname', 'Bezeichnung', 'Jahrgang', 'Sorte', 'Qualität', 'Chargennummer', 'Prüfnummer', 'Bestand (Flaschen)']
    const rows: string[][] = [headers]
    for (const f of treffer) {
      rows.push([
        f.name ?? '',
        f.bezeichnung ?? '',
        f.jahrgang != null ? String(f.jahrgang) : '',
        f.rebsorte ?? '',
        f.qualitaet ?? '',
        f.chargennummer ?? '',
        f.pruefnummer ?? '',
        String(parseInt(f.bestand_flaschen) || 0),
      ])
    }
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rueckverfolgung_fuellungen.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleCSV}
      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium px-3 py-1.5 rounded-lg transition-colors"
    >
      CSV exportieren
    </button>
  )
}
