'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SearchResult } from '@/app/api/global-search/route'

const KATEGORIE_LABEL: Record<string, string> = {
  kontakt:   '👤 Kontakt',
  firma:     '🏢 Firma',
  fuellung:  '🍾 Füllung',
  verkauf:   '🧾 Rechnung',
  kellerbuch:'🍷 Kellerbuch',
}

const KATEGORIE_FARBE: Record<string, string> = {
  kontakt:   'bg-blue-50 text-blue-700',
  firma:     'bg-violet-50 text-violet-700',
  fuellung:  'bg-emerald-50 text-emerald-700',
  verkauf:   'bg-amber-50 text-amber-700',
  kellerbuch:'bg-red-50 text-red-700',
}

export default function GlobalSearch() {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor]   = useState(0)

  const inputRef    = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router      = useRouter()

  // ── Tastenkürzel ⌘K / Strg+K ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Fokus wenn geöffnet
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // ── Suche (debounced) ────────────────────────────────────────────────────
  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/global-search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.results ?? [])
        setCursor(0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 220)
  }, [])

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    search(v)
  }

  // ── Tastaturnavigation ───────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && results[cursor]) {
      navigate(results[cursor])
    }
  }

  const navigate = (r: SearchResult) => {
    setOpen(false)
    router.push(r.href)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg
          bg-s112-bg border border-s112-border text-s112-muted text-sm
          hover:border-s112-teal/50 hover:text-s112-teal transition-colors
          lg:min-w-[180px]"
        title="Suche öffnen (⌘K)"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="hidden lg:block flex-1 text-left">Suche…</span>
        <kbd className="hidden lg:block text-[10px] font-mono bg-white border border-s112-border px-1 rounded">⌘K</kbd>
      </button>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed left-1/2 top-20 z-50 w-full max-w-xl -translate-x-1/2 px-4">
        <div className="bg-white rounded-2xl shadow-2xl border border-s112-border overflow-hidden">

          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-s112-border">
            <svg className="w-5 h-5 text-s112-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Kontakt, Rechnung, Wein suchen…"
              className="flex-1 outline-none text-sm text-gray-800 placeholder:text-s112-muted bg-transparent"
            />
            {loading && (
              <svg className="w-4 h-4 text-s112-muted animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <kbd className="text-[10px] font-mono text-s112-muted bg-s112-bg border border-s112-border px-1.5 py-0.5 rounded">
              Esc
            </kbd>
          </div>

          {/* Ergebnisse */}
          {results.length > 0 && (
            <ul className="max-h-80 overflow-y-auto py-2">
              {results.map((r, i) => (
                <li key={r.id + r.kategorie}>
                  <button
                    className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors
                      ${i === cursor ? 'bg-s112-teal/8' : 'hover:bg-s112-bg'}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => navigate(r)}
                  >
                    <span className={`mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap
                      ${KATEGORIE_FARBE[r.kategorie] ?? 'bg-gray-100 text-gray-600'}`}>
                      {KATEGORIE_LABEL[r.kategorie] ?? r.kategorie}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.titel}</p>
                      {r.untertitel && (
                        <p className="text-xs text-s112-muted truncate">{r.untertitel}</p>
                      )}
                    </div>
                    {i === cursor && (
                      <svg className="ml-auto w-4 h-4 text-s112-teal flex-shrink-0 mt-0.5"
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Leer-Zustand */}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-s112-muted">
              Keine Ergebnisse für „{query}"
            </div>
          )}

          {/* Hinweis wenn noch nicht gesucht */}
          {query.length < 2 && (
            <div className="px-4 py-3 text-xs text-s112-muted flex items-center gap-4">
              <span>
                <kbd className="font-mono bg-s112-bg border border-s112-border px-1 rounded">↑↓</kbd>
                {' '}navigieren
              </span>
              <span>
                <kbd className="font-mono bg-s112-bg border border-s112-border px-1 rounded">↵</kbd>
                {' '}öffnen
              </span>
              <span>
                <kbd className="font-mono bg-s112-bg border border-s112-border px-1 rounded">Esc</kbd>
                {' '}schließen
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
