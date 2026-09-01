'use client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmtDate(d: string | null | undefined) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('de-AT')
}

function fmtNum(n: number | null | undefined) {
  return (n ?? 0).toString().replace('.', ',')
}

export default function CsvExportButton({
  buchungen,
  jahr,
}: {
  buchungen: R[]
  jahr: number
}) {
  function handleCSV() {
    const BOM = '﻿'
    const headers = [
      'Datum', 'Typ', 'Bezeichnung', 'Kategorie', 'USt-Satz (%)',
      'Netto EUR', 'USt-Betrag EUR', 'Brutto EUR', 'Beleg/Verkauf', 'DebitorNr.', 'Quelle', 'Notizen',
    ]
    const rows: string[][] = [headers]
    for (const b of buchungen) {
      const kategorie = (b.ea_kategorien as R | null)?.name ?? ''
      const vp = (b.verkaufsposten as R | null)
      const beleg = vp?.rechnungsnummer ?? ''
      // DebitorNr. (BMD-Konto) der Firma, falls hinterlegt (Migration 191) - sonst
      // ersatzweise unsere interne Accountnummer (Firma oder Kontakt), damit die
      // Spalte auch ohne BMD-Anbindung eine Kundenzuordnung ermöglicht.
      const debitorNr = vp?.firma?.debitor_nr || vp?.firma?.accountnummer || vp?.kontakt?.accountnummer || ''
      rows.push([
        fmtDate(b.datum),
        b.typ === 'einnahme' ? 'Einnahme' : 'Ausgabe',
        b.beschreibung ?? '',
        kategorie,
        fmtNum(b.ust_satz),
        fmtNum(b.betrag_netto),
        fmtNum(b.ust_betrag),
        fmtNum(b.betrag_brutto),
        beleg,
        debitorNr,
        b.import_quelle === 'verkauf' ? 'Automatisch (Verkauf)' : (b.import_quelle ?? 'manuell'),
        b.notizen ?? '',
      ])
    }
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ea_buchungen_${jahr}.csv`
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
