'use client'

// KAN-236: Rückruf anfordern – Telefonnummer (Pflicht), Erreichbarkeit und Anliegen (optional); landet als Anfrage vom
// Typ „Rückruf“ mit höchster Priorität in SUP (/api/support/rueckruf).

import { useState } from 'react'
import { PhoneCall } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'

export default function RueckrufAnfordern() {
  const [telefon, setTelefon] = useState('')
  const [zeitfenster, setZeitfenster] = useState('')
  const [anliegen, setAnliegen] = useState('')
  const [sendet, setSendet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState<string | null>(null)

  const senden = async (e: React.FormEvent) => {
    e.preventDefault()
    setFehler(null); setErfolg(null); setSendet(true)
    try {
      const r = await fetch('/api/support/rueckruf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefon, zeitfenster, anliegen, seite: location.pathname }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.fehler ?? `Fehler ${r.status}`)
      setErfolg(d.key ?? '')
      setZeitfenster(''); setAnliegen('')
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      setSendet(false)
    }
  }

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <PhoneCall className="w-5 h-5 text-s112-muted" aria-hidden />
        <h2 className="text-base font-semibold text-s112-text">Rückruf anfordern</h2>
      </div>
      <p className="text-sm text-s112-text-2">Lieber telefonieren? Hinterlassen Sie Ihre Nummer – wir rufen Sie so bald wie möglich zurück.</p>
      {erfolg !== null && (
        <p className="rounded-lg bg-s112-ok-bg text-s112-ok-fg p-3 text-sm" role="status">
          Danke! Ihr Rückrufwunsch{erfolg ? <> <strong>{erfolg}</strong></> : null} ist eingegangen – wir melden uns unter {telefon}.
        </p>
      )}
      {fehler && <p className="text-sm text-s112-err-fg" role="alert">{fehler}</p>}
      <form onSubmit={senden} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1 block">
            <span className="text-s112-text-2">Telefonnummer *</span>
            <input type="tel" autoComplete="tel" value={telefon} onChange={e => setTelefon(e.target.value)} required maxLength={30}
              placeholder="+43 664 1234567" className="form-input w-full" />
          </label>
          <label className="text-sm space-y-1 block">
            <span className="text-s112-text-2">Am besten erreichbar (optional)</span>
            <input value={zeitfenster} onChange={e => setZeitfenster(e.target.value)} maxLength={500}
              placeholder="z. B. heute ab 14 Uhr" className="form-input w-full" />
          </label>
        </div>
        <label className="text-sm space-y-1 block">
          <span className="text-s112-text-2">Worum geht es? (optional)</span>
          <input value={anliegen} onChange={e => setAnliegen(e.target.value)} maxLength={500}
            placeholder="kurz in einem Satz" className="form-input w-full" />
        </label>
        <button type="submit" disabled={sendet || telefon.trim().length < 6}
          className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
          <PhoneCall className="w-4 h-4" aria-hidden /> {sendet ? 'Wird gesendet …' : 'Rückruf anfordern'}
        </button>
      </form>
    </section>
  )
}
