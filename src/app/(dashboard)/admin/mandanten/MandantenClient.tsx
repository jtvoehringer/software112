'use client'

import { useState, useTransition } from 'react'
import { createMandant, renameMandant, saveBranding } from './actions'
import type { MandantRow } from './page'

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

// ── Neuer Mandant ─────────────────────────────────────────────────────────────

function NeuMandantForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => { await createMandant(fd); onDone() })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Neuer Mandant</h3>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Name des Betriebs *</label>
        <input name="name" required placeholder="z.B. Weingut Mustermann" className={inputCls()} autoFocus />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird angelegt…' : 'Anlegen'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Branding-Form ─────────────────────────────────────────────────────────────

function BrandingForm({ m, onClose }: { m: MandantRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [newsletter, setNewsletter] = useState(m.modul_newsletter)
  const [primaryColor, setPrimaryColor] = useState(m.primary_color)
  const [secondaryColor, setSecondaryColor] = useState(m.secondary_color)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('modul_newsletter', newsletter ? 'true' : 'false')
    startTransition(async () => {
      await saveBranding(m.id, fd)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 mx-4 mb-3 bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Corporate Design / Branding</h4>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Anzeigename</label>
          <input name="anzeigename" defaultValue={m.anzeigename ?? m.name}
            placeholder={m.name} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Logo-URL</label>
          <input name="logo_url" defaultValue={m.logo_url ?? ''}
            placeholder="/logos/mein-logo.png" className={inputCls()} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Primärfarbe (HEX)</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={primaryColor}
              onChange={e => setPrimaryColor(e.target.value)}
              className="w-8 h-8 rounded border border-s112-border cursor-pointer p-0.5 flex-shrink-0" />
            <input name="primary_color" value={primaryColor}
              onChange={e => setPrimaryColor(e.target.value)}
              placeholder="#2a7c6f"
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sekundärfarbe (HEX)</label>
          <div className="flex gap-2 items-center">
            <input type="color" value={secondaryColor}
              onChange={e => setSecondaryColor(e.target.value)}
              className="w-8 h-8 rounded border border-s112-border cursor-pointer p-0.5 flex-shrink-0" />
            <input name="secondary_color" value={secondaryColor}
              onChange={e => setSecondaryColor(e.target.value)}
              placeholder="#f5c842"
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Module</p>
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            onClick={() => setNewsletter(v => !v)}
            className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${newsletter ? 'bg-s112-teal' : 'bg-gray-300'}`}
          >
            <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${newsletter ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-sm text-gray-700">Newsletter-Modul (Brevo-Integration)</span>
        </label>
      </div>

      <div className="flex gap-2 items-center pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Speichern…' : 'Speichern'}
        </button>
        <button type="button" onClick={onClose}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Schließen
        </button>
        {saved && <span className="text-xs text-s112-teal font-medium">✓ Gespeichert</span>}
      </div>
    </form>
  )
}

// ── Mandant-Zeile ─────────────────────────────────────────────────────────────

function MandantZeile({ m }: { m: MandantRow }) {
  const [editing, setEditing] = useState(false)
  const [showBranding, setShowBranding] = useState(false)
  const [name, setName] = useState(m.name)
  const [pending, startTransition] = useTransition()

  function handleRename(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      await renameMandant(m.id, name)
      setEditing(false)
    })
  }

  return (
    <>
      <tr className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/50 group">
        <td className="px-4 py-3">
          {editing ? (
            <form onSubmit={handleRename} className="flex gap-2 items-center">
              <input value={name} onChange={e => setName(e.target.value)}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-56"
                autoFocus />
              <button type="submit" disabled={pending}
                className="text-xs text-white bg-s112-teal px-3 py-1 rounded-lg disabled:opacity-40">
                {pending ? '…' : 'OK'}
              </button>
              <button type="button" onClick={() => { setEditing(false); setName(m.name) }}
                className="text-xs text-gray-500 hover:text-gray-700">
                Abbrechen
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-900">{m.name}</span>
              {m.anzeigename && m.anzeigename !== m.name && (
                <span className="text-xs text-s112-muted">({m.anzeigename})</span>
              )}
              <button onClick={() => setEditing(true)}
                className="text-xs text-s112-muted hover:text-s112-teal opacity-0 group-hover:opacity-100 transition-opacity px-1">
                ✏
              </button>
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-s112-muted font-mono">{m.id.slice(0, 8)}…</td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
              style={{ background: m.primary_color }} title={m.primary_color} />
            <div className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
              style={{ background: m.secondary_color }} title={m.secondary_color} />
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-s112-muted text-center">{m.benutzer_anzahl}</td>
        <td className="px-4 py-3 text-xs text-s112-muted tabular-nums">
          {new Date(m.erstellt_am).toLocaleDateString('de-AT')}
        </td>
        <td className="px-4 py-3">
          <button
            onClick={() => setShowBranding(v => !v)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              showBranding
                ? 'bg-s112-teal text-white border-s112-teal'
                : 'border-s112-border text-s112-muted hover:text-s112-teal hover:border-s112-teal'
            }`}
          >
            CD ⚙
          </button>
        </td>
      </tr>
      {showBranding && (
        <tr>
          <td colSpan={6} className="p-0">
            <BrandingForm m={m} onClose={() => setShowBranding(false)} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function MandantenClient({ mandanten }: { mandanten: MandantRow[] }) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-4">
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          <span>＋</span> Neuer Mandant
        </button>
      )}

      {showForm && <NeuMandantForm onDone={() => setShowForm(false)} />}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border bg-s112-bg">
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Name</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">ID</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-s112-muted">Farben</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-s112-muted">Benutzer</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-s112-muted">Erstellt</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {mandanten.map(m => <MandantZeile key={m.id} m={m} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
