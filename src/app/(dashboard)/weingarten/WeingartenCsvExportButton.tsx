'use client'

// Rückmeldung 24.8.2026: Rieden-Übersicht als CSV auswertbar machen (z.B. für
// Pivot-Auswertungen in Excel) - eine Zeile pro Grundstück, analog zur
// flachen GST-Darstellung in der Rieden-Übersicht (siehe WeingartenBaum.tsx).
// Weingarten-Datensätze OHNE eigene Grundstücke (siehe weingaertenOhneGst
// dort) bekommen trotzdem eine eigene Zeile, sonst würden sie im Export
// komplett fehlen.

import { getRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { NUTZART_OPTIONS } from '@/lib/wein/grundstueckStatus'
import type { WRow, GSTRow } from './WeingartenBaum'

function fmtHaCsv(n: number | null | undefined): string {
  if (n == null) return ''
  return n.toLocaleString('de-AT', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

const WEINART_LABEL: Record<string, string> = { rot: 'Rot', weiss: 'Weiß', rose: 'Rosé' }

export default function WeingartenCsvExportButton({ weingaerten, grundstuecke }: {
  weingaerten: WRow[]; grundstuecke: GSTRow[]
}) {
  function handleCSV() {
    const gstMap = new Map<string, GSTRow[]>()
    for (const g of grundstuecke) {
      const arr = gstMap.get(g.weingarten_id) ?? []
      arr.push(g)
      gstMap.set(g.weingarten_id, arr)
    }

    const BOM = '﻿'
    const headers = [
      'Ried / Lage', 'Interne Bezeichnung', 'AMA-Feldstücknr.', 'Codes',
      'GST-Nr', 'AMA-Schlagnr.', 'Rebsorte', 'Kürzel', 'Nutzart', 'Nutzung',
      'Weinart', 'Bewirtschaftung',
      'GST-Fläche lt. Kataster (ha)', 'GST-Fläche lt. AMA (ha)', 'Aktiv',
    ]
    const rows: string[][] = [headers]

    for (const w of weingaerten) {
      const gsts = (gstMap.get(w.id) ?? []).sort((a, b) => a.gst_nr.localeCompare(b.gst_nr, 'de', { numeric: true }))
      const riedName = w.ried ?? w.name
      if (gsts.length > 0) {
        for (const g of gsts) {
          rows.push([
            riedName,
            w.interne_bezeichnung ?? '',
            w.ama_feldnummer ?? '',
            w.codes ?? '',
            g.gst_nr,
            g.ama_feldnummer ?? '',
            g.rebsorte ?? '',
            getRebsorteKuerzel(g.rebsorte),
            g.nutzart ?? '',
            NUTZART_OPTIONS.find(o => o.value === g.nutzart)?.label ?? '',
            WEINART_LABEL[w.weinart ?? ''] ?? '',
            w.bewirtschaftung ?? '',
            fmtHaCsv(g.flaeche_ha_kataster),
            fmtHaCsv(g.flaeche_ha),
            w.aktiv ? 'Ja' : 'Nein',
          ])
        }
      } else {
        // Weingarten-Datensatz ohne eigene Grundstücke (siehe Kommentar oben) -
        // eigene Zeile mit den Feldern auf Ried/Weingarten-Ebene, GST-
        // spezifische Spalten bleiben leer.
        rows.push([
          riedName,
          w.interne_bezeichnung ?? '',
          w.ama_feldnummer ?? '',
          w.codes ?? '',
          '', '',
          w.rebsorte ?? '',
          getRebsorteKuerzel(w.rebsorte),
          '', '',
          WEINART_LABEL[w.weinart ?? ''] ?? '',
          w.bewirtschaftung ?? '',
          '',
          fmtHaCsv(w.flaeche_ha),
          w.aktiv ? 'Ja' : 'Nein',
        ])
      }
    }

    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rieden_${new Date().toISOString().split('T')[0]}.csv`
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
