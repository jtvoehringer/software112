'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PASSWORT_MIN, pruefePasswort, passwortFehlerText } from '@/lib/auth/passwort'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return }
    { const f = pruefePasswort(password); if (f) { setError(f); return } }
    setLoading(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(passwortFehlerText(error)); setLoading(false) }
    else { router.push('/dashboard'); router.refresh() }
  }

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
        <p className="text-sm text-s112-muted mb-4">Lege ein sicheres Passwort fest um dich kuenftig einloggen zu koennen.</p>
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
          {error && <p className="text-s112-err-fg text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Speichern…' : 'Passwort speichern'}
          </button>
        </form>
      </div>
    </div>
  )
}
