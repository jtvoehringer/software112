'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function InviteLandingPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const code = searchParams.get('code')
  const type = searchParams.get('type')

  // Seite zeigen – User muss aktiv klicken (verhindert Safe-Link-Pre-Scan-Problem)
  async function annehmen() {
    if (!code) return
    setLoading(true); setError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      setError('Link ungültig oder abgelaufen. Bitte Administrator um eine neue Einladung.')
      setLoading(false); return
    }
    router.push('/auth/update-password')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-s112-teal inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">Einladung annehmen</p>
        </div>
        <div className="bg-white rounded-2xl border border-s112-border p-8 text-center space-y-4">
          <p className="text-2xl">👋</p>
          <h2 className="text-lg font-semibold text-gray-800">Willkommen!</h2>
          <p className="text-sm text-s112-muted">
            Du wurdest zu software:112 eingeladen. Klicke unten um dein Passwort festzulegen.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!code && <p className="text-sm text-red-600">Ungültiger Einladungslink.</p>}
          {code && (
            <button onClick={annehmen} disabled={loading}
              className="w-full bg-s112-teal text-white px-6 py-3 rounded-xl font-semibold hover:bg-opacity-90 disabled:opacity-40">
              {loading ? 'Wird verarbeitet…' : 'Einladung annehmen & Passwort setzen'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
