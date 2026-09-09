'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Metadata } from 'next'

// Hinweis: metadata muss in Server Components definiert werden.
// Login-Page-Titel wird über das Root-Layout gesetzt.

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
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
      router.push('/betrieb-waehlen')
      router.refresh()
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
      </div>

      <p className="text-center text-xs text-s112-muted mt-6">
        software:112 · IC&P Consultants e.U.
      </p>
      <p className="text-center text-[10px] text-s112-tertiary mt-1">v2.1.0 · Juni 2026</p>
    </div>
  )
}
