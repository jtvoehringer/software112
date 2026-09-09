'use client'

import { useState, useEffect, useRef } from 'react'
import { Sparkles, PanelRightClose, ArrowUp } from 'lucide-react'

// ── Assistent-Panel — Phase D des Design-Relaunch (UI-Hülle) ──────────────────
// Dies ist bewusst NUR die Panel-Hülle mit Platzhalter-Verhalten (statische
// Beispielantworten, 700ms Verzögerung wie im Design-Prototyp) — siehe
// project_design_relaunch.md Phase D. Die echte Tool-Use-Logik (Anthropic Claude,
// echte Betriebsdaten, ausführbare Aktionen) folgt dem Bot-Phasenplan in
// project_prozess_assistent_bot.md (Phase 0 dort = Grundgerüst für diese Hülle).
//
// Default-Zustand ist EINGEKLAPPT (siehe INITIAL_OPEN unten): das Panel kann aktuell
// nur 4 Beispielfragen sinnvoll beantworten, alles andere bekommt die Fallback-Antwort.
// Um es standardmäßig geöffnet auszuliefern (wie im Referenz-Screenshot), INITIAL_OPEN
// auf true setzen — sinnvoll, sobald echte Antworten dahinterstehen.

const INITIAL_OPEN = false
const STORAGE_KEY = 's112_assistant_open'

type Message = { id: string; role: 'user' | 'assistant'; text: string; actions?: string[] }

const CHIPS = ['Wer ist überfällig?', 'Bestand Grüner Veltliner', 'Umsatz Juli', 'Offene Lieferscheine']

const CANNED: Record<string, { text: string; actions?: string[] }> = {
  'wer ist überfällig?': {
    text: 'Drei Rechnungen sind aktuell überfällig, insgesamt € 18.640. Am längsten offen: Weingut Steinberg GmbH.',
    actions: ['Mahnlauf starten', 'Liste öffnen'],
  },
  'bestand grüner veltliner': {
    text: 'Vom Grünen Veltliner sind aktuell 1.240 Flaschen auf Lager.',
    actions: ['Artikel öffnen'],
  },
  'umsatz juli': {
    text: 'Im Juli wurden € 42.180 umgesetzt, das sind 12 % mehr als im Juni.',
    actions: ['Verkäufe anzeigen'],
  },
  'offene lieferscheine': {
    text: '7 Lieferscheine sind noch nicht freigegeben, davon 4 seit über einer Woche.',
    actions: ['Lieferscheine freigeben'],
  },
}
const FALLBACK = 'Dazu finde ich keine Daten im Betrieb. Ich kann nach Kunden, Belegen, Lagerbeständen, Kellerbuch-Einträgen und Umsätzen suchen.'
const GREETING = 'Guten Morgen. Drei Rechnungen über € 18.640 sind überfällig und Tank 3 ist seit 9 Tagen unbewegt. Womit soll ich anfangen?'

let msgCounter = 0
function nextId() {
  msgCounter += 1
  return `m${msgCounter}`
}

export default function AssistantPanel() {
  const [open, setOpen] = useState(INITIAL_OPEN)
  const [hydrated, setHydrated] = useState(false)
  const [messages, setMessages] = useState<Message[]>([{ id: 'greeting', role: 'assistant', text: GREETING }])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Zustand aus localStorage wiederherstellen
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) setOpen(stored === 'true')
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, String(open))
  }, [open, hydrated])

  // Autoscroll ans Ende bei neuer Nachricht / Tipp-Zustand
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || thinking) return
    setMessages(m => [...m, { id: nextId(), role: 'user', text: trimmed }])
    setDraft('')
    setThinking(true)
    setTimeout(() => {
      const match = CANNED[trimmed.toLowerCase()]
      setMessages(m => [...m, { id: nextId(), role: 'assistant', text: match?.text ?? FALLBACK, actions: match?.actions }])
      setThinking(false)
    }, 700)
  }

  return (
    <>
      {/* Backdrop: nur < xl, wenn Panel als Overlay-Drawer offen ist */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 xl:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={[
        'bg-s112-surface flex flex-col z-50 fixed inset-y-0 right-0 w-[340px] border-l border-s112-line',
        'transform transition-transform duration-200 ease-in-out',
        open ? 'translate-x-0' : 'translate-x-full',
        'xl:translate-x-0 xl:transition-none xl:relative xl:inset-auto',
        open ? 'xl:flex' : 'xl:hidden',
      ].join(' ')}>
        {/* Kopf */}
        <div className="flex items-center gap-2.5 px-[18px] py-[15px] border-b border-s112-line flex-shrink-0">
          <span className="w-7 h-7 rounded-lg bg-s112-blue-50 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} strokeWidth={1.75} className="text-s112-blue-700" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-[13.5px] text-s112-text">Assistent</p>
            <p className="text-[11px] text-s112-ok-fg truncate">antwortet auf Ihre Betriebsdaten</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            title="Einklappen"
            className="flex-shrink-0 p-1 rounded-lg text-s112-text-2 hover:bg-s112-bg hover:text-s112-blue-700 transition-colors"
          >
            <PanelRightClose size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Verlauf */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={
                m.role === 'user'
                  ? 'max-w-[84%] px-[13px] py-[10px] text-[13px] leading-[1.5] whitespace-pre-wrap bg-s112-teal text-white rounded-[12px_12px_4px_12px]'
                  : 'max-w-[90%] px-[13px] py-[10px] text-[13px] leading-[1.5] whitespace-pre-wrap bg-[#F2F3F5] text-s112-text rounded-[12px_12px_12px_4px]'
              }>
                {m.text}
                {m.actions && m.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {m.actions.map((label, i) => (
                      <button
                        key={i}
                        title="Noch nicht verknüpft (Platzhalter-Hülle)"
                        className="px-2.5 py-[5px] rounded-[7px] border border-s112-blue-100 bg-white text-s112-blue-700 text-[11.5px] font-semibold hover:bg-s112-blue-50 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="max-w-[90%] px-[13px] py-[10px] rounded-[12px_12px_12px_4px] bg-[#F2F3F5] text-[13px] text-s112-tertiary">
                tippt …
              </div>
            </div>
          )}
        </div>

        {/* Fuß: Vorschlags-Chips + Eingabezeile */}
        <div className="border-t border-s112-line px-4 pt-3 pb-4 flex-shrink-0">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {CHIPS.map(chip => (
              <button
                key={chip}
                onClick={() => send(chip)}
                disabled={thinking}
                className="px-[11px] py-[6px] rounded-full bg-s112-bg border border-s112-line text-s112-text-1 text-[11.5px] hover:border-s112-blue-300 hover:text-s112-blue-700 hover:bg-[#F7F8FA] transition-colors disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-[10px] border border-s112-line-str focus-within:border-s112-blue-300 px-3 py-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(draft) }}
              placeholder="Frage zu Betriebsdaten…"
              disabled={thinking}
              className="flex-1 outline-none text-[13px] bg-transparent placeholder:text-s112-tertiary disabled:opacity-50"
            />
            <button
              onClick={() => send(draft)}
              disabled={thinking || !draft.trim()}
              title="Senden"
              className="flex-shrink-0 w-7 h-7 rounded-[7px] bg-s112-teal text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              <ArrowUp size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </aside>

      {/* Wiederöffnen-Button, wenn eingeklappt */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Assistent öffnen"
          className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-s112-teal text-white shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <Sparkles size={20} strokeWidth={1.75} />
        </button>
      )}
    </>
  )
}
