'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import type { Jahrgang } from './page'
import { fmtZahl, fmtProzent } from '@/lib/format'
import { updateJahrgang, deleteJahrgang } from './actions'

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
  jahrgaenge, writeOk, adminOk,
}: {
  jahrgaenge: Jahrgang[]; writeOk: boolean; adminOk?: boolean
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
      {jahrgaenge.map(j => (
        <JahrgangKarte key={j.id} j={j} writeOk={writeOk} adminOk={adminOk ?? false} />
      ))}
    </div>
  )
}

function JahrgangKarte({ j, writeOk, adminOk }: { j: Jahrgang; writeOk: boolean; adminOk: boolean }) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()

  const amaBadge = j.ama_status ? AMA_STATUS_BADGE[j.ama_status] : null

  function handleDelete() {
    if (!confirm(`Jahrgang ${j.jahrgang} und alle Erntedaten wirklich löschen?`)) return
    startTransition(() => deleteJahrgang(j.id))
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await updateJahrgang(j.id, fd)
      setEditing(false)
    })
  }

  return (
    <div className={`card hover:shadow-md transition-shadow ${pending ? 'opacity-50 pointer-events-none' : ''}`}>
      {editing ? (
        <form onSubmit={handleSave} className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Jahrgang {j.jahrgang} bearbeiten</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ernte Beginn</label>
              <input name="ernte_beginn" type="date" defaultValue={j.ernte_beginn ?? ''}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ernte Ende</label>
              <input name="ernte_ende" type="date" defaultValue={j.ernte_ende ?? ''}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Qualität</label>
              <select name="qualitaet_gesamt" defaultValue={j.qualitaet_gesamt ?? ''}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="">– keine Bewertung –</option>
                {Object.entries(QUALITAET_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
              <input name="notizen" defaultValue={j.notizen ?? ''}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
              Speichern
            </button>
            <button type="button" onClick={() => setEditing(false)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold text-s112-teal tabular-nums">{j.jahrgang}</div>
              <div>
                {j.qualitaet_gesamt && (
                  <p className="text-sm font-medium text-gray-700">{QUALITAET_LABEL[j.qualitaet_gesamt]}</p>
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
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">Abgeschlossen</span>
              )}
              <Link href={`/erntemeldung/${j.id}`}
                className="bg-s112-teal text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-opacity-90 transition-colors">
                Öffnen
              </Link>
              {writeOk && (
                <button onClick={() => setEditing(true)}
                  className="text-xs text-s112-teal hover:underline font-medium">
                  Bearbeiten
                </button>
              )}
              {adminOk && (
                <button onClick={handleDelete}
                  className="text-xs text-red-400 hover:text-red-600">
                  Löschen
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-s112-border">
            <div>
              <p className="text-lg font-bold text-gray-800 tabular-nums">
                {j.gesamtmenge_kg > 0 ? `${fmtZahl(j.gesamtmenge_kg / 1000, 2)} t` : '–'}
              </p>
              <p className="text-xs text-s112-muted">Ernte gesamt</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-800 tabular-nums">
                {j.gesamtmenge_kg > 0 ? `${fmtProzent(j.gesamtmenge_kg / 130)} hl` : '–'}
              </p>
              <p className="text-xs text-s112-muted">Most (≈)</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-800 tabular-nums">
                {j.avg_kmw != null ? `${fmtZahl(j.avg_kmw, 1)} °KMW` : '–'}
              </p>
              <p className="text-xs text-s112-muted">Ø KMW</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-800 tabular-nums">{j.parzellen_count}</p>
              <p className="text-xs text-s112-muted">Parzellen</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
