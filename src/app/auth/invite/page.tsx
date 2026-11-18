'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { UserPlus } from 'lucide-react'
import { authLinkAus, fremdeSitzungText, linkFehlerText, linkFehltText, type AuthLink } from '@/lib/auth/authLink'
import { fehlerText } from '@/lib/fehler'

// KAN-465 (Befund 16.11.2026): Der Einladungslink wird erst mit dem Knopf auf dieser Seite eingelöst. Mit den neuen
// E-Mail-Vorlagen (?token_hash=…&type=invite) verbraucht ein Vorab-Abruf durch Mailprogramm oder Virenscanner nichts,
// und ein zweimal geöffneter Link bleibt nutzbar, bis er eingelöst ist. Die bisherigen Links (?code=… bzw.
// #access_token=…) gehen weiter. Ist der Link verbraucht oder abgelaufen, steht hier, was zu tun ist – mit Ausweg.
function InviteContent() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<AuthLink | null>(null)
  const [angemeldetAls, setAngemeldetAls] = useState<string | null>(null)

  useEffect(() => {
    // Abfrage und Fragment der Adresse gibt es erst im Browser (beim Rendern gäbe es einen Hydration-Fehler)
    const l = authLinkAus(window.location.search, window.location.hash)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-Wert (URL) erst nach dem Einhängen lesen
    setLink(l)
    if (l.art === 'fehler') setError(linkFehlerText('einladung', l.code ?? l.beschreibung))
    // Ist in diesem Browser schon jemand angemeldet? Dann vor dem Einlösen sagen, wer – nie still in fremder Sitzung weiter
    createSupabaseBrowserClient().auth.getUser().then(({ data }) => setAngemeldetAls(data.user?.email ?? null)).catch(() => setAngemeldetAls(null))
  }, [])

  async function annehmen() {
    if (!link || link.art === 'fehler' || link.art === 'keiner') return
    setLoading(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      // andere Sitzung in diesem Browser beenden – der Link gilt für das Konto, an das die E-Mail ging
      if (angemeldetAls) await supabase.auth.signOut({ scope: 'local' })
      if (link.art === 'token_hash') {
        const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.typ })
        if (error) { setError(linkFehlerText('einladung', error.code ?? error.message)); return }
      } else if (link.art === 'code') {
        // bisheriger Weg (PKCE): Code gegen Sitzung tauschen
        const { error } = await supabase.auth.exchangeCodeForSession(link.code)
        if (error) { setError(linkFehlerText('einladung', error.code ?? error.message)); return }
      } else {
        // bisheriger Weg: Sitzung im Fragment der Adresse
        const { error } = await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        if (error) { setError(linkFehlerText('einladung', error.code ?? error.message)); return }
      }
      router.push('/auth/update-password')
    } catch (e) {
      setError(fehlerText(e, 'Der Einladungslink konnte nicht eingelöst werden. Bitte noch einmal versuchen.'))
    } finally {
      setLoading(false)
    }
  }

  if (!link) return <div className="bg-white rounded-xl border border-s112-border p-8 text-center text-s112-muted text-sm">Laden…</div>

  const einloesbar = link.art === 'token_hash' || link.art === 'code' || link.art === 'hash'
  const meldung = error ?? (link.art === 'keiner' ? linkFehltText('einladung') : null)
  const fremd = einloesbar ? fremdeSitzungText(angemeldetAls) : null

  return (
    <div className="bg-white rounded-xl border border-s112-border p-8 text-center space-y-4">
      <div className="flex justify-center">
        <UserPlus className="w-6 h-6 text-s112-blue-700" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-s112-text">Willkommen!</h2>
      {einloesbar && !error && (
        <p className="text-sm text-s112-muted">
          Du wurdest zu software:112 eingeladen oder hast deinen Betrieb registriert. Klicke unten, um dein Konto zu aktivieren und dein Passwort festzulegen.
        </p>
      )}
      {fremd && !error && <p role="status" className="text-sm text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2 text-left">{fremd}</p>}
      {meldung && <p role="alert" className="text-sm text-s112-err-fg text-left">{meldung}</p>}
      {einloesbar && !error && (
        <button onClick={annehmen} disabled={loading}
          className="w-full bg-s112-teal text-s112-yellow px-6 py-3 rounded-xl font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
          {loading ? 'Wird verarbeitet…' : 'Konto aktivieren & Passwort festlegen'}
        </button>
      )}
      {/* Ausweg, wenn der Link nicht (mehr) geht: Konto ist meist schon aktiviert – Passwort-Link anfordern */}
      {meldung && (
        <div className="space-y-2">
          <Link href="/login/reset" className="block w-full bg-s112-teal text-s112-yellow px-6 py-3 rounded-xl font-semibold hover:bg-s112-teal/90">
            Link zum Festlegen des Passworts anfordern
          </Link>
          <Link href="/login" className="block text-sm text-s112-blue-700 hover:underline">Zur Anmeldung</Link>
        </div>
      )}
    </div>
  )
}

export default function InviteLandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-s112-bg">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-s112-blue-700 inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">Konto aktivieren</p>
        </div>
        <Suspense fallback={<div className="bg-white rounded-xl border border-s112-border p-8 text-center text-s112-muted text-sm">Laden…</div>}>
          <InviteContent />
        </Suspense>
      </div>
    </div>
  )
}
