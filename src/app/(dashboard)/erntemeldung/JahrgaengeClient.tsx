'use client'

import Link from 'next/link'
import type { Jahrgang } from './page'

const QUALITAET_LABEL: Record<string, string> = {
  sehr_gut: '⭐⭐⭐ Sehr gut', gut: '⭐⭐ Gut',
  durchschnittlich: '⭐ Durchschnittlich', schlecht: 'Schlecht',
}
const AMA_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  entwurf:     { label: 'Entwurf',     cls: 'bg-gray-100 text-gray-600' },
  bereit:      { label: 'Bereit',      cls: 'bg-blue-100 text-blue-700' },
  eingereicht: { label: 'Eingereicht', cls: 'bg-amber-100 text-amber-700' },
  bestaetigt:  { label: 'Bestätigt',   cls: 'bg-green-100 text-green-700' },
  abgelehnt:   { label: 'Abgelehnt',   cls: 'bg-red-100 text-red-700' },
}

function formatDate(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function JahrgaengeClient({
  jahrgaenge, writeOk,
}: {
  jahrgaenge: Jahrgang[]; writeOk: boolean
}) {
  if (jahrgaenge.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="text-4xl mb-4">🍇</p>
        <p className="text-gray-700 font-medium">Noch keine Jahrgänge erfasst</p>
        <p className="text-s112-muted text-sm mt-1 mb-6">Ersten Jahrgang anlegen und Erntedaten erfassen</p>
        {writeOk && (
          <Link href="/erntemeldung/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            ＋ Neuer Jahrgang
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {jahrgaenge.map(j => {
        const amaBadge = j.ama_status ? AMA_STATUS_BADGE[j.ama_status] : null

        return (
          <div key={j.id} className="card hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="text-4xl font-bold text-s112-teal tabular-nums">{j.jahrgang}</div>
                <div>
                  {j.qualitaet_gesamt && (
                    <p className="text-sm font-medium text-gray-700">
                      {QUALITAET_LABEL[j.qualitaet_gesamt]}
                    </p>
                  )}
                  <p className="text-xs text-s112-muted mt-0.5">
                    {j.ernte_beginn ? `Ernte: ${formatDate(j.ernte_beginn)}` : 'Ernte: nicht erfasst'}
                    {j.ernte_ende ? ` – ${formatDate(j.ernte_ende)}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {amaBadge && (
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${amaBadge.cls}`}>
                    AMA: {amaBadge.label}
                  </span>
                )}
                {j.abgeschlossen && (
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">
                    Abgeschlossen
                  </span>
                )}
                <Link href={`/erntemeldung/${j.id}`}
                  className="bg-s112-teal text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-opacity-90 transition-colors">
                  Öffnen
                </Link>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-s112-border">
              <div>
                <p className="text-lg font-bold text-gray-800 tabular-nums">
                  {j.gesamtmenge_kg > 0 ? `${(j.gesamtmenge_kg / 1000).toFixed(2)} t` : '–'}
                </p>
                <p className="text-xs text-s112-muted">Ernte gesamt</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-800 tabular-nums">
                  {j.gesamtmenge_kg > 0 ? `${(j.gesamtmenge_kg / 130).toFixed(1)} hl` : '–'}
                </p>
                <p className="text-xs text-s112-muted">Most (≈)</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-800 tabular-nums">{j.parzellen_count}</p>
                <p className="text-xs text-s112-muted">Parzellen erfasst</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
