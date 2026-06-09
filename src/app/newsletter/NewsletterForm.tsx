'use client'

import { useState, useTransition } from 'react'
import { newsletterAnmelden } from './actions'

const SEGMENTE = [
  { value: 'privat',      label: 'Privatkunde / Weinliebhaber' },
  { value: 'gastronomie', label: 'Gastronomie / Restaurant'     },
  { value: 'handel',      label: 'Warenwirtschaft / Shop'            },
  { value: 'export',      label: 'Import / Export'              },
  { value: 'grosshandel', label: 'Großhandel'                   },
]

function inputCls(error?: boolean) {
  return `w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 transition-colors ${
    error ? 'border-red-400 bg-red-50' : 'border-s112-border'
  }`
}

export default function NewsletterForm() {
  const [pending, startTransition] = useTransition()
  const [result, setResult]   = useState<{ ok: boolean; error?: string } | null>(null)
  const [datenschutz, setDatenschutz] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!datenschutz) return
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await newsletterAnmelden(fd)
      setResult(res)
    })
  }

  // Erfolgsstatus
  if (result?.ok) {
    return (
      <div className="text-center py-4">
        <div className="text-4xl mb-3">✉️</div>
        <h3 className="font-semibold text-gray-900 mb-1">Bestätigung unterwegs!</h3>
        <p className="text-sm text-s112-muted">
          Wir haben Ihnen eine Bestätigungs-E-Mail geschickt. Bitte klicken Sie auf den Link darin, um Ihre Anmeldung abzuschließen.
        </p>
        <p className="text-xs text-s112-muted mt-3">
          Keine E-Mail erhalten? Bitte prüfen Sie Ihren Spam-Ordner.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Vorname</label>
          <input name="vorname" className={inputCls()} placeholder="Maria" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nachname</label>
          <input name="nachname" className={inputCls()} placeholder="Muster" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail-Adresse *</label>
        <input name="email" type="email" required className={inputCls(!!result?.error)}
          placeholder="maria.muster@beispiel.at" />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Ich bin…</label>
        <select name="segment" defaultValue="privat"
          className={inputCls()}>
          {SEGMENTE.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Fehlermeldung */}
      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          {result.error}
        </div>
      )}

      {/* Datenschutz-Checkbox */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" checked={datenschutz} onChange={e => setDatenschutz(e.target.checked)}
          className="accent-s112-teal w-4 h-4 mt-0.5 flex-shrink-0" />
        <span className="text-xs text-gray-600">
          Ich stimme zu, dass meine Daten zur Zusendung des Newsletters verarbeitet werden.
          Die Einwilligung kann ich jederzeit widerrufen.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending || !datenschutz}
        className="w-full bg-s112-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-40"
      >
        {pending ? 'Wird gesendet…' : 'Anmelden & Bestätigung erhalten'}
      </button>
    </form>
  )
}
