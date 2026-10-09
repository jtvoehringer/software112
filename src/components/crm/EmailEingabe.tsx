'use client'

import { useEffect, useRef, useState } from 'react'

// Empfängerfeld mit Vervollständigung aus dem CRM (18.9.2026): mehrere
// Adressen mit Komma; für das zuletzt getippte Fragment (ab 2 Zeichen) werden
// Kontakte/Firmen nach Name oder Adresse gesucht (/api/crm/suche?art=email,
// Standard- und weitere Adressen). Auswahl ersetzt das Fragment durch die
// Adresse und hängt ", " an.
type Treffer = { id: string; label: string; sub?: string }

export default function EmailEingabe({ value, onChange, placeholder, required, className, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; className?: string; autoFocus?: boolean
}) {
  const [treffer, setTreffer] = useState<Treffer[]>([])
  const [open, setOpen]       = useState(false)
  const [aktiv, setAktiv]     = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const teile = value.split(',')
  const fragment = teile[teile.length - 1].trim()

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Laden/Abonnieren im Effekt: Lade- bzw. Startzustand setzen, Ergebnis kommt asynchron
    if (fragment.length < 2) { setTreffer([]); setOpen(false); return }
    let aktivFlag = true
    const t = setTimeout(() => {
      fetch(`/api/crm/suche?art=email&q=${encodeURIComponent(fragment)}`)
        .then(r => r.json())
        .then(d => { if (aktivFlag) { setTreffer(d.treffer ?? []); setAktiv(0); setOpen((d.treffer ?? []).length > 0) } })
        .catch(() => { if (aktivFlag) setTreffer([]) })
    }, 200)
    return () => { aktivFlag = false; clearTimeout(t) }
  }, [fragment])

  function waehle(t: Treffer) {
    const vorne = teile.slice(0, -1).map(x => x.trim()).filter(Boolean)
    onChange([...vorne, t.id].join(', ') + ', ')
    setOpen(false); setTreffer([])
  }

  return (
    <div ref={ref} className="relative">
      <input value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder}
        autoFocus={autoFocus} autoComplete="off"
        onFocus={() => { if (treffer.length) setOpen(true) }}
        onKeyDown={e => {
          if (!open || !treffer.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setAktiv(a => Math.min(treffer.length - 1, a + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAktiv(a => Math.max(0, a - 1)) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); waehle(treffer[aktiv]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        className={className} />
      {open && treffer.length > 0 && (
        <ul className="absolute z-40 left-0 right-0 mt-1 bg-white border border-s112-border rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {treffer.map((t, i) => (
            <li key={t.id} onMouseDown={e => { e.preventDefault(); waehle(t) }} onMouseEnter={() => setAktiv(i)}
              className={`px-3 py-2 cursor-pointer flex items-center justify-between gap-3 ${i === aktiv ? 'bg-s112-blue-50' : 'hover:bg-s112-bg'}`}>
              <span className="text-sm font-medium text-s112-text truncate">{t.label}</span>
              <span className="text-xs text-s112-muted truncate">{t.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
