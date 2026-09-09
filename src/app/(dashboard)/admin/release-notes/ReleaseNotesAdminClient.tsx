'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// readOnly=true für die Sandbox-Sonderfreigabe (siehe isSandboxAdminUnlock in
// lib/auth/roles.ts, geprüft in page.tsx): "Release Notes" werden GLOBAL an
// ALLE Kunden beim nächsten Login ausgespielt (siehe ReleaseNotesModal.tsx) -
// das ist nie sandbox-lokal, deshalb dürfen die beiden dort freigeschalteten
// E-Mails hier nur lesen, nie veröffentlichen oder (de)aktivieren.
export default function ReleaseNotesAdminClient({ readOnly = false }: { readOnly?: boolean }) {
  const s = createSupabaseBrowserClient()
  const [version, setVersion] = useState('')
  const [titel, setTitel]     = useState('')
  const [features, setFeatures] = useState('')
  const [fixes, setFixes]       = useState('')
  const [saving, setSaving]   = useState(false)
  const [erfolg, setErfolg]   = useState(false)
  const [notes, setNotes]     = useState<R[]>([])

  const laden = async () => {
    const { data } = await (s.from('release_notes') as any).select('*').order('erstellt_am', { ascending: false }).limit(10)
    setNotes(data ?? [])
  }
  useEffect(() => { laden() }, [])

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly) return
    setSaving(true)
    await (s.from('release_notes') as any).insert({
      version, titel,
      features: features.split('\n').map((l:string)=>l.trim()).filter(Boolean),
      fixes: fixes.split('\n').map((l:string)=>l.trim()).filter(Boolean),
    })
    setVersion(''); setTitel(''); setFeatures(''); setFixes('')
    setErfolg(true); setSaving(false); laden()
    setTimeout(() => setErfolg(false), 3000)
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Release Notes verwalten</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text">Release Notes verwalten</h1>
      {readOnly && (
        <div className="p-3 bg-s112-warn-bg border border-s112-warn/30 rounded-xl text-sm text-s112-warn-fg">
          Nur lesbar in der Sandbox: Release Notes werden global an alle Kunden ausgespielt, deshalb kein Veröffentlichen/Aktivieren hier möglich.
        </div>
      )}
      {!readOnly && (
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <h2 className="font-semibold text-s112-text mb-4">Neue Release Note</h2>
          <form onSubmit={speichern} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Version</label>
                <input value={version} onChange={e=>setVersion(e.target.value)} placeholder="2.2.0" required
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" /></div>
              <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Titel</label>
                <input value={titel} onChange={e=>setTitel(e.target.value)} placeholder="Juni Update 2026" required
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" /></div>
            </div>
            <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Neue Funktionen (eine pro Zeile)</label>
              <textarea value={features} onChange={e=>setFeatures(e.target.value)} rows={4} placeholder="Visitkarten-Scanner&#10;Profilsystem&#10;Release Notes"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" /></div>
            <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Verbesserungen (eine pro Zeile)</label>
              <textarea value={fixes} onChange={e=>setFixes(e.target.value)} rows={3} placeholder="E-Mail-Löschen funktioniert jetzt zuverlässig"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" /></div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={saving} className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
                {saving ? 'Speichern…' : 'Veröffentlichen'}</button>
              {erfolg && <p className="text-sm text-s112-ok-fg">Veröffentlicht</p>}
            </div>
          </form>
        </div>
      )}
      <div className="bg-white rounded-xl border border-s112-border p-5">
        <h2 className="font-semibold text-s112-text mb-3">Bisherige Release Notes</h2>
        {notes.map((n:R) => (
          <div key={n.id} className="flex items-center justify-between py-2 border-b border-s112-border/40 last:border-0">
            <div><span className="text-sm font-medium">v{n.version}</span> <span className="text-sm text-s112-muted ml-2">{n.titel}</span></div>
            <div className="flex gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${n.aktiv?'bg-s112-ok-bg text-s112-ok-fg':'bg-[#F2F3F5] text-s112-text-2'}`}>{n.aktiv?'Aktiv':'Inaktiv'}</span>
              {!readOnly && (
                <button onClick={async()=>{await (s.from('release_notes') as any).update({aktiv:!n.aktiv}).eq('id',n.id);laden()}}
                  className="text-xs text-s112-muted hover:text-s112-text-1">{n.aktiv?'Deaktivieren':'Aktivieren'}</button>
              )}
            </div>
          </div>
        ))}
        {notes.length===0 && <p className="text-xs text-s112-muted">Noch keine Release Notes</p>}
      </div>
    </div>
  )
}
