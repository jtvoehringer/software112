'use client'

// Prozess-Assistent (Bot) – Chat-Widget im Dashboard-Layout.
// Ein-/ausklappbares Chat-Panel, das mit der API-Route /api/assistent/chat
// spricht. Welche Prozesse der Assistent tatsächlich per Tool-Use ausführen
// kann, steuert allein die API-Route/das System-Prompt – an diesem Widget
// muss sich dafür nichts ändern.

import { useEffect, useRef, useState } from 'react'
import { X, Send, Loader2, Mic, Square, Volume2, VolumeX } from 'lucide-react'
import { BotIcon } from './BotIcon'
import { useSpracheingabe, kannVorlesen, vorlesen, vorlesenStoppen } from './useSpracheingabe'
import { fehlerText } from '@/lib/fehler'

// Sprachsteuerung (Rückmeldung 2.9.2026, Paket "Premium: Bot:112 mit
// Sprachsteuerung"): Mikrofon-Button neben dem Eingabefeld (Web Speech API,
// siehe useSpracheingabe.ts) - gesprochener Text wird nach Ende der Äußerung
// automatisch als Nachricht abgeschickt, damit es im Weingarten wirklich
// freihändig geht. Unkritisch, weil der Bot vor jedem Schreibzugriff ohnehin
// eine Zusammenfassung zeigt und auf Bestätigung wartet - ein verhörtes Wort
// lässt sich in der nächsten Nachricht korrigieren, gebucht wird nichts ohne
// ausdrückliches Ja. Optional (Lautsprecher-Symbol im Header, Standard aus):
// Antworten des Bots vorlesen lassen.
const VORLESEN_KEY = 's112_bot_vorlesen'

type Nachricht = { rolle: 'user' | 'assistant'; inhalt: string }

// Prozesse, die bot:112 aktuell wirklich per Tool-Use ausführen kann – bewusst
// als kurze "Themen"-Vorschläge im Startbildschirm, damit klar wird, dass der
// Bot einen konkret durch einen ausgewählten Prozess führt (nicht nur freies
// Q&A ist). Diese Liste bei jeder neuen Phase (Verkauf, Ernte, ...) ergänzen.
const THEMEN: { label: string; nachricht: string }[] = [
  { label: 'Maßnahme dokumentieren', nachricht: 'Ich möchte eine Maßnahme dokumentieren.' },
  { label: 'Verkauf anlegen', nachricht: 'Ich möchte einen Verkauf anlegen.' },
  { label: 'Ernte erfassen', nachricht: 'Ich möchte eine Ernte erfassen.' },
  { label: 'Abfüllen', nachricht: 'Ich möchte eine Charge abfüllen.' },
  { label: 'Verschneiden', nachricht: 'Ich möchte Chargen verschneiden.' },
  { label: 'Umziehen', nachricht: 'Ich möchte eine Charge umziehen.' },
  { label: 'Kellerbehandlung erfassen', nachricht: 'Ich möchte eine Kellerbehandlung erfassen.' },
]

