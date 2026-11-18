'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { PASSWORT_MIN, pruefePasswort, passwortFehlerText } from '@/lib/auth/passwort'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { authLinkAus, fremdeSitzungText, linkFehlerText, type AuthLink } from '@/lib/auth/authLink'
import { fehlerText } from '@/lib/fehler'
import { passwortFestgelegt } from './actions'

// KAN-465 (Befund 16.11.2026): Passwort festlegen – nach Einladung oder „Passwort vergessen“.
//   - Kommt die Seite mit einem Link aus der E-Mail (?token_hash=…&type=recovery bzw. bisher ?code=…), wird er erst mit
//     dem Knopf eingelöst: Der Link geht in jedem Fenster, ein Vorab-Abruf durch das Mailprogramm verbraucht nichts.
//   - Ist in diesem Browser ein anderes Konto angemeldet, steht das da; beim Fortfahren wird es abgemeldet. Nie still
//     das Passwort des gerade angemeldeten Kontos ändern, wenn der Link für ein anderes Konto gedacht war.
//   - Ohne Link und ohne Sitzung: Meldung mit Ausweg statt eines Formulars, das beim Speichern scheitert.
type Stand = 'laden' | 'link' | 'formular' | 'fehler'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [stand, setStand]       = useState<Stand>('laden')
  const [link, setLink]         = useState<AuthLink>({ art: 'keiner' })
  const [konto, setKonto]       = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    const l = authLinkAus(window.location.search, window.location.hash)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-Wert (URL) erst nach dem Einhängen lesen
    setLink(l)
    supabase.auth.getUser().then(({ data }) => {
      const mail = data.user?.email ?? null
      setKonto(mail)
      if (l.art === 'fehler') { setError(linkFehlerText('passwort', l.code ?? l.beschreibung)); setStand('fehler') }
      else if (l.art === 'token_hash' || l.art === 'code' || l.art === 'hash') setStand('link')
      else if (mail) setStand('formular')
      else { setError('Du bist nicht angemeldet. Bitte den Link aus der E-Mail öffnen oder unten einen neuen anfordern.'); setStand('fehler') }
    }).catch(() => { setError('Die Anmeldung konnte nicht geprüft werden. Bitte die Seite neu laden.'); setStand('fehler') })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- einmal beim Einhängen: Adresse und Sitzung lesen
  }, [])

  /** Link aus der E-Mail einlösen (erst hier, nicht beim Abruf der Seite) */
  async function einloesen() {
    if (link.art !== 'token_hash' && link.art !== 'code' && link.art !== 'hash') return
    setLoading(true)
    setError(null)
    try {
      if (konto) await supabase.auth.signOut({ scope: 'local' })   // andere Sitzung beenden – der Link gilt für das Konto der E-Mail
      const { data, error } = link.art === 'token_hash'
        ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.typ })
        : link.art === 'code'
          ? await supabase.auth.exchangeCodeForSession(link.code)
          : await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
      if (error) { setError(linkFehlerText('passwort', error.code ?? error.message)); setStand('fehler'); return }
      setKonto(data.user?.email ?? null)
      // Link aus der Adresse nehmen: ein Neuladen soll ihn nicht noch einmal einlösen wollen
      window.history.replaceState(null, '', '/auth/update-password')
      setStand('formular')
    } catch (e) {
      setError(fehlerText(e, 'Der Link konnte nicht eingelöst werden. Bitte noch einmal versuchen.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return }
    { const f = pruefePasswort(password); if (f) { setError(f); return } }
    setLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setError(passwortFehlerText(error)); return }
      // Kennzeichen „Passwort noch nicht festgelegt“ der Benutzerverwaltung löschen – scheitert das, ist das Passwort
      // trotzdem gesetzt; der Hinweis in der Benutzerverwaltung bliebe nur stehen
      try {
        const gemerkt = await passwortFestgelegt()
        if (!gemerkt.ok) console.warn('Kennzeichen „Passwort offen“ konnte nicht gelöscht werden – das Passwort ist gespeichert.')
      } catch { /* das Passwort ist gespeichert; nur der Hinweis in der Benutzerverwaltung bliebe stehen */ }
      router.push('/dashboard')
      router.refresh()
    } catch (e2) {
      setError(fehlerText(e2))
    } finally {
      setLoading(false)
    }
  }

  const fremd = stand === 'link' ? fremdeSitzungText(konto) : null

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold text-s112-blue-700 inline-flex items-baseline gap-0">
          software<span className="text-s112-yellow">:</span>112
        </h1>
        <p className="text-s112-muted text-sm mt-1">Passwort festlegen</p>
      </div>
      <div className="card">
        <h2 className="text-lg font-semibold text-s112-text mb-2">Passwort festlegen</h2>
        {stand === 'laden' && <p className="text-sm text-s112-muted">Laden…</p>}

        {stand === 'link' && (
          <div className="space-y-4">
            <p className="text-sm text-s112-muted">Klicke auf „Weiter“, um ein neues Passwort für dein Konto festzulegen.</p>
            {fremd && <p role="status" className="text-sm text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2">{fremd}</p>}
            {error && <p role="alert" className="text-s112-err-fg text-sm">{error}</p>}
            <button type="button" onClick={einloesen} disabled={loading} className="btn-primary w-full">
              {loading ? 'Wird geprüft…' : 'Weiter'}
            </button>
          </div>
        )}

        {stand === 'fehler' && (
          <div className="space-y-3">
            {error && <p role="alert" className="text-s112-err-fg text-sm">{error}</p>}
            {konto && <p className="text-xs text-s112-text-2">In diesem Browser angemeldet: {konto}. Das Passwort dieses Kontos wurde nicht geändert.</p>}
            <Link href="/login/reset" className="btn-primary w-full block text-center">Neuen Link anfordern</Link>
            <Link href={konto ? '/dashboard' : '/login'} className="block text-center text-sm text-s112-blue-700 hover:underline">
              {konto ? 'Zum Dashboard' : 'Zur Anmeldung'}
            </Link>
          </div>
        )}

        {stand === 'formular' && (
          <>
            <p className="text-sm text-s112-muted mb-4">
              Lege ein sicheres Passwort fest, um dich künftig anmelden zu können.
              {konto && <span className="block mt-1 text-s112-text-1">Konto: <strong>{konto}</strong></span>}
            </p>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-s112-text-1 mb-1">Neues Passwort</label>
                <input aria-label="Neues Passwort" type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required autoComplete="new-password" minLength={PASSWORT_MIN} placeholder={`Min. ${PASSWORT_MIN} Zeichen, Buchstaben und Ziffern`}
                  className="input w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-s112-text-1 mb-1">Bestätigen</label>
                <input aria-label="Bestätigen" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  required autoComplete="new-password" placeholder="Passwort wiederholen"
                  className="input w-full" />
              </div>
              {error && <p role="alert" className="text-s112-err-fg text-sm">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Speichern…' : 'Passwort speichern'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
