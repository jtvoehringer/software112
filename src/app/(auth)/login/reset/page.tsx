'use client'
import { useState } from 'react'
import Link from '@/components/ui/Link'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Mail } from 'lucide-react'

export default function ResetPage() {
  const supabase = createSupabaseBrowserClient()
  const [email, setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true);
    try { setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password&type=recovery`,
    })
    if (error) { setError(error.message); setLoading(false) }
    else setDone(true)

    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold text-s112-blue-700 inline-flex items-baseline gap-0">
          software<span className="text-s112-yellow">:</span>112
        </h1>
        <p className="text-s112-muted text-sm mt-1">Passwort zurücksetzen</p>
      </div>
      <div className="card">
        {done ? (
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <Mail className="w-6 h-6 text-s112-blue-700" aria-hidden="true" />
            </div>
            <p className="font-semibold text-s112-text">E-Mail gesendet!</p>
            <p className="text-sm text-s112-muted">
              Wir haben eine E-Mail an <strong>{email}</strong> geschickt. Klicke auf den Link um ein neues Passwort zu setzen.
            </p>
            <Link href="/login" className="text-sm text-s112-blue-700 hover:underline block mt-4">
              ← Zurück zum Login
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-s112-text mb-2">Passwort vergessen?</h2>
            <p className="text-sm text-s112-muted mb-5">
              Gib deine E-Mail-Adresse ein – wir schicken dir einen Link zum Zurücksetzen.
            </p>
            <form onSubmit={handleReset} className="space-y-4">
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoComplete="email" placeholder="deine@email.at"
                className="input w-full" />
              {error && <p className="text-s112-err-fg text-sm">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Senden…' : 'Reset-Link senden'}
              </button>
            </form>
            <Link href="/login" className="text-xs text-s112-muted hover:text-s112-text-1 block text-center mt-4">
              ← Zurück zum Login
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
