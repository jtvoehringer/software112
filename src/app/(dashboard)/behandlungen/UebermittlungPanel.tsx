'use client'

// KAN-120: „Offene Aufzeichnungen exportieren“ (POST mit Protokoll) und den letzten Export erneut herunterladen.
// Nach dem Export lädt die Seite neu, damit die Spalte „Übermittlung“ den neuen Stand zeigt.

import { useRouter } from 'next/navigation'
import CsvExportKnopf from '@/components/CsvExportKnopf'

export type UebermittlungUebersicht = {
  offen: number
  korrektur: number
  letzterLauf: { exportId: string; exportiertAm: string; exportiertVon: string | null; massnahmen: number } | null
}

export default function UebermittlungPanel({ uebersicht, schreibOk }: { uebersicht: UebermittlungUebersicht; schreibOk: boolean }) {
  const router = useRouter()
  const { offen, korrektur, letzterLauf } = uebersicht
  const zuExportieren = offen + korrektur
  return (
    <div className="card mb-6 flex flex-wrap items-start justify-between gap-4" data-print="hide">
      <div className="text-sm">
        <p className="font-semibold text-s112-text">PSM-Übermittlung an die Prüfstelle</p>
        <p className="text-s112-muted mt-0.5">
          {zuExportieren === 0
            ? 'Alle Pflanzenschutz-Aufzeichnungen sind exportiert.'
            : <>
                {offen > 0 && <span>{offen} offen</span>}
                {offen > 0 && korrektur > 0 && ' · '}
                {korrektur > 0 && <span className="text-s112-warn-fg">{korrektur} Korrektur offen</span>}
              </>}
          {letzterLauf && (
            <span className="block text-xs mt-0.5">
              Letzter Export am {new Date(letzterLauf.exportiertAm).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' })}
              {letzterLauf.exportiertVon ? ` von ${letzterLauf.exportiertVon}` : ''} ({letzterLauf.massnahmen} {letzterLauf.massnahmen === 1 ? 'Maßnahme' : 'Maßnahmen'})
            </span>
          )}
        </p>
      </div>
      {schreibOk && (
        <div className="flex flex-wrap items-start gap-3">
          {zuExportieren > 0 && (
            <CsvExportKnopf href="/api/behandlungen/uebermittlung" methode="POST" nachErfolg={() => router.refresh()}
              label="Offene Aufzeichnungen exportieren"
              hinweis="Exportiert offene und geänderte Pflanzenschutz-Aufzeichnungen als CSV und vermerkt sie als exportiert (Version und Prüfsumme je Maßnahme)." />
          )}
          {letzterLauf && (
            <CsvExportKnopf href={`/api/behandlungen/uebermittlung?export=${letzterLauf.exportId}`}
              label="Letzten Export erneut herunterladen" />
          )}
        </div>
      )}
    </div>
  )
}
