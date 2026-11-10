'use client'

import { useEffect, useState } from 'react'
import { APP_VERSION } from '@/lib/version'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { mitWeiter } from '@/lib/tenant/waechter'
import { abmeldeHinweis } from '@/lib/auth/sitzung'
import { sitzungsCookieSchreiben } from '@/lib/auth/sitzungCookie'
import { PASSKEY_START_PFAD, passkeyAutomatisch, passkeyFehlerText, passkeyMoeglich } from '@/lib/auth/passkey'
import { subdomainAusHost, subdomainUrl } from '@/lib/tenant/subdomain'
import { authFehlerText } from '@/lib/auth/authFehler'
import Kreisel from '@/components/ui/Kreisel'
import RechtsLinks from '@/components/RechtsLinks'

// Hinweis: metadata muss in Server Components definiert werden.
// Login-Page-Titel wird über das Root-Layout gesetzt.


export default function LoginPage() {
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
    setPasskey({ moeglich: passkeyMoeglich(), basisLogin: sub ? subdomainUrl(null, PASSKEY_START_PFAD) : null })
  }, [])

  /**
   * Nach erfolgreicher Anmeldung (Passwort oder Passkey): Sitzungs-Cookie (KAN-286) und weiter (KAN-78).
   * KAN-399: eine Navigation statt router.push + router.refresh (zwei Server-Renderings) und direkt zu /auth/betrieb –
   * der Handler wählt bei einem Betrieb selbst, sonst die Betriebsauswahl; ein zweiter Faktor folgt am Ziel (Proxy).
   */
  const angemeldet = () => {
    sitzungsCookieSchreiben()
    window.location.assign(mitWeiter('/auth/betrieb', new URLSearchParams(window.location.search).get('weiter')))
  }

  // UAT 23.10.2026: Während Fingerabdruck/Gesicht und der Weiterleitung danach zeigt der Passkey-Knopf einen Kreisel
  // („Anmeldung läuft…“); nach Erfolg bleibt er stehen, bis die nächste Seite da ist – sonst sah man nicht, dass etwas passiert.
  const [passkeyLaeuft, setPasskeyLaeuft] = useState(false)
  // automatisch = KAN-399: Start nach dem Sprung von der Subdomain; scheitert er (manche Browser verlangen einen Klick),
  // bleibt die Seite ohne Fehlermeldung stehen und der Knopf funktioniert wie gewohnt
  const mitPasskey = async (automatisch = false) => {
    if (passkey.basisLogin) { window.location.href = passkey.basisLogin; return }
    setLoading(true); setPasskeyLaeuft(true); setError(null)
    let erfolg = false
    try {
      const { error } = await supabase.auth.signInWithPasskey()
      if (error) { if (!automatisch) setError(passkeyFehlerText(error)); return }
      erfolg = true
      angemeldet()
    } catch (e) { if (!automatisch) setError(passkeyFehlerText(e)) }
    finally { if (!erfolg) { setLoading(false); setPasskeyLaeuft(false) } }
  }

  // KAN-399: von der Betriebs-Subdomain kommend (?passkey=1) den Passkey gleich starten – kein zweiter Klick
  const [autoGestartet, setAutoGestartet] = useState(false)
  useEffect(() => {
    if (autoGestartet || !passkey.moeglich || passkey.basisLogin) return
    if (!passkeyAutomatisch(window.location.search)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmaliger Start nach dem Laden
    setAutoGestartet(true)
    void mitPasskey(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passkey, autoGestartet])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      setError(null)

      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        setError(authFehlerText(error))   // Sweep 100: auch Sperrzeit, nicht bestätigte E-Mail …
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
        <h1 className="text-lg font-semibold text-s112-text mb-6">Anmelden</h1>

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
            <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
          >
            {loading && !passkeyLaeuft && <Kreisel aufKnopf />}
            {loading && !passkeyLaeuft ? 'Anmelden…' : 'Anmelden'}
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
            <button type="button" onClick={() => void mitPasskey()} disabled={loading} aria-busy={passkeyLaeuft}
              className={`w-full py-2 rounded-lg text-sm font-semibold border border-s112-line-str text-s112-text-1 hover:bg-s112-bg flex items-center justify-center gap-2 ${passkeyLaeuft ? '' : 'disabled:opacity-40'}`}>
              {passkeyLaeuft && <Kreisel />}
              {passkeyLaeuft ? 'Anmeldung läuft… (Fingerabdruck bzw. Gesicht bestätigen)' : 'Mit Passkey anmelden (Fingerabdruck, Gesicht, Windows Hello)'}
            </button>
            <p role="status" className="sr-only">{passkeyLaeuft ? 'Anmeldung mit Passkey läuft' : ''}</p>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-s112-muted mt-6">
        software:112 · IC&P Consultants e.U.
      </p>
      <p className="text-center text-[11px] text-s112-tertiary mt-1">
        {APP_VERSION} · <RechtsLinks />
      </p>
    </div>
  )
}
