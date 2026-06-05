'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ProfilPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [telefon, setTelefon]   = useState('')
  const [email, setEmail]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [erfolg, setErfolg]     = useState(false)
  const [laden, setLaden]       = useState(true)

  useEffect(() => {
    fetch('/api/profil').then(r => r.json()).then(d => {
      setFullName(d.profil?.full_name ?? '')
      setTelefon(d.profil?.telefon   ?? '')
      // Email aus Supabase Auth
      fetch('/api/auth/me').then(r => r.json()).then(u => setEmail(u.email ?? '')).catch(() => {})
      setLaden(false)
    })
  }, [])

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/profil', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, telefon }),
    })
    setErfolg(true); setSaving(false)
    setTimeout(() => setErfolg(false), 3000)
    router.refresh()
  }

  if (laden) return <div className="p-8 text-s112-muted text-sm">Laden…</div>

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Mein Profil</h1>
      <div className="bg-white rounded-2xl border border-s112-border p-6">
        <form onSubmit={speichern} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail (nicht änderbar)</label>
            <input value={email} disabled className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm bg-s112-bg text-s112-muted" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vollständiger Name</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Vorname Nachname"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefon</label>
            <input value={telefon} onChange={e => setTelefon(e.target.value)} placeholder="+43 664 …"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
              {saving ? 'Speichern…' : 'Profil speichern'}
            </button>
            {erfolg && <p className="text-sm text-green-600">✓ Gespeichert</p>}
          </div>
        </form>
      </div>
    </div>
  )
}
