'use client'

// ── Self-Service-Signup: öffentliches Formular ────────────────────────────────
// Rückmeldung 31.8.2026: Betriebsname, Ansprechperson, E-Mail + Plan-Wahl in
// einem Schritt. KAN-139: kein Passwort mehr im Formular und kein direkter
// Stripe-Checkout – die Person bekommt einen Link per E-Mail, bestätigt damit
// ihre Adresse und legt erst dann das Passwort fest; die Zahlungsdaten folgen
// nach der ersten Anmeldung auf /abo. Stil/Layout analog (auth)/login/page.tsx.

import { useState } from 'react'
import { registrierenAction } from './actions'
import { PAKETE, PAKET_REIHENFOLGE, paketPriceId, preisText, type PaketKey } from '@/lib/pakete'

// Paketmodell Basis / Standard / Premium (2.9.2026), Definition in lib/pakete.ts.
// Nur Pakete mit hinterlegter Stripe-Preis-ID werden angeboten.
const PAKET_OPTIONEN = PAKET_REIHENFOLGE.map(k => PAKETE[k]).filter(p => paketPriceId(p.key))

export default function SignupClient() {
  const [betrieb, setBetrieb]   = useState('')
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  // Vorbelegt: Standard (mittleres Paket), sonst das erste verfügbare
  const [paket, setPaket]       = useState<PaketKey | ''>(
    PAKET_OPTIONEN.some(p => p.key === 'standard') ? 'standard' : (PAKET_OPTIONEN[0]?.key ?? ''),
  )
  const [zustimmung, setZustimmung] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [erledigt, setErledigt] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!zustimmung) { setError('Bitte AGB und Datenschutzerklärung bestätigen.'); return }
    if (!paket) { setError('Bitte ein Paket auswählen.'); return }

    setLoading(true)
    try {
      const fd = new FormData()
      fd.set('betrieb', betrieb)
      fd.set('name', name)
      fd.set('email', email)
      fd.set('paket', paket)

      const res = await registrierenAction(fd)
      setLoading(false)
      if (!res.ok) { setError(res.fehler); return }
      setErledigt(res.hinweis)
    } finally {
      setLoading(false)
    }
  }

  if (erledigt) {
    return (
      <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="card space-y-3 text-center" role="status">
            <h1 className="text-lg font-semibold text-s112-text">Bitte bestätigen Sie Ihre E-Mail-Adresse</h1>
            <p className="text-sm text-s112-muted">{erledigt}</p>
            <a href="/login" className="text-sm text-s112-blue-700 hover:underline block pt-1">Zur Anmeldung</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-s112-blue-700 inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">14 Tage kostenlos testen – digitale Klarheit für den Weinbau</p>
        </div>

        <div className="card space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="betrieb" className="block text-sm font-medium text-s112-text-1 mb-1">Name Ihres Betriebs</label>
              <input id="betrieb" type="text" required className="input" placeholder="Weingut Musterhof"
                value={betrieb} onChange={e => setBetrieb(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-s112-text-1 mb-1">Ihr Name</label>
                <input id="name" type="text" required className="input" placeholder="Maria Musterfrau"
                  value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-s112-text-1 mb-1">E-Mail</label>
                <input id="email" type="email" required autoComplete="username" className="input" placeholder="maria@weingut.at"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>

            <p className="text-[12.5px] text-s112-muted">
              Wir schicken Ihnen einen Link an diese Adresse. Darüber bestätigen Sie sie und legen Ihr Passwort fest.
            </p>

            {PAKET_OPTIONEN.length > 0 && (
              <div>
                <span className="block text-sm font-medium text-s112-text-1 mb-1.5">Paket</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PAKET_OPTIONEN.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPaket(p.key)}
                      aria-pressed={paket === p.key}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                        paket === p.key
                          ? 'border-s112-teal bg-s112-teal/5 ring-1 ring-s112-teal'
                          : 'border-s112-line hover:border-s112-line-str'
                      }`}
                    >
                      <p className="font-semibold text-s112-text">{p.label}</p>
                      <p className="text-s112-blue-700 font-medium">{preisText(p)}</p>
                      <ul className="text-[11.5px] text-s112-muted mt-1 space-y-0.5">
                        {p.leistungen.map(l => <li key={l}>· {l}</li>)}
                      </ul>
                    </button>
                  ))}
                </div>
                <p className="text-[11.5px] text-s112-muted mt-1.5">
                  14 Tage kostenlos, danach automatische Abrechnung – jederzeit kündbar.
                </p>
              </div>
            )}

            <label className="flex items-start gap-2 text-[12.5px] text-s112-muted">
              <input type="checkbox" className="mt-0.5" checked={zustimmung} onChange={e => setZustimmung(e.target.checked)} />
              <span>
                {/* link-ok: AGB und Datenschutzerklärung sind noch einzurichten (KAN-300, In Abklärung) */}
                Ich habe die <a href="/agb" target="_blank" className="text-s112-blue-700 hover:underline">AGB</a> und{' '}
                <a href="/datenschutz" target="_blank" className="text-s112-blue-700 hover:underline">Datenschutzerklärung</a> gelesen und stimme zu.
              </span>
            </label>

            {error && (
              <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm px-3 py-2 rounded-lg">{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? 'Wird gesendet …' : 'Jetzt kostenlos testen'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-s112-muted mt-6">
          Sie haben schon ein Konto? <a href="/login" className="text-s112-blue-700 hover:underline">Hier anmelden</a>
        </p>
      </div>
    </div>
  )
}