export default function AssistentWidget() {
  const [offen, setOffen]             = useState(false)
  const [nachrichten, setNachrichten] = useState<Nachricht[]>([])
  const [eingabe, setEingabe]         = useState('')
  const [laden, setLaden]             = useState(false)
  const [fehler, setFehler]           = useState<string | null>(null)
  const [unterhaltungId, setUnterhaltungId] = useState<string | undefined>(undefined)
  const listRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [vorlesenAn, setVorlesenAn]   = useState(false)
  const [vorlesenMoeglich, setVorlesenMoeglich] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-Wert (localStorage/URL/Feature) erst nach dem Einhängen lesen – beim Rendern gäbe es einen Hydration-Fehler
    setVorlesenMoeglich(kannVorlesen())
    try { setVorlesenAn(localStorage.getItem(VORLESEN_KEY) === '1') } catch { /* privater Modus o.ä. */ }
  }, [])

  function vorlesenUmschalten() {
    setVorlesenAn(v => {
      const neu = !v
      try { localStorage.setItem(VORLESEN_KEY, neu ? '1' : '0') } catch { /* ignorieren */ }
      if (!neu) vorlesenStoppen()
      return neu
    })
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [nachrichten, laden])

  // Beim Öffnen des Panels direkt ins Eingabefeld fokussieren
  useEffect(() => {
    if (offen) inputRef.current?.focus()
  }, [offen])

  async function senden(e?: React.FormEvent, textOverride?: string) {
    e?.preventDefault()
    const text = (textOverride ?? eingabe).trim()
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
      if (vorlesenAn) vorlesen(String(data.antwort ?? ''))
    } catch (err) {
      setFehler(fehlerText(err))
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

  // Endgültig erkannter Text -> wie eine getippte Nachricht abschicken. (Der
  // Hook hält den Callback in einem Ref, daher kein useCallback nötig.)
  const sprache = useSpracheingabe((text: string) => { void senden(undefined, text) })

  // Beim Schließen des Panels laufende Aufnahme/Vorlesen beenden
  useEffect(() => {
    if (!offen) { sprache.abbrechen(); vorlesenStoppen() }
  }, [offen]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed bottom-5 right-5 max-sm:bottom-20 z-50 print:hidden" data-print="hide">
      {offen && (
        <div className="mb-3 w-[360px] max-w-[92vw] h-[480px] max-h-[75vh] bg-white rounded-xl shadow-xl border border-s112-border flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-s112-teal text-s112-yellow shrink-0">
            <div className="flex items-center gap-2">
              <BotIcon size={18} />
              <span className="font-semibold text-sm">bot:112</span>
            </div>
            <div className="flex items-center gap-3">
              {vorlesenMoeglich && (
                <button
                  onClick={vorlesenUmschalten}
                  aria-pressed={vorlesenAn}
                  aria-label={vorlesenAn ? 'Antworten vorlesen: an' : 'Antworten vorlesen: aus'}
                  title={vorlesenAn ? 'Antworten werden vorgelesen (klicken zum Ausschalten)' : 'Antworten vorlesen lassen'}
                  className={`hover:opacity-75 ${vorlesenAn ? '' : 'opacity-60'}`}
                >
                  {vorlesenAn ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
              )}
              <button onClick={() => setOffen(false)} aria-label="Schließen" className="hover:opacity-75">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Nachrichtenverlauf */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-s112-bg/40">
            {nachrichten.length === 0 && (
              <div className="mt-4 px-2">
                <p className="text-xs text-s112-muted text-center px-2 mb-3">
                  Hallo! Ich nehme dich an die Hand und führe dich Schritt für Schritt durch die
                  Eintragung – wähl ein Thema oder beschreib direkt, was du erledigen möchtest:
                </p>
                <div className="flex flex-col gap-1.5">
                  {THEMEN.map(t => (
                    <button
                      key={t.label}
                      onClick={() => senden(undefined, t.nachricht)}
                      disabled={laden}
                      className="text-left text-sm bg-white border border-s112-border rounded-lg px-3 py-2 hover:border-s112-teal hover:text-s112-blue-700 transition-colors disabled:opacity-40"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {nachrichten.map((n, i) => (
              <div key={i} className={`flex ${n.rolle === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  n.rolle === 'user'
                    ? 'bg-s112-teal text-s112-yellow rounded-br-sm'
                    : 'bg-white border border-s112-border text-s112-text rounded-bl-sm'
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
            {(fehler || sprache.fehler) && (
              <div role="alert" className="bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 text-xs text-s112-err-fg">
                {fehler ?? sprache.fehler}
              </div>
            )}
          </div>

          {/* Eingabe */}
          <form onSubmit={senden} className="flex items-center gap-2 p-2.5 border-t border-s112-border shrink-0 bg-white">
            <input
              ref={inputRef}
              value={sprache.hoert ? sprache.zwischenstand : eingabe}
              onChange={e => setEingabe(e.target.value)}
              readOnly={sprache.hoert}
              placeholder={sprache.hoert ? 'Ich höre zu…' : 'Nachricht…'}
              className={`flex-1 min-w-0 border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 ${
                sprache.hoert ? 'border-s112-err/30 bg-s112-err-bg/40 italic text-s112-text-2' : 'border-s112-border'
              }`}
            />
            {sprache.unterstuetzt && (
              <button
                type="button"
                onClick={() => (sprache.hoert ? sprache.stop() : sprache.start())}
                disabled={laden}
                aria-pressed={sprache.hoert}
                aria-label={sprache.hoert ? 'Aufnahme beenden' : 'Sprechen'}
                title={sprache.hoert ? 'Aufnahme beenden' : 'Sprechen statt tippen'}
                className={`p-2 rounded-lg shrink-0 transition-colors disabled:opacity-40 ${
                  sprache.hoert
                    ? 'bg-s112-err text-white animate-pulse'
                    : 'border border-s112-border text-s112-text-2 hover:border-s112-teal hover:text-s112-blue-700'
                }`}
              >
                {sprache.hoert ? <Square size={16} /> : <Mic size={16} />}
              </button>
            )}
            <button
              type="submit"
              disabled={laden || !eingabe.trim()}
              aria-label="Senden"
              className="bg-s112-teal text-s112-yellow p-2 rounded-lg hover:bg-s112-teal/90 disabled:opacity-40 shrink-0"
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
        className="w-14 h-14 rounded-full bg-s112-teal text-s112-yellow shadow-lg flex items-center justify-center hover:bg-s112-teal/90 transition-colors ml-auto"
      >
        {offen ? <X size={22} /> : <BotIcon size={22} />}
      </button>
    </div>
  )
}
