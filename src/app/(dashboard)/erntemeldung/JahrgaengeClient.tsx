'use client'

import React, { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { Pencil, Trash2 } from 'lucide-react'
import type { Jahrgang } from './page'
import { fmtZahl, fmtProzent } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { updateJahrgang, deleteJahrgang } from './actions'
import { leseArtText, leseNummer, leseZeitraumText } from '@/lib/wein/lesen'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'

const QUALITAET_LABEL: Record<string, string> = {
  sehr_gut: 'Sehr gut', gut: 'Gut',
  durchschnittlich: 'Durchschnittlich', schlecht: 'Schlecht',
}
const AMA_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  entwurf:     { label: 'Entwurf',     cls: 'bg-[#F2F3F5] text-s112-text-2' },
  bereit:      { label: 'Bereit',      cls: 'bg-s112-blue-100 text-s112-blue-700' },
  eingereicht: { label: 'Eingereicht', cls: 'bg-s112-warn-bg text-s112-warn-fg' },
  bestaetigt:  { label: 'Bestätigt',   cls: 'bg-s112-ok-bg text-s112-ok-fg' },
  abgelehnt:   { label: 'Abgelehnt',   cls: 'bg-s112-err-bg text-s112-err-fg' },
}

export default function JahrgaengeClient({
  jahrgaenge, writeOk, adminOk,
}: {
  jahrgaenge: Jahrgang[]; writeOk: boolean; adminOk?: boolean
}) {
  if (jahrgaenge.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="text-s112-text-1 font-medium">Noch keine Jahrgänge erfasst</p>
        <p className="text-s112-muted text-sm mt-1 mb-6">Erste Lese anlegen (der Jahrgang entsteht dabei) und Lesedaten erfassen</p>
        {writeOk && (
          <Link href="/erntemeldung/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Neue Lese
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
  const [fehler, setFehler] = useState<string | null>(null)

  const amaBadge = j.ama_status ? AMA_STATUS_BADGE[j.ama_status] : null

  function handleDelete() {
    // KAN-35: Sperrgrund vorab zeigen (der Server prüft dieselben Regeln noch einmal)
    if (j.loeschsperre) { setFehler(j.loeschsperre); return }
    const umfang = [
      j.parzellen_count > 0 ? `${j.parzellen_count} ${j.parzellen_count === 1 ? 'Lese-Eintrag' : 'Lese-Einträge'}` : null,
      j.ama_status ? 'die AMA-Erntemeldung (noch nicht eingereicht)' : null,
    ].filter(Boolean).join(' und ')
    if (!confirm(`Jahrgang ${j.jahrgang}${umfang ? ` samt ${umfang}` : ''} wirklich löschen?`)) return
    setFehler(null)
    startTransition(async () => {
      try {
        await deleteJahrgang(j.id)
      } catch (err) {
        setFehler(fehlerText(err, 'Der Jahrgang konnte nicht gelöscht werden.'))
      }
    })
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      try {
        await updateJahrgang(j.id, fd)
        setEditing(false)
      } catch (err) {
        setFehler(fehlerText(err, 'Der Jahrgang konnte nicht gespeichert werden.'))
      }
    })
  }

  return (
    <div className={`card hover:shadow-sm transition-shadow ${pending ? 'opacity-50 pointer-events-none' : ''}`}>
      {fehler && (
        <div role="alert" className="mb-3 flex items-start gap-2 text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">
          <span className="flex-1">{fehler}</span>
          <button type="button" onClick={() => setFehler(null)} aria-label="Meldung schließen" className="shrink-0 font-semibold hover:opacity-70">×</button>
        </div>
      )}
      {editing ? (
        <form onSubmit={handleSave} className="space-y-3">
          <h3 className="text-sm font-semibold text-s112-text">Jahrgang {j.jahrgang} bearbeiten</h3>
          {/* KAN-129: Beginn und Ende stehen an der Lese (Jahrgangsseite, Reiter der Lese) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Qualität</label>
              <select aria-label="Qualität" name="qualitaet_gesamt" defaultValue={j.qualitaet_gesamt ?? ''}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="">– keine Bewertung –</option>
                {Object.entries(QUALITAET_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
              <input aria-label="Notizen" name="notizen" defaultValue={j.notizen ?? ''}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
              Speichern
            </button>
            <button type="button" onClick={() => setEditing(false)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="text-4xl font-semibold text-s112-blue-700 tabular-nums">{j.jahrgang}</div>
              <div>
                {j.qualitaet_gesamt && (
                  <p className="text-sm font-medium text-s112-text-1">{QUALITAET_LABEL[j.qualitaet_gesamt]}</p>
                )}
                {/* KAN-129: Lesen des Jahrgangs – jede führt direkt zu ihrem Reiter */}
                <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Lesen des Jahrgangs ${j.jahrgang}`}>
                  {j.lesen.map(l => {
                    const zeitraum = leseZeitraumText(l.beginn, l.ende)
                    return (
                      <li key={l.id}>
                        <Link href={`/erntemeldung/${j.id}?lese=${l.lfd_nr}`}
                          title={l.bezeichnung ?? undefined}
                          className="inline-flex items-center gap-1 rounded-full border border-s112-border px-2 py-0.5 text-xs text-s112-text-1 hover:border-s112-blue-700 hover:text-s112-blue-700">
                          <span className="font-semibold tabular-nums">{leseNummer(j.jahrgang, l.lfd_nr)}</span>
                          <span>{leseArtText(l.art)}</span>
                          <span className="text-s112-muted">{zeitraum ?? 'Zeitraum offen'}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {amaBadge && (
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${amaBadge.cls}`}>
                  AMA: {amaBadge.label}
                </span>
              )}
              {j.abgeschlossen && (
                <span className="text-xs px-2 py-1 rounded-full bg-[#F2F3F5] text-s112-text-2">Abgeschlossen</span>
              )}
              <Link href={`/erntemeldung/${j.id}`}
                className="bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-opacity-90 transition-colors">
                Öffnen
              </Link>
              {writeOk && (
                <button onClick={() => setEditing(true)}
                  title="Bearbeiten" aria-label="Bearbeiten"
                  className="text-s112-blue-700 hover:text-s112-blue-700/70">
                  <Pencil size={14} />
                </button>
              )}
              {adminOk && (
                <button onClick={handleDelete}
                  title={j.loeschsperre ?? 'Löschen'}
                  aria-label={j.loeschsperre ? 'Löschen nicht möglich – Grund anzeigen' : 'Löschen'}
                  className={j.loeschsperre ? 'text-s112-muted opacity-50 hover:opacity-80' : 'text-s112-err hover:text-s112-err-fg'}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-s112-border">
            <div>
              <p className="text-lg font-semibold text-s112-text tabular-nums">
                {j.gesamtmenge_kg > 0 ? `${fmtZahl(j.gesamtmenge_kg / 1000, 2)} t` : '–'}
              </p>
              <p className="text-xs text-s112-muted">Ernte gesamt</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-s112-text tabular-nums">
                {j.gesamtmenge_kg > 0 ? `${fmtProzent(j.gesamtmenge_kg / 130)} hl` : '–'}
              </p>
              <p className="text-xs text-s112-muted">Most (≈)</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-s112-text tabular-nums">
                {/* KAN-131: kg-gewichtet, °KMW auf 1 Stelle abgerundet, dazu °Oe */}
                <MostgewichtAnzeige wert={j.avg_kmw != null ? { kmw: j.avg_kmw, oechsle: null, einheit: 'kmw' } : null} kmwStellen={1} />
              </p>
              <p className="text-xs text-s112-muted">Ø Mostgewicht (kg-gewichtet)</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-s112-text tabular-nums">{j.parzellen_count}</p>
              <p className="text-xs text-s112-muted">Parzellen</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
