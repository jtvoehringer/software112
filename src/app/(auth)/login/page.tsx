'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { mitWeiter } from '@/lib/tenant/waechter'
import { abmeldeHinweis } from '@/lib/auth/sitzung'
import { sitzungsCookieSchreiben } from '@/lib/auth/sitzungCookie'
import { passkeyFehlerText, passkeyMoeglich } from '@/lib/auth/passkey'
import { subdomainAusHost, subdomainUrl } from '@/lib/tenant/subdomain'

// Hinweis: metadata muss in Server Components definiert werden.
// Login-Page-Titel wird über das Root-Layout gesetzt.

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  // KAN-286: Grund der Abmeldung (Inaktivität, Browser geschlossen) – erst nach dem Laden lesen (kein Hydration-Unterschied)
  const [hinweis, setHinweis]   = useState<string | null>(null)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Grund aus der Adresse nach dem Laden übernehmen
  useEffect(() => { setHinweis(abmeldeHinweis(new URLSearchParams(window.location.search).get('grund'))) }, [])
  // KAN-287: Passkey-Anmeldung nur auf der Basis-Adresse (eine Origin je Hauptdomain in Supabase, nicht je Betrieb);
  // auf einer Betriebs-Subdomain führt der Knopf zur Anmeldung auf der Basis – das Anmelde-Cookie gilt dort für alle
  // Subdomains (KAN-31)
  const [passkey, setPasskey]   = useState<{ moeglich: boolean; basisLogin: string | null }>({ moeglich: false, basisLogin: null })
  useEffect(() => {
    const sub = subdomainAusHost(window.location.host)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-Fähigkeit und Adresse erst nach dem Laden prüfen
    setPasskey({ moeglich: passkeyMoeglich(), basisLogin: sub ? subdomainUrl(null, '/login') : null })
  }, [])

  /** Nach erfolgreicher Anmeldung (Passwort oder Passkey): Sitzungs-Cookie (KAN-286) und weiter (KAN-78) */
  const angemeldet = () => {
    sitzungsCookieSchreiben()
    router.push(mitWeiter('/betrieb-waehlen', new URLSearchParams(window.location.search).get('weiter')))
    router.refresh()
  }

  const mitPasskey = async () => {
    if (passkey.basisLogin) { window.location.href = passkey.basisLogin; return }
    setLoading(true); setError(null)
    try {
      const { error } = await supabase.auth.signInWithPasskey()
      if (error) { setError(passkeyFehlerText(error)); return }
      angemeldet()
    } catch (e) { setError(passkeyFehlerText(e)) }
    finally { setLoading(false) }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      setError(null)

      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        setError(
          error.message === 'Invalid login credentials'
            ? 'E-Mail oder Passwort falsch.'
            : error.message
        )
        setLoading(false)
      } else {
        // KAN-78: Ziel aus dem Link (weiter) über Zwei-Faktor und Betriebswahl mitnehmen
        angemeldet()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/software112-logo.svg" alt="software:112" className="h-12 w-auto mx-auto" />
        <p className="text-s112-muted text-sm mt-2">Digitale Klarheit für den Weinbau</p>
      </div>

      {/* Card */}
      <div className="card">
        <h2 className="text-lg font-semibold text-s112-text mb-6">Anmelden</h2>

        {hinweis && <p role="status" className="mb-4 text-sm bg-s112-warn-bg text-s112-warn-fg px-3 py-2 rounded-lg">{hinweis}</p>}
        <form onSubmit={handleLogin} autoComplete="on" className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-s112-text-1 mb-1">
              E-Mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="input"
              placeholder="joerg@weingut.at"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-s112-text-1 mb-1">
              Passwort
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="input"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
          >
            {loading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
          <div className="text-center mt-3">
            <a href="/login/reset" className="text-xs text-s112-blue-700 hover:underline">
              Passwort vergessen?
            </a>
          </div>
        </form>
        {/* KAN-287: Anmeldung per Passkey (Fingerabdruck, Gesicht, Windows Hello) – eingerichtet im Profil */}
        {passkey.moeglich && (
          <div className="mt-4 pt-4 border-t border-s112-line">
            <button type="button" onClick={mitPasskey} disabled={loading}
              className="w-full py-2 rounded-lg text-sm font-semibold border border-s112-line-str text-s112-text-1 hover:bg-s112-bg disabled:opacity-40">
              Mit Passkey anmelden (Fingerabdruck, Gesicht, Windows Hello)
            </button>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-s112-muted mt-6">
        software:112 · IC&P Consultants e.U.
      </p>
      <p className="text-center text-[11px] text-s112-tertiary mt-1">
        v2.1.0 · Juni 2026 · <a href="/barrierefreiheit" className="hover:underline">Barrierefreiheit</a>
      </p>
    </div>
  )
}
