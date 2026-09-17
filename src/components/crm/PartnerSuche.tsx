'use client'

import { useEffect, useRef, useState } from 'react'

// Serverseitige Kunden-/Lieferanten-/Kontaktsuche (Typeahead) für Formulare
// (17.9.2026). Ersetzt das Laden aller Kontakte/Firmen in den Browser
// (Gebeshuber: 8.300 + 4.600 Datensätze bei jedem „Neuer Verkauf“): tippen →
// /api/crm/suche liefert bis 30 Treffer samt Verkaufskonditionen (daten), die
// der Aufrufer über onChange(id, treffer) direkt übernimmt.
//
//   art      'kunde' | 'lieferant' → Kontakte + Firmen, id "kontakt:<id>" / "firma:<id>"
//            'kontakt' | 'firma'   → nur eine Tabelle, id = Datensatz-ID
//   firmaId  (art='kontakt') Ansprechpersonen dieser Firma; hat sie keine,
//            werden alle Kontakte angeboten und ein Hinweis gezeigt.

export type PartnerTreffer = {
  id: string; label: string; sub?: string
  daten?: { typ: 'kontakt' | 'firma'; firma_id: string | null; rabatt_pct: number | null; sonderrabatt_pct: number; skonto_pct: number; skonto_tage: number }
}

const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'

export default function PartnerSuche({ art, firmaId, value, onChange, placeholder, disabled }: {
  art: 'kunde' | 'lieferant' | 'kontakt' | 'firma'
  firmaId?: string | null
  value: string
  onChange: (id: string, treffer: PartnerTreffer | null) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const [treffer, setTreffer]   = useState<PartnerTreffer[]>([])
  const [alle, setAlle]         = useState(false)
  const [laden, setLaden]       = useState(false)
  const [gewaehlt, setGewaehlt] = useState<PartnerTreffer | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const selected = value && gewaehlt?.id === value ? gewaehlt : null

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Suche (entprellt), sobald die Liste offen ist - auch ohne Eingabe (erste 30)
  useEffect(() => {
    if (!open) return
    let aktiv = true
    setLaden(true)
    const t = setTimeout(() => {
      const p = new URLSearchParams({ art, q: query })
      if (firmaId) p.set('firma_id', firmaId)
      fetch(`/api/crm/suche?${p}`)
        .then(r => r.json())
        .then(d => { if (aktiv) { setTreffer(d.treffer ?? []); setAlle(!!d.alle) } })
        .catch(() => { if (aktiv) setTreffer([]) })
        .finally(() => { if (aktiv) setLaden(false) })
    }, 200)
    return () => { aktiv = false; clearTimeout(t) }
  }, [art, firmaId, query, open])

  // Vorbelegter Wert ohne bekanntes Label (z.B. aus URL) → Namen nachladen
  useEffect(() => {
    if (!value || selected) return
    const p = new URLSearchParams({ art, ids: value })
    fetch(`/api/crm/suche?${p}`)
      .then(r => r.json())
      .then(d => { const t = (d.treffer ?? [])[0] as PartnerTreffer | undefined; if (t) setGewaehlt(t) })
      .catch(() => {})
  }, [art, value, selected])

  if (value) {
    return (
      <div className="flex items-center gap-2 border border-s112-border rounded-lg px-3 py-2 bg-white text-sm">
        <span className="flex-1 truncate font-medium text-s112-text">{selected?.label ?? '…'}</span>
        {selected?.sub && <span className="text-xs text-s112-muted truncate">{selected.sub}</span>}
        {!disabled && (
          <button type="button" onClick={() => { onChange('', null); setGewaehlt(null); setQuery('') }}
            className="text-s112-muted hover:text-s112-err ml-1 flex-shrink-0 text-base leading-none">×</button>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Suchen…'}
        disabled={disabled}
        className={inputCls + ' w-full pr-8'}
        autoComplete="off"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-s112-muted text-xs pointer-events-none">▾</span>
      {open && treffer.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-s112-border rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {alle && firmaId && (
            <p className="px-3 py-1.5 text-xs text-s112-warn-fg border-b border-s112-border">ℹ Noch kein Kontakt dieser Firma zugeordnet – alle Kontakte werden angezeigt.</p>
          )}
          {treffer.map(item => (
            <button key={item.id} type="button"
              onMouseDown={() => { setGewaehlt(item); onChange(item.id, item); setQuery(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-s112-teal/10 flex items-center justify-between gap-2">
              <span className="font-medium text-s112-text truncate">{item.label}</span>
              {item.sub && <span className="text-xs text-s112-muted flex-shrink-0">{item.sub}</span>}
            </button>
          ))}
          {treffer.length >= 30 && (
            <p className="px-3 py-1.5 text-xs text-s112-muted border-t border-s112-border">Weitere Treffer – bitte genauer eingeben.</p>
          )}
        </div>
      )}
      {open && !laden && query.length > 0 && treffer.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-s112-border rounded-xl shadow-lg px-3 py-2 text-sm text-s112-muted">
          Kein Treffer für „{query}“
        </div>
      )}
    </div>
  )
}
