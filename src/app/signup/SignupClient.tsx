'use client'

// ── Self-Service-Signup: öffentliches Formular ────────────────────────────────
// Rückmeldung 31.8.2026: Betriebsname, Ansprechperson, Zugangsdaten + Plan-Wahl
// in einem Schritt, danach direkt weiter zum Stripe-Checkout (Karte + 14 Tage
// Testphase). Stil/Layout analog (auth)/login/page.tsx bzw. abo/AboClient.tsx.

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
  const [passwort, setPasswort] = useState('')
  const [passwort2, setPasswort2] = useState('')
  // Vorbelegt: Standard (mittleres Paket), sonst das erste verfügbare
  const [paket, setPaket]       = useState<PaketKey | ''>(
    PAKET_OPTIONEN.some(p => p.key === 'standard') ? 'standard' : (PAKET_OPTIONEN[0]?.key ?? ''),
  )
  const [zustimmung, setZustimmung] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (passwort !== passwort2) { setError('Die Passwörter stimmen nicht überein.'); return }
    if (!zustimmung) { setError('Bitte AGB und Datenschutzerklärung bestätigen.'); return }
    if (!paket) { setError('Bitte ein Paket auswählen.'); return }

    setLoading(true)
    const fd = new FormData()
    fd.set('betrieb', betrieb)
    fd.set('name', name)
    fd.set('email', email)
    fd.set('passwort', passwort)
    fd.set('paket', paket)

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

            {PAKET_OPTIONEN.length > 0 && (
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1.5">Paket</span>
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
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="font-semibold text-gray-800">{p.label}</p>
                      <p className="text-s112-teal font-medium">{preisText(p)}</p>
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
