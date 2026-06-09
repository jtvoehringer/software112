'use client'

import { useState, useTransition } from 'react'
import { upsertSonstigesArtikel, toggleAktivSonstigesArtikel } from './actions'
import { useRouter } from 'next/navigation'

interface Artikel {
  id: string
  name: string
  einheit: string
  default_preis: number | null
  aktiv: boolean
  erstellt_am: string
}

const inputCls = 'border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'

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
        setError(e instanceof Error ? e.message : 'Fehler')
      }
    })
  }

  function handleToggle() {
    startTransition(async () => {
      await toggleAktivSonstigesArtikel(artikel.id, !artikel.aktiv)
      onRefresh()
    })
  }

  if (editing) {
    return (
      <tr className="bg-s112-teal/5">
        <td className="px-3 py-2">
          <input value={name} onChange={e => setName(e.target.value)}
            className={inputCls + ' w-full'} autoFocus />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
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
              className="text-xs text-s112-muted hover:text-gray-600 px-2 py-1 rounded">
              Abbrechen
            </button>
            <button onClick={handleSave} disabled={isPending}
              className="text-xs bg-s112-teal text-white px-3 py-1 rounded-lg hover:bg-opacity-90 disabled:opacity-50">
              {isPending ? '…' : '✓ Speichern'}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className={!artikel.aktiv ? 'opacity-40' : 'hover:bg-s112-bg/50 transition-colors'}>
      <td className="px-3 py-2.5 text-sm text-gray-800 font-medium">{artikel.name}</td>
      <td className="px-3 py-2.5 text-sm text-s112-muted">{artikel.einheit}</td>
      <td className="px-3 py-2.5 text-sm text-right tabular-nums text-gray-700">
        {artikel.default_preis != null
          ? Number(artikel.default_preis).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
          : <span className="text-s112-muted">–</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex gap-1 justify-end items-center">
          <button onClick={() => setEditing(true)}
            title="Bearbeiten"
            className="text-xs text-s112-muted hover:text-s112-teal px-2 py-1 rounded hover:bg-s112-teal/10">
            ✏️
          </button>
          <button onClick={handleToggle} disabled={isPending}
            title={artikel.aktiv ? 'Deaktivieren' : 'Aktivieren'}
            className="text-xs text-s112-muted hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">
            {artikel.aktiv ? '🔕' : '✅'}
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
        setError(e instanceof Error ? e.message : 'Fehler')
      }
    })
  }

  return (
    <tr className="bg-green-50">
      <td className="px-3 py-2">
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Produktname *" className={inputCls + ' w-full'} autoFocus />
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
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
            className="text-xs text-s112-muted hover:text-gray-600 px-2 py-1 rounded">
            Abbrechen
          </button>
          <button onClick={handleSave} disabled={isPending}
            className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50">
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
          className="text-sm bg-s112-teal text-white px-4 py-2 rounded-xl font-semibold hover:bg-opacity-90 disabled:opacity-40 transition-colors"
        >
          + Neues Produkt
        </button>
      </div>

      <div className="card overflow-hidden">
        {sorted.length === 0 && !showNeu ? (
          <div className="px-6 py-10 text-center text-sm text-s112-muted">
            <p className="text-2xl mb-2">🏷️</p>
            <p className="font-medium">Noch keine Sonstiges-Produkte angelegt</p>
            <p className="mt-1">Klicke auf „+ Neues Produkt" um zu starten.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg text-left">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500">Name</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500">Einheit</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 text-right">Standardpreis</th>
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
          🔕 {inaktive.length} deaktiviert{inaktive.length === 1 ? 'es' : 'e'} Produkt{inaktive.length > 1 ? 'e' : ''} (ausgegraut)
        </p>
      )}
    </div>
  )
}
