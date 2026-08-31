'use client'

// ── Self-Service-Signup: öffentliches Formular ────────────────────────────────
// Rückmeldung 31.8.2026: Betriebsname, Ansprechperson, Zugangsdaten + Plan-Wahl
// in einem Schritt, danach direkt weiter zum Stripe-Checkout (Karte + 14 Tage
// Testphase). Stil/Layout analog (auth)/login/page.tsx bzw. abo/AboClient.tsx.

import { useState } from 'react'
import { registrierenAction } from './actions'

const PLAN_OPTIONEN = [
  { id: process.env.NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL      ?? '', label: 'Professional',  preis: '299 €/Monat', hinweis: 'KI-Abfragen Basic' },
  { id: process.env.NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL_PLUS ?? '', label: 'Professional+', preis: '349 €/Monat', hinweis: 'KI-Abfragen Standard' },
  { id: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE        ?? '', label: 'Enterprise',    preis: '399 €/Monat', hinweis: 'KI-Abfragen Unlimited' },
].filter(p => p.id)

export default function SignupClient() {
  const [betrieb, setBetrieb]   = useState('')
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [passwort, setPasswort] = useState('')
  const [passwort2, setPasswort2] = useState('')
  const [priceId, setPriceId]   = useState(PLAN_OPTIONEN[0]?.id ?? '')
  const [zustimmung, setZustimmung] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (passwort !== passwort2) { setError('Die Passwörter stimmen nicht überein.'); return }
    if (!zustimmung) { setError('Bitte AGB und Datenschutzerklärung bestätigen.'); return }
    if (!priceId) { setError('Bitte einen Plan auswählen.'); return }

    setLoading(true)
    const fd = new FormData()
    fd.set('betrieb', betrieb)
    fd.set('name', name)
    fd.set('email', email)
    fd.set('passwort', passwort)
    fd.set('priceId', priceId)

    const res = await registrierenAction(fd)
    if (!res.ok) {
      setError(res.fehler)
      setLoading(false)
      return
    }
    window.location.href = res.url
  }

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-s112-teal inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">14 Tage kostenlos testen – digitale Klarheit für den Weinbau</p>
        </div>

        <div className="card space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="betrieb" className="block text-sm font-medium text-gray-700 mb-1">Name Ihres Betriebs</label>
              <input id="betrieb" type="text" required className="input" placeholder="Weingut Musterhof"
                value={betrieb} onChange={e => setBetrieb(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Ihr Name</label>
                <input id="name" type="text" required className="input" placeholder="Maria Musterfrau"
                  value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
                <input id="email" type="email" required autoComplete="username" className="input" placeholder="maria@weingut.at"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="passwort" className="block text-sm font-medium text-gray-700 mb-1">Passwort</label>
                <input id="passwort" type="password" required minLength={8} autoComplete="new-password" className="input" placeholder="mind. 8 Zeichen"
                  value={passwort} onChange={e => setPasswort(e.target.value)} />
              </div>
              <div>
                <label htmlFor="passwort2" className="block text-sm font-medium text-gray-700 mb-1">Passwort wiederholen</label>
                <input id="passwort2" type="password" required autoComplete="new-password" className="input" placeholder="mind. 8 Zeichen"
                  value={passwort2} onChange={e => setPasswort2(e.target.value)} />
              </div>
            </div>

            {PLAN_OPTIONEN.length > 0 && (
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1.5">Plan</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PLAN_OPTIONEN.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPriceId(p.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                        priceId === p.id
                          ? 'border-s112-teal bg-s112-teal/5 ring-1 ring-s112-teal'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="font-semibold text-gray-800">{p.label}</p>
                      <p className="text-s112-teal font-medium">{p.preis}</p>
                      <p className="text-[11.5px] text-s112-muted mt-0.5">{p.hinweis}</p>
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
                Ich habe die <a href="/agb" target="_blank" className="text-s112-teal hover:underline">AGB</a> und{' '}
                <a href="/datenschutz" target="_blank" className="text-s112-teal hover:underline">Datenschutzerklärung</a> gelesen und stimme zu.
              </span>
            </label>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? 'Konto wird angelegt …' : 'Jetzt kostenlos testen'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-s112-muted mt-6">
          Sie haben schon ein Konto? <a href="/login" className="text-s112-teal hover:underline">Hier anmelden</a>
        </p>
      </div>
    </div>
  )
}
