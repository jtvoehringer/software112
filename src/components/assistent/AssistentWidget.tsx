'use client'

// Prozess-Assistent (Bot) – Chat-Widget im Dashboard-Layout.
// Ein-/ausklappbares Chat-Panel, das mit der API-Route /api/assistent/chat
// spricht. Welche Prozesse der Assistent tatsächlich per Tool-Use ausführen
// kann, steuert allein die API-Route/das System-Prompt – an diesem Widget
// muss sich dafür nichts ändern.

import { useEffect, useRef, useState } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import { BotIcon } from './BotIcon'

type Nachricht = { rolle: 'user' | 'assistant'; inhalt: string }

export default function AssistentWidget() {
  const [offen, setOffen]             = useState(false)
  const [nachrichten, setNachrichten] = useState<Nachricht[]>([])
  const [eingabe, setEingabe]         = useState('')
  const [laden, setLaden]             = useState(false)
  const [fehler, setFehler]           = useState<string | null>(null)
  const [unterhaltungId, setUnterhaltungId] = useState<string | undefined>(undefined)
  const listRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [nachrichten, laden])

  // Beim Öffnen des Panels direkt ins Eingabefeld fokussieren
  useEffect(() => {
    if (offen) inputRef.current?.focus()
  }, [offen])

  async function senden(e?: React.FormEvent) {
    e?.preventDefault()
    const text = eingabe.trim()
    if (!text || laden) return
    setEingabe('')
    setFehler(null)
    setNachrichten(prev => [...prev, { rolle: 'user', inhalt: text }])
    setLaden(true)
    try {
      const res = await fetch('/api/assistent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nachricht: text, unterhaltungId }),
      })
      const data = await res.json()
      if (!res.ok || data.fehler) {
        setFehler(data.fehler ?? 'Unbekannter Fehler')
        return
      }
      setUnterhaltungId(data.unterhaltungId)
      setNachrichten(prev => [...prev, { rolle: 'assistant', inhalt: data.antwort }])
    } catch (err) {
      setFehler(String(err))
    } finally {
      setLaden(false)
      // Eingabefeld bleibt absichtlich WÄHREND des Ladens aktiv nutzbar (siehe
      // input unten, kein disabled={laden}) – ein disabled-Input verliert beim
      // Deaktivieren automatisch den Fokus, das war der Grund, warum man nach
      // jeder gesendeten Nachricht wieder manuell reinklicken musste. Zusätzlich
      // hier nochmal sicherheitshalber fokussieren, falls der Fokus zwischenzeitlich
      // (z.B. durch einen Klick auf den Senden-Button) verloren ging.
      inputRef.current?.focus()
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {offen && (
        <div className="mb-3 w-[360px] max-w-[92vw] h-[480px] max-h-[75vh] bg-white rounded-2xl shadow-xl border border-s112-border flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-s112-teal text-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <BotIcon size={18} />
              <span className="font-semibold text-sm">bot:112</span>
            </div>
            <button onClick={() => setOffen(false)} aria-label="Schließen" className="hover:opacity-75">
              <X size={18} />
            </button>
          </div>

          {/* Nachrichtenverlauf */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-s112-bg/40">
            {nachrichten.length === 0 && (
              <p className="text-xs text-s112-muted text-center mt-6 px-4">
                Hallo! Stell mir eine Frage oder beschreib, was du eintragen möchtest.
              </p>
            )}
            {nachrichten.map((n, i) => (
              <div key={i} className={`flex ${n.rolle === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  n.rolle === 'user'
                    ? 'bg-s112-teal text-white rounded-br-sm'
                    : 'bg-white border border-s112-border text-gray-800 rounded-bl-sm'
                }`}>
                  {n.inhalt}
                </div>
              </div>
            ))}
            {laden && (
              <div className="flex justify-start">
                <div className="bg-white border border-s112-border rounded-xl rounded-bl-sm px-3 py-2 text-sm text-s112-muted flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> tippt…
                </div>
              </div>
            )}
            {fehler && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                {fehler}
              </div>
            )}
          </div>

          {/* Eingabe */}
          <form onSubmit={senden} className="flex items-center gap-2 p-2.5 border-t border-s112-border flex-shrink-0 bg-white">
            <input
              ref={inputRef}
              value={eingabe}
              onChange={e => setEingabe(e.target.value)}
              placeholder="Nachricht…"
              className="flex-1 border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
            />
            <button
              type="submit"
              disabled={laden || !eingabe.trim()}
              aria-label="Senden"
              className="bg-s112-teal text-white p-2 rounded-lg hover:bg-opacity-90 disabled:opacity-40 flex-shrink-0"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      {/* Toggle-Button */}
      <button
        onClick={() => setOffen(v => !v)}
        aria-label={offen ? 'Assistent schließen' : 'Assistent öffnen'}
        className="w-14 h-14 rounded-full bg-s112-teal text-white shadow-lg flex items-center justify-center hover:bg-opacity-90 transition-colors ml-auto"
      >
        {offen ? <X size={22} /> : <BotIcon size={22} />}
      </button>
    </div>
  )
}
