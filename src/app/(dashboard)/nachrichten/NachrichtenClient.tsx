'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

type Msg = {
  id: string; betreff: string; von: string; vonName: string
  an: string; datum: string; gelesen: boolean; vorschau: string; quelle: string
}
type MsgDetail = Msg & {
  bodyHtml: string | null; bodyText: string
  conversationId: string | null
  kontaktInfo: { typ: string; id: string; name: string; kundennummer: string | null } | null
}

function fmtDate(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  const heute = new Date().toDateString()
  if (dt.toDateString() === heute) return dt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
  return dt.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })
}

export default function NachrichtenClient() {
  const [folder, setFolder]       = useState<'inbox'|'sent'>('inbox')
  const [messages, setMessages]   = useState<Msg[]>([])
  const [selected, setSelected]   = useState<MsgDetail | null>(null)
  const [laden, setLaden]         = useState(false)
  const [detailLaden, setDetailLaden] = useState(false)
  const [fehler, setFehler]       = useState<string | null>(null)
  const [compose, setCompose]     = useState(false)
  const [an, setAn]               = useState('')
  const [betreff, setBetreff]     = useState('')
  const [text, setText]           = useState('')
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [sending, setSending]     = useState(false)

  const ladeMessages = useCallback(async () => {
    setLaden(true); setFehler(null); setSelected(null)
    try {
      const res = await fetch(`/api/nachrichten/list?folder=${folder}`)
      const data = await res.json()
      if (!res.ok || data.fehler) { setFehler(data.fehler ?? 'Fehler'); return }
      setMessages(data.messages ?? [])
    } catch (e) { setFehler(String(e)) }
    finally { setLaden(false) }
  }, [folder])

  useEffect(() => { ladeMessages() }, [ladeMessages])

  async function openMessage(msg: Msg) {
    if (msg.quelle !== 'm365') { setSelected({ ...msg, bodyHtml: null, bodyText: msg.vorschau, conversationId: null, kontaktInfo: null }); return }
    setDetailLaden(true); setSelected(null)
    const res = await fetch(`/api/nachrichten/message?id=${msg.id}`)
    const data = await res.json()
    setDetailLaden(false)
    if (data.fehler) return
    setSelected(data)
    // Gelesen markieren in Liste
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, gelesen: true } : m))
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault()
    setSending(true); setSendResult(null)
    const res = await fetch('/api/email/unified', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ an, betreff, text }),
    })
    const data = await res.json()
    if (!res.ok || data.fehler) { setSendResult('Fehler: ' + (data.fehler ?? 'Unbekannt')); setSending(false); return }
    setSendResult('✓ Gesendet')
    setTimeout(() => { setCompose(false); setSendResult(null); setAn(''); setBetreff(''); setText('') }, 1500)
    setSending(false)
    if (folder === 'sent') ladeMessages()
  }

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 border border-s112-border rounded-xl overflow-hidden">

      {/* ── Ordner-Sidebar ── */}
      <div className="w-44 flex-shrink-0 bg-s112-bg border-r border-s112-border flex flex-col">
        <div className="p-3">
          <button onClick={() => setCompose(true)}
            className="w-full bg-s112-teal text-white px-3 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 flex items-center justify-center gap-2">
            ✏ Verfassen
          </button>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {[
            { id: 'inbox', label: 'Posteingang', icon: '📥', count: messages.filter(m => !m.gelesen && folder === 'inbox').length },
            { id: 'sent',  label: 'Gesendet',    icon: '📤', count: 0 },
          ].map(f => (
            <button key={f.id} onClick={() => setFolder(f.id as 'inbox'|'sent')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                ${folder === f.id ? 'bg-s112-teal/10 text-s112-teal font-medium' : 'text-gray-600 hover:bg-white'}`}>
              <span>{f.icon}</span>
              <span className="flex-1 text-left">{f.label}</span>
              {f.count > 0 && <span className="text-xs bg-s112-teal text-white px-1.5 py-0.5 rounded-full">{f.count}</span>}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-s112-border">
          <button onClick={ladeMessages} disabled={laden}
            className="w-full text-xs text-s112-muted hover:text-s112-teal py-1">
            {laden ? '⏳ Laden…' : '↻ Aktualisieren'}
          </button>
        </div>
      </div>

      {/* ── Nachrichten-Liste ── */}
      <div className="w-72 flex-shrink-0 border-r border-s112-border flex flex-col bg-white">
        <div className="px-4 py-3 border-b border-s112-border">
          <p className="text-sm font-semibold text-gray-800">{folder === 'inbox' ? 'Posteingang' : 'Gesendet'}</p>
          <p className="text-xs text-s112-muted">{messages.length} Nachrichten</p>
        </div>
        {fehler && <p className="text-xs text-red-500 px-4 py-2">{fehler}</p>}
        <div className="flex-1 overflow-y-auto divide-y divide-s112-border/40">
          {messages.map(msg => (
            <button key={msg.id} onClick={() => openMessage(msg)}
              className={`w-full text-left px-4 py-3 hover:bg-s112-bg/50 transition-colors
                ${selected?.id === msg.id ? 'bg-s112-teal/5 border-l-2 border-s112-teal' : ''}
                ${!msg.gelesen ? 'bg-blue-50/30' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className={`text-xs truncate ${!msg.gelesen ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                  {folder === 'sent' ? msg.an : (msg.vonName || msg.von)}
                </p>
                <p className="text-[10px] text-s112-muted flex-shrink-0">{fmtDate(msg.datum)}</p>
              </div>
              <p className={`text-xs truncate ${!msg.gelesen ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>{msg.betreff}</p>
              {msg.vorschau && <p className="text-[11px] text-s112-muted truncate mt-0.5">{msg.vorschau}</p>}
            </button>
          ))}
          {!laden && messages.length === 0 && !fehler && (
            <p className="text-center text-s112-muted text-xs py-8">Keine Nachrichten</p>
          )}
        </div>
      </div>

      {/* ── E-Mail-Inhalt ── */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {!selected && !detailLaden && !compose && (
          <div className="flex-1 flex items-center justify-center text-s112-muted text-sm">
            E-Mail aus der Liste wählen oder ✏ Verfassen klicken
          </div>
        )}
        {detailLaden && (
          <div className="flex-1 flex items-center justify-center text-s112-muted text-sm">⏳ E-Mail wird geladen…</div>
        )}
        {selected && !compose && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-s112-border">
              <h2 className="text-base font-bold text-gray-900 mb-2">{selected.betreff}</h2>
              <div className="flex items-start justify-between gap-4">
                <div className="text-xs text-s112-muted space-y-0.5">
                  <p><span className="font-medium text-gray-700">Von:</span> {selected.vonName} &lt;{selected.von}&gt;</p>
                  {selected.an && <p><span className="font-medium text-gray-700">An:</span> {selected.an}</p>}
                  <p><span className="font-medium text-gray-700">Datum:</span> {new Date(selected.datum).toLocaleString('de-AT')}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {selected.kontaktInfo && (
                    <Link href={`/crm/${selected.kontaktInfo.typ === 'firma' ? 'firmen' : 'kontakte'}/${selected.kontaktInfo.id}`}
                      className="text-xs text-s112-teal border border-s112-border px-3 py-1.5 rounded-lg hover:bg-s112-bg">
                      👤 {selected.kontaktInfo.name}
                    </Link>
                  )}
                  <button onClick={() => { setCompose(true); setAn(selected.von); setBetreff(`Re: ${selected.betreff}`); setText('') }}
                    className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg hover:bg-opacity-90">
                    ↩ Antworten
                  </button>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {selected.bodyHtml ? (
                <iframe
                  srcDoc={`<base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:13px;color:#374151;margin:0;padding:0}a{color:#2a7c6f}</style>${selected.bodyHtml}`}
                  className="w-full min-h-96 border-0" sandbox="allow-popups allow-same-origin"
                  style={{ height: '100%', minHeight: '400px' }}
                />
              ) : (
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{selected.bodyText}</pre>
              )}
            </div>
          </div>
        )}

        {/* ── Verfassen ── */}
        {compose && (
          <div className="flex-1 flex flex-col p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-gray-900">✏ Neue E-Mail verfassen</h2>
              <button onClick={() => { setCompose(false); setSendResult(null) }}
                className="text-s112-muted hover:text-gray-700">✕</button>
            </div>
            <form onSubmit={sendEmail} className="flex-1 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">An * <span className="font-normal text-s112-muted">(mehrere mit Komma trennen)</span></label>
                <input value={an} onChange={e => setAn(e.target.value)} required
                  placeholder="empfaenger@email.at, zweiter@email.at"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Betreff *</label>
                <input value={betreff} onChange={e => setBetreff(e.target.value)} required
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block text-xs font-medium text-gray-600 mb-1">Nachricht</label>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={12}
                  className="flex-1 border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
              </div>
              {sendResult && <p className={`text-sm font-medium ${sendResult.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{sendResult}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={sending}
                  className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
                  {sending ? 'Senden…' : '✉ Senden'}
                </button>
                <button type="button" onClick={() => setCompose(false)}
                  className="text-sm px-4 py-2 rounded-xl border border-s112-border text-gray-600 hover:bg-s112-bg">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
