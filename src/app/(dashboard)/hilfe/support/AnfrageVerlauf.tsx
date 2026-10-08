'use client'

// KAN-235: Verlauf einer eigenen Support-Anfrage in software:112 – Beschreibung, öffentliche Antworten des Supports und
// eigene Antworten; Antworten gehen über /api/support/anfragen/<key> an Jira Service Management (kein Portal-Login).

import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'

type Kommentar = { id: string; vonKunde: boolean; autor: string; text: string; am: string }
type Detail = { key: string; betreff: string; beschreibung: string; status: string; erledigt: boolean; erstellt: string; kommentare: Kommentar[] }

const zeit = (iso: string) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' }) : '')

export default function AnfrageVerlauf({ anfrageKey, onGeaendert }: { anfrageKey: string; onGeaendert?: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [antwort, setAntwort] = useState('')
  const [sendet, setSendet] = useState(false)

  useEffect(() => {
    let abgebrochen = false
    fetch(`/api/support/anfragen/${encodeURIComponent(anfrageKey)}`, { cache: 'no-store' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.fehler ?? `HTTP ${r.status}`)
        return d as Detail
      })
      .then(d => { if (!abgebrochen) setDetail(d) })
      .catch(e => { if (!abgebrochen) setFehler((e as Error).message) })
    return () => { abgebrochen = true }
  }, [anfrageKey])

  const senden = async (e: React.FormEvent) => {
    e.preventDefault()
    setFehler(null)
    setSendet(true)
    try {
      const r = await fetch(`/api/support/anfragen/${encodeURIComponent(anfrageKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: antwort }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.fehler ?? `Fehler ${r.status}`)
      setDetail(d as Detail)
      setAntwort('')
      onGeaendert?.()
    } catch (err) {
      setFehler((err as Error).message)
    } finally {
      setSendet(false)
    }
  }

  if (!detail) {
    return fehler
      ? <p className="text-sm text-s112-err-fg" role="alert">{fehler}</p>
      : <p className="text-sm text-s112-muted">Wird geladen …</p>
  }

  return (
    <div className="mt-2 rounded-lg border border-s112-line bg-s112-bg/40 p-3 space-y-3 text-sm">
      <div>
        <p className="text-xs text-s112-muted">Ihre Anfrage vom {zeit(detail.erstellt)}</p>
        <p className="whitespace-pre-wrap text-s112-text-1 mt-1">{detail.beschreibung}</p>
      </div>
      {detail.kommentare.length === 0 ? (
        <p className="text-xs text-s112-muted">Noch keine Antwort – Sie bekommen zusätzlich eine E-Mail, sobald der Support antwortet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Verlauf">
          {detail.kommentare.map(k => (
            <li key={k.id} className={`rounded-lg px-3 py-2 ${k.vonKunde ? 'bg-white border border-s112-line ml-6' : 'bg-s112-blue-50 border border-s112-blue-100 mr-6'}`}>
              <p className="text-xs text-s112-muted">{k.vonKunde ? k.autor : 'software:112 Support'} · {zeit(k.am)}</p>
              <p className="whitespace-pre-wrap text-s112-text-1 mt-0.5">{k.text}</p>
            </li>
          ))}
        </ul>
      )}
      {fehler && <p className="text-sm text-s112-err-fg" role="alert">{fehler}</p>}
      {detail.erledigt ? (
        <p className="text-xs text-s112-muted">Diese Anfrage ist abgeschlossen. Für ein neues Anliegen senden Sie bitte oben eine neue Anfrage.</p>
      ) : (
        <form onSubmit={senden} className="space-y-2">
          <label className="block space-y-1">
            <span className="text-s112-text-2">Antworten</span>
            <textarea value={antwort} onChange={e => setAntwort(e.target.value)} rows={3} maxLength={5000} required minLength={2}
              placeholder="Ihre Nachricht an den Support" className="form-input w-full" />
          </label>
          <button type="submit" disabled={sendet || antwort.trim().length < 2}
            className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
            <Send className="w-4 h-4" aria-hidden /> {sendet ? 'Wird gesendet …' : 'Antwort senden'}
          </button>
        </form>
      )}
    </div>
  )
}
