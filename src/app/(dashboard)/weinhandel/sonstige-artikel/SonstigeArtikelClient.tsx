'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { upsertSonstigesArtikel, toggleAktivSonstigesArtikel, deleteSonstigesArtikel } from './actions'
import { useRouter } from 'next/navigation'
import { fmtEur } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'

interface Artikel {
  id: string
  name: string
  einheit: string
  default_preis: number | null
  aktiv: boolean
  erstellt_am: string
}

const inputCls = 'border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'

function ArtikelRow({ artikel, onRefresh }: { artikel: Artikel; onRefresh: () => void }) {
  const [editing, setEditing]       = useState(false)
  const [name, setName]             = useState(artikel.name)
  const [einheit, setEinheit]       = useState(artikel.einheit)
  const [preis, setPreis]           = useState(artikel.default_preis != null ? String(artikel.default_preis) : '')
  const [isPending, startTransition] = useTransition()
  const [error, setError]           = useState<string | null>(null)

  function handleSave() {
    setError(null)
    const fd = new FormData()
    fd.set('id',            artikel.id)
    fd.set('name',          name)
    fd.set('einheit',       einheit)
    fd.set('default_preis', preis)
    startTransition(async () => {
      try {
        await upsertSonstigesArtikel(fd)
        setEditing(false)
        onRefresh()
      } catch (e) {
        setError(fehlerText(e, 'Fehler'))
      }
    })
  }

  function handleToggle() {
    startTransition(async () => {
      await toggleAktivSonstigesArtikel(artikel.id, !artikel.aktiv)
      onRefresh()
    })
  }

  function handleDelete() {
    if (!confirm(`"${artikel.name}" wirklich löschen?`)) return
    setError(null)
    startTransition(async () => {
      const result = await deleteSonstigesArtikel(artikel.id)
      if (result?.error) setError(result.error)
      else onRefresh()
    })
  }

  if (editing) {
    return (
      <tr className="bg-s112-teal/5">
        <td className="px-3 py-2">
          <input value={name} onChange={e => setName(e.target.value)}
            className={inputCls + ' w-full'} autoFocus />
          {error && <p className="text-xs text-s112-err mt-1">{error}</p>}
        </td>
        <td className="px-3 py-2">
          <select value={einheit} onChange={e => setEinheit(e.target.value)}
            className={inputCls}>
            <option>Stk</option>
            <option>L</option>
            <option>Karton</option>
            <option>Flasche</option>
            <option>Pauschal</option>
            <option>kg</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <input type="number" value={preis} onChange={e => setPreis(e.target.value)}
            step="0.01" min="0" placeholder="–"
            className={inputCls + ' w-24 text-right'} />
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)}
              className="text-xs text-s112-muted hover:text-s112-text-2 px-2 py-1 rounded-sm">
              Abbrechen
            </button>
            <button onClick={handleSave} disabled={isPending}
              className="text-xs bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg hover:bg-s112-teal/90 disabled:opacity-50">
              {isPending ? '…' : 'Speichern'}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className={!artikel.aktiv ? 'opacity-40' : 'hover:bg-s112-bg/50 transition-colors'}>
      <td className="px-3 py-2.5 text-sm text-s112-text font-medium">
        {artikel.name}
        {error && <p className="text-xs text-s112-err mt-1 font-normal">{error}</p>}
      </td>
      <td className="px-3 py-2.5 text-sm text-s112-muted">{artikel.einheit}</td>
      <td className="px-3 py-2.5 text-sm text-right tabular-nums text-s112-text-1">
        {artikel.default_preis != null
          ? fmtEur(Number(artikel.default_preis))
          : <span className="text-s112-muted">–</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex gap-1 justify-end items-center">
          <button onClick={() => setEditing(true)}
            title="Bearbeiten"
            className="text-xs text-s112-muted hover:text-s112-blue-700 px-2 py-1 rounded-sm hover:bg-s112-teal/10">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleToggle} disabled={isPending}
            title={artikel.aktiv ? 'Deaktivieren' : 'Aktivieren'}
            className="text-xs text-s112-muted hover:text-s112-text-2 px-2 py-1 rounded-sm hover:bg-[#F2F3F5]">
            {artikel.aktiv ? 'Deaktivieren' : 'Aktivieren'}
          </button>
          <button onClick={handleDelete} disabled={isPending}
            title="Löschen"
            className="text-xs text-s112-err hover:text-s112-err-fg px-2 py-1 rounded-sm hover:bg-s112-err-bg">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

function NeuerArtikelRow({ onRefresh, onCancel }: { onRefresh: () => void; onCancel: () => void }) {
  const [name,   setName]   = useState('')
  const [einheit, setEinheit] = useState('Stk')
  const [preis,  setPreis]  = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)

  function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Name darf nicht leer sein'); return }
    const fd = new FormData()
    fd.set('id',            '')
    fd.set('name',          name)
    fd.set('einheit',       einheit)
    fd.set('default_preis', preis)
    startTransition(async () => {
      try {
        await upsertSonstigesArtikel(fd)
        onRefresh()
        onCancel()
      } catch (e) {
        setError(fehlerText(e, 'Fehler'))
      }
    })
  }

  return (
    <tr className="bg-s112-ok-bg">
      <td className="px-3 py-2">
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Produktname *" className={inputCls + ' w-full'} autoFocus />
        {error && <p className="text-xs text-s112-err mt-1">{error}</p>}
      </td>
      <td className="px-3 py-2">
        <select value={einheit} onChange={e => setEinheit(e.target.value)}
          className={inputCls}>
          <option>Stk</option>
          <option>L</option>
          <option>Karton</option>
          <option>Flasche</option>
          <option>Pauschal</option>
          <option>kg</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input type="number" value={preis} onChange={e => setPreis(e.target.value)}
          step="0.01" min="0" placeholder="–"
          className={inputCls + ' w-24 text-right'} />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="text-xs text-s112-muted hover:text-s112-text-2 px-2 py-1 rounded-sm">
            Abbrechen
          </button>
          <button onClick={handleSave} disabled={isPending}
            className="text-xs bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg hover:opacity-90 disabled:opacity-50">
            {isPending ? '…' : '+ Anlegen'}
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function SonstigeArtikelClient({ initialArtikel }: { initialArtikel: Artikel[] }) {
  const router = useRouter()
  const [showNeu, setShowNeu] = useState(false)

  function refresh() { router.refresh() }

  const aktive    = initialArtikel.filter(a => a.aktiv)
  const inaktive  = initialArtikel.filter(a => !a.aktiv)
  const sorted    = [...aktive, ...inaktive]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowNeu(true)}
          disabled={showNeu}
          className="text-sm bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl font-semibold hover:bg-s112-teal/90 disabled:opacity-40 transition-colors"
        >
          + Neues Produkt
        </button>
      </div>

      <div className="card overflow-hidden">
        {sorted.length === 0 && !showNeu ? (
          <div className="px-6 py-10 text-center text-sm text-s112-muted">
            <p className="font-medium">Noch keine Sonstiges-Produkte angelegt</p>
            <p className="mt-1">Klicke auf „+ Neues Produkt" um zu starten.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg text-left">
                <th className="px-3 py-2.5 text-xs font-semibold text-s112-text-2">Name</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-s112-text-2">Einheit</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-s112-text-2 text-right">Standardpreis</th>
                <th className="px-3 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border">
              {showNeu && (
                <NeuerArtikelRow
                  onRefresh={refresh}
                  onCancel={() => setShowNeu(false)}
                />
              )}
              {sorted.map(a => (
                <ArtikelRow key={a.id} artikel={a} onRefresh={refresh} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {inaktive.length > 0 && (
        <p className="text-xs text-s112-muted text-right">
          {inaktive.length} deaktiviert{inaktive.length === 1 ? 'es' : 'e'} Produkt{inaktive.length > 1 ? 'e' : ''} (ausgegraut)
        </p>
      )}
    </div>
  )
}
