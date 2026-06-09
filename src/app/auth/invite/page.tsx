'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

function InviteContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [hasHash, setHasHash] = useState(false)

  const code = searchParams.get('code')

  useEffect(() => {
    // Supabase kann Token entweder als ?code= oder als #access_token= übergeben
    const hash = window.location.hash
    if (hash && hash.includes('access_token')) {
      setHasHash(true)
    }
    setReady(true)
  }, [])

  async function annehmen() {
    setLoading(true); setError(null)
    const supabase = createSupabaseBrowserClient()

    if (code) {
      // PKCE Flow: code gegen Session tauschen
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) { setError('Link ungültig oder abgelaufen. Bitte um neue Einladung.'); setLoading(false); return }
    } else if (hasHash) {
      // Implicit Flow: Hash enthält access_token – Supabase erkennt das automatisch
      const hash = window.location.hash.slice(1)
      const params = new URLSearchParams(hash)
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token') ?? ''
      if (!access_token) { setError('Token nicht gefunden.'); setLoading(false); return }
      const { error } = await supabase.auth.setSession({ access_token, refresh_token })
      if (error) { setError('Session konnte nicht gesetzt werden.'); setLoading(false); return }
    } else {
      setError('Kein gültiger Token gefunden.'); setLoading(false); return
    }

    router.push('/auth/update-password')
  }

  const isValid = code || hasHash

  if (!ready) return <div className="bg-white rounded-2xl border border-s112-border p-8 text-center text-s112-muted text-sm">Laden…</div>

  return (
    <div className="bg-white rounded-2xl border border-s112-border p-8 text-center space-y-4">
      <p className="text-2xl">👋</p>
      <h2 className="text-lg font-semibold text-gray-800">Willkommen!</h2>
      <p className="text-sm text-s112-muted">
        Du wurdest zu software:112 eingeladen. Klicke unten um dein Passwort festzulegen.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!isValid && !error && <p className="text-sm text-red-600">Ungültiger Einladungslink.</p>}
      {isValid && (
        <button onClick={annehmen} disabled={loading}
          className="w-full bg-s112-teal text-white px-6 py-3 rounded-xl font-semibold hover:bg-opacity-90 disabled:opacity-40">
          {loading ? 'Wird verarbeitet…' : 'Einladung annehmen & Passwort setzen'}
        </button>
      )}
    </div>
  )
}

export default function InviteLandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-s112-teal inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">Einladung annehmen</p>
        </div>
        <Suspense fallback={<div className="bg-white rounded-2xl border border-s112-border p-8 text-center text-s112-muted text-sm">Laden…</div>}>
          <InviteContent />
        </Suspense>
      </div>
    </div>
  )
}
