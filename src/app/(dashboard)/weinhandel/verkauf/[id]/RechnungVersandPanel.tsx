'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'

export default function RechnungVersandPanel({
  verkaufId, defaultEmail, sentAt, sentTo,
}: {
  verkaufId: string
  defaultEmail: string
  sentAt: string | null
  sentTo: string | null
}) {
  const router = useRouter()
  const [open, setOpen]       = useState(false)
  const [to, setTo]           = useState(defaultEmail)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState('')

  async function handleSend() {
    if (!to.trim()) { setError('Bitte eine Empfänger-E-Mail-Adresse angeben.'); return }
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/weinhandel/verkauf/${verkaufId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), message: message.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Versand fehlgeschlagen.'); setSending(false); return }
      setOpen(false)
      setMessage('')
      router.refresh()
    } catch {
      setError('Versand fehlgeschlagen. Bitte später erneut versuchen.')
    }
    setSending(false)
  }

  return (
    <>
      {sentAt && (
        <span className="inline-flex items-center gap-1 text-xs font-medium bg-s112-bg text-s112-blue-700 px-2.5 py-1 rounded-full no-print">
          <Mail size={12} />
          Versendet am {new Date(sentAt).toLocaleDateString('de-AT')}{sentTo ? ` an ${sentTo}` : ''}
        </span>
      )}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-s112-blue-700 bg-white border border-s112-border hover:bg-s112-bg px-2.5 py-1.5 rounded-lg transition-colors no-print"
        >
          <Mail size={14} /> Per E-Mail senden
        </button>
      )}

      {open && (
        <div className="card p-5 space-y-3 no-print w-full">
          <p className="text-sm font-semibold text-s112-text">Rechnung per E-Mail senden</p>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Empfänger-E-Mail-Adresse</label>
            <input aria-label="Empfänger-E-Mail-Adresse" type="email" value={to} onChange={e => setTo(e.target.value)}
              placeholder="kunde@beispiel.at" className="form-input text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Nachricht (optional)</label>
            <textarea aria-label="Nachricht (optional)" rows={2} value={message} onChange={e => setMessage(e.target.value)}
              placeholder="z.B. anbei erhalten Sie die Rechnung wie besprochen."
              className="form-input text-sm w-full resize-none" />
          </div>
          {error && <p className="text-s112-err-fg text-sm bg-s112-err-bg px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={sending}
              className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
              {sending ? 'Wird gesendet…' : 'Senden'}
            </button>
            <button onClick={() => { setOpen(false); setError('') }}
              className="px-4 py-2 text-sm text-s112-muted hover:text-s112-text-1">
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </>
  )
}
