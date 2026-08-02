'use client'
import { useState, useEffect } from 'react'
import { CheckCircle2, TrendingUp } from 'lucide-react'

type ReleaseNote = {
  id: string; version: string; titel: string
  features: string[] | null; fixes: string[] | null
  veroeffentlicht_am: string
}

export default function ReleaseNotesModal() {
  const [note, setNote] = useState<ReleaseNote | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/release-notes').then(r => r.json()).then(d => {
      if (d.note) { setNote(d.note); setOpen(true) }
    })
  }, [])

  async function schliessen() {
    if (!note) return
    setOpen(false)
    await fetch('/api/release-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ release_note_id: note.id }),
    })
  }

  if (!open || !note) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-s112-teal rounded-t-2xl px-6 py-5">
          <p className="text-s112-yellow text-xs font-medium mb-1">software:112 · Version {note.version}</p>
          <h2 className="text-white text-xl font-bold">{note.titel}</h2>
          <p className="text-s112-yellow/80 text-xs mt-1">
            {new Date(note.veroeffentlicht_am).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          <p className="text-sm text-gray-600">
            Sehr geehrte Damen und Herren,<br />
            software:112 wurde um neue Funktionen erweitert und bestehende Fehler wurden behoben.
          </p>

          {/* Neue Funktionen */}
          {note.features && note.features.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
                <span className="w-5 h-5 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs"><CheckCircle2 size={12} /></span>
                Neue Funktionen
              </h3>
              <ul className="space-y-1.5">
                {note.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-s112-teal mt-0.5 flex-shrink-0">›</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verbesserungen */}
          {note.fixes && note.fixes.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
                <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs"><TrendingUp size={12} /></span>
                Verbesserungen
              </h3>
              <ul className="space-y-1.5">
                {note.fixes.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-blue-500 mt-0.5 flex-shrink-0">›</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-s112-border pt-4">
            <p className="text-sm text-gray-600">Mit freundlichen Grüßen</p>
            <p className="text-sm font-semibold text-gray-800 mt-1">Hohenstein Consulting OG</p>
          </div>

          <button onClick={schliessen}
            className="w-full bg-s112-teal text-white py-2.5 rounded-xl font-semibold hover:bg-opacity-90 text-sm">
            Verstanden – Los geht's!
          </button>
        </div>
      </div>
    </div>
  )
}
