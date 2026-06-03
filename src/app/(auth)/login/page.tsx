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
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-s112-teal inline-flex items-baseline gap-0">
          software
          <span className="text-s112-yellow">:</span>
          112
        </h1>
        <p className="text-s112-muted text-sm mt-1">Digitale Klarheit für den Weinbau</p>
      </div>

      {/* Card */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-6">Anmelden</h2>

        <form onSubmit={handleLogin} autoComplete="on" className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
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
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
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
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2"
          >
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
          <div className="text-center mt-3">
            <a href="/login/reset" className="text-xs text-s112-teal hover:underline">
              Passwort vergessen?
            </a>
          </div>
        </form>
      </div>

      <p className="text-center text-xs text-s112-muted mt-6">
        software:112 · IC&P Consultants e.U.
      </p>
      <p className="text-center text-[10px] text-gray-400 mt-1">v2.1.0 · Juni 2026</p>
    </div>
  )
}
