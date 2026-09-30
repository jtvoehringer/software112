'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import Link from '@/components/ui/Link'
import { fehlerText } from '@/lib/fehler'
import { leseArtText, leseNummer, leseZeitraumText, type Lese } from '@/lib/wein/lesen'
import { deleteLese, updateLese } from '../actions'
import LeseFelder from '../LeseFelder'

export type LeseMitSperre = Lese & {
  /** warum die Lese nicht gelöscht werden kann (null = löschbar), gleiche Regeln wie deleteLese */
  loeschsperre: string | null
}

/**
 * KAN-129: Lesen eines Jahrgangs als Reiter (`?lese=<Nr.>`). Lesedaten, Pressungen und die verfügbaren kg
 * darunter gelten für die gewählte Lese; neue Einträge und Pressungen landen in ihr.
 */
export default function LeseReiter({ jahrgangId, jahrgang, lesen, aktiv, writeOk, adminOk }: {
  jahrgangId: string; jahrgang: number; lesen: LeseMitSperre[]; aktiv: LeseMitSperre
  writeOk: boolean; adminOk: boolean
}) {
  const router = useRouter()
  const [bearbeiten, setBearbeiten] = useState(false)
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const zeitraum = leseZeitraumText(aktiv.beginn, aktiv.ende)

  function speichern(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      try { await updateLese(aktiv.id, fd); setBearbeiten(false) }
      catch (err) { setFehler(fehlerText(err, 'Die Lese konnte nicht gespeichert werden.')) }
    })
  }

  function loeschen() {
    if (aktiv.loeschsperre) { setFehler(aktiv.loeschsperre); return }
    if (!confirm(`Lese ${leseNummer(jahrgang, aktiv.lfd_nr)} (${leseArtText(aktiv.art)}) wirklich löschen?`)) return
    setFehler(null)
    startTransition(async () => {
      try {
        await deleteLese(aktiv.id)
        router.push(`/erntemeldung/${jahrgangId}`)
      } catch (err) { setFehler(fehlerText(err, 'Die Lese konnte nicht gelöscht werden.')) }
    })
  }

  return (
    <div className={`card mb-6 ${pending ? 'opacity-60 pointer-events-none' : ''}`} data-print="hide">
      {lesen.length > 1 && (
        <nav aria-label="Lesen des Jahrgangs" className="-mt-1 mb-3 flex flex-wrap gap-1 border-b border-s112-border">
          {lesen.map(l => {
            const gewaehlt = l.id === aktiv.id
            return (
              <Link key={l.id} href={`/erntemeldung/${jahrgangId}?lese=${l.lfd_nr}`}
                aria-current={gewaehlt ? 'page' : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${gewaehlt
                  ? 'border-s112-blue-700 font-semibold text-s112-blue-700'
                  : 'border-transparent text-s112-text-2 hover:text-s112-blue-700'}`}>
                <span className="tabular-nums">{leseNummer(jahrgang, l.lfd_nr)}</span> {leseArtText(l.art)}
              </Link>
            )
          })}
        </nav>
      )}

      {fehler && (
        <div role="alert" className="mb-3 flex items-start gap-2 text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">
          <span className="flex-1">{fehler}</span>
          <button type="button" onClick={() => setFehler(null)} aria-label="Meldung schließen" className="shrink-0 font-semibold hover:opacity-70">×</button>
        </div>
      )}

      {bearbeiten ? (
        <form onSubmit={speichern} className="space-y-3">
          <h2 className="text-sm font-semibold text-s112-text">Lese {leseNummer(jahrgang, aktiv.lfd_nr)} bearbeiten</h2>
          <LeseFelder jahrgang={jahrgang} lese={aktiv} />
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending}
              className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
              Speichern
            </button>
            <button type="button" onClick={() => setBearbeiten(false)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-s112-text">
              Lese <span className="tabular-nums">{leseNummer(jahrgang, aktiv.lfd_nr)}</span> · {leseArtText(aktiv.art)}
              {aktiv.bezeichnung && <span className="font-normal text-s112-text-1"> – {aktiv.bezeichnung}</span>}
            </h2>
            <p className="text-xs text-s112-muted mt-0.5">{zeitraum ?? 'Zeitraum noch offen'}</p>
            {aktiv.notizen && <p className="text-xs text-s112-text-2 mt-1 whitespace-pre-line">{aktiv.notizen}</p>}
          </div>
          <div className="flex items-center gap-3">
            {/* KAN-108: Maßnahmen je Lese-Grundstück bis zur Ernte, Wartezeiten */}
            <Link href={`/weingarten/rueckverfolgung?lese=${aktiv.id}`} className="text-xs font-medium text-s112-blue-700 hover:underline">
              Rückverfolgung Weingarten
            </Link>
            {writeOk && (
              <button type="button" onClick={() => { setBearbeiten(true); setFehler(null) }}
                title="Lese bearbeiten" aria-label="Lese bearbeiten"
                className="text-s112-blue-700 hover:text-s112-blue-700/70">
                <Pencil size={14} />
              </button>
            )}
            {adminOk && lesen.length > 1 && (
              <button type="button" onClick={loeschen}
                title={aktiv.loeschsperre ?? 'Lese löschen'}
                aria-label={aktiv.loeschsperre ? 'Lese löschen nicht möglich – Grund anzeigen' : 'Lese löschen'}
                className={aktiv.loeschsperre ? 'text-s112-muted opacity-50 hover:opacity-80' : 'text-s112-err hover:text-s112-err-fg'}>
                <Trash2 size={14} />
              </button>
            )}
            {writeOk && (
              <Link href={`/erntemeldung/neu?jahrgang=${jahrgang}`}
                className="inline-flex items-center gap-1.5 border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg text-xs hover:bg-s112-bg transition-colors">
                <Plus size={14} strokeWidth={2.5} /> Weitere Lese
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
