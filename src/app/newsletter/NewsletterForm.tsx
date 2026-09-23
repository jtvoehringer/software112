'use client'

import { useState, useTransition } from 'react'
import { newsletterAnmelden } from './actions'
import { Mail } from 'lucide-react'

const SEGMENTE = [
  { value: 'privat',      label: 'Privatkunde / Weinliebhaber' },
  { value: 'gastronomie', label: 'Gastronomie / Restaurant'     },
  { value: 'handel',      label: 'Warenwirtschaft / Shop'            },
  { value: 'export',      label: 'Import / Export'              },
  { value: 'grosshandel', label: 'Großhandel'                   },
]

function inputCls(error?: boolean) {
  return `w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 transition-colors ${
    error ? 'border-s112-err/50 bg-s112-err-bg' : 'border-s112-border'
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
      <div role="status" className="text-center py-4">
        <div className="mb-3 flex justify-center">
          <Mail className="w-9 h-9 text-s112-blue-700" aria-hidden="true" />
        </div>
        <h3 className="font-semibold text-s112-text mb-1">Bestätigung unterwegs!</h3>
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
      {/* Falle für Bots (23.9.2026): für Menschen unsichtbar, nicht per Tab erreichbar */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <input type="text" name="webseite" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Vorname</label>
          <input aria-label="Vorname" name="vorname" className={inputCls()} placeholder="Maria" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Nachname</label>
          <input aria-label="Nachname" name="nachname" className={inputCls()} placeholder="Muster" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail-Adresse *</label>
        <input aria-label="E-Mail-Adresse" name="email" type="email" required className={inputCls(!!result?.error)}
          placeholder="maria.muster@beispiel.at" />
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Ich bin…</label>
        <select aria-label="Ich bin…" name="segment" defaultValue="privat"
          className={inputCls()}>
          {SEGMENTE.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Fehlermeldung */}
      {result?.error && (
        <div role="alert" className="bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 text-sm text-s112-err-fg">
          {result.error}
        </div>
      )}

      {/* Datenschutz-Checkbox */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" checked={datenschutz} onChange={e => setDatenschutz(e.target.checked)}
          className="accent-s112-teal w-4 h-4 mt-0.5 flex-shrink-0" />
        <span className="text-xs text-s112-text-2">
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
