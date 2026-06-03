'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

type Msg = {
  id: string; betreff: string; von: string; vonName: string
  an: string; datum: string; gelesen: boolean; vorschau: string; quelle: string
  conversationId?: string | null
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
  const [verbunden, setVerbunden]       = useState<boolean | null>(null)
  const [verbEmail, setVerbEmail]         = useState('')
  const [monitoredEmail, setMonitoredEmail] = useState('')
  const [monitoredSaving, setMonitoredSaving] = useState(false)
  const [showSettings, setShowSettings]       = useState(false)
  const [deleteConfirm, setDeleteConfirm]       = useState(false)
  const [forwardAn, setForwardAn]               = useState('')
  const [forwardMode, setForwardMode]           = useState(false)
  const [sendVon, setSendVon]                   = useState<'own'|'shared'>('own')
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [threadMsgs, setThreadMsgs]             = useState<Msg[]>([])
  const [threadLaden, setThreadLaden]           = useState(false)
  const loadGenRef = useRef(0)
  const pendingEmailIdRef = useRef<string | null>(null)
  const [folders, setFolders]     = useState<{id: string; name: string; unread: number; total: number}[]>([])
  const [folderId, setFolderId]   = useState<string | null>(null)  // null = inbox

  useEffect(() => {
    // URL-Params prüfen
    const params = new URLSearchParams(window.location.search)
    if (params.get('verbunden') === '1') {
      window.history.replaceState({}, '', '/nachrichten')
      ladeMessages()
    }
    if (params.get('fehler')) {
      const errParam = params.get('fehler') ?? ''
      const friendlyErr = errParam.includes('access_denied') ? 'Zugriff verweigert – Berechtigungen prüfen.'
        : errParam.includes('AADSTS') ? 'Azure AD Fehler – bitte Administrator kontaktieren.'
        : 'Verbindungsfehler: ' + errParam
      setFehler(friendlyErr)
      window.history.replaceState({}, '', '/nachrichten')
    }
    // emailId aus CRM-Link: in Ref speichern, nach Verbindungscheck öffnen
    const emailId = params.get('emailId')
    if (emailId) {
      window.history.replaceState({}, '', '/nachrichten')
      pendingEmailIdRef.current = emailId
    }
    // Verbindungsstatus prüfen
    fetch('/api/nachrichten/list?folder=inbox').then(async r => {
      const data = await r.json()
      if (!r.ok || data.fehler) {
        if (data.fehler?.includes('token') || data.fehler?.includes('Token') || data.fehler?.includes('401')) {
          setFehler('Sitzung abgelaufen – bitte Mailbox neu verbinden.')
        }
        setVerbunden(false)
      } else {
        setVerbunden(true)
        setVerbEmail(data.email ?? '')
        // Pending Email aus CRM-Link öffnen
        if (pendingEmailIdRef.current) {
          const eid = pendingEmailIdRef.current
          pendingEmailIdRef.current = null
          fetch(`/api/nachrichten/message?id=${encodeURIComponent(eid)}`)
            .then(r => r.json())
            .then(d => { if (!d.fehler) setSelected(d) })
            .catch(() => {})
        }
        // Ordnerstruktur aus Mailbox laden
        fetch('/api/nachrichten/folders').then(r => r.json()).then(d => {
          if (d.folders) {
          // Wichtige Ordner zuerst, dann alphabetisch
          const PRIO = ['Inbox','Posteingang','Sent Items','Gesendete Elemente','Drafts','Entwürfe','Deleted Items','Gelöschte Elemente','Junk Email','Junk-E-Mail']
          const sorted = [...d.folders].sort((a: {name:string}, b: {name:string}) => {
            const ai = PRIO.findIndex(p => p.toLowerCase() === a.name.toLowerCase())
            const bi = PRIO.findIndex(p => p.toLowerCase() === b.name.toLowerCase())
            if (ai !== -1 && bi !== -1) return ai - bi
            if (ai !== -1) return -1
            if (bi !== -1) return 1
            return a.name.localeCompare(b.name, 'de')
          })
          setFolders(sorted)
        }
        }).catch(() => {})
      }
    }).catch(() => setVerbunden(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ladeMessages = useCallback(async () => {
    const gen = ++loadGenRef.current
    setLaden(true); setFehler(null); setSelected(null)
    try {
      const res = await fetch(`/api/nachrichten/list?folder=${folder}${folderId ? `&folderId=${folderId}` : ''}`)
      const data = await res.json()
      if (gen !== loadGenRef.current) return  // veraltete Antwort – ignorieren
      if (!res.ok || data.fehler) { setFehler(data.fehler ?? 'Fehler'); return }
      setMessages(data.messages ?? [])
    } catch (e) { if (gen === loadGenRef.current) setFehler(String(e)) }
    finally { if (gen === loadGenRef.current) setLaden(false) }
  }, [folder, folderId])

  useEffect(() => { ladeMessages() }, [ladeMessages])

  async function openMessage(msg: Msg) {
    setDeleteConfirm(false)
    setThreadMsgs([]); setForwardMode(false)
    if (msg.quelle !== 'm365') { setSelected({ ...msg, bodyHtml: null, bodyText: msg.vorschau, conversationId: null, kontaktInfo: null }); return }
    setDetailLaden(true); setSelected(null)
    const res = await fetch(`/api/nachrichten/message?id=${msg.id}`)
    const data = await res.json()
    setDetailLaden(false)
    if (data.fehler) return
    setSelected(data)
    // Gelesen markieren in Liste
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, gelesen: true } : m))
    // Thread-Nachrichten nachladen (cross-folder)
    if (data.conversationId) {
      setThreadLaden(true)
      fetch(`/api/nachrichten/conversation?id=${encodeURIComponent(data.conversationId)}`)
        .then(r => r.json()).then(d => {
          if (d.messages) setThreadMsgs(d.messages.filter((m: Msg) => m.id !== data.id))
        }).catch(() => {}).finally(() => setThreadLaden(false))
    }
    // Unread-Zähler im Ordner dekrementieren wenn Nachricht war ungelesen
    if (!msg.gelesen) {
      setFolders(prev => prev.map(f =>
        f.id === (folderId ?? '') || (!folderId && (f.name === 'Inbox' || f.name === 'Posteingang'))
          ? { ...f, unread: Math.max(0, f.unread - 1) }
          : f
      ))
    }
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault()
    setSending(true); setSendResult(null)
    const res = await fetch('/api/email/unified', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ an, betreff, text, useSharedMailbox: sendVon === 'shared' && !!monitoredEmail }),
    })
    const data = await res.json()
    if (!res.ok || data.fehler) { setSendResult('Fehler: ' + (data.fehler ?? 'Unbekannt')); setSending(false); return }
    setSendResult('✓ Gesendet')
    setTimeout(() => { setCompose(false); setSendResult(null); setAn(''); setBetreff(''); setText('') }, 1500)
    setSending(false)
    if (folder === 'sent') ladeMessages()
  }

  if (verbunden === false) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-5">
        <p className="text-4xl">📬</p>
        <h2 className="text-xl font-bold text-gray-800">Deine Mailbox verbinden</h2>
        <p className="text-sm text-s112-muted text-center max-w-md">
          Verbinde dein persönliches E-Mail-Konto um Nachrichten direkt in software:112 zu lesen und zu schreiben.
          Jeder User verbindet seine eigene Mailbox.
        </p>
        {fehler && <p className="text-sm text-red-600">{fehler}</p>}
        <a href="/api/auth/m365/user"
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700">
          <span className="text-lg">📅</span> Mit Microsoft 365 verbinden
        </a>
        <div className="mt-4 pt-4 border-t border-s112-border space-y-2">
          <p className="text-xs font-medium text-gray-700">Optional: Funktionale Mailbox überwachen</p>
          <p className="text-xs text-s112-muted">z.B. office@weingut.at, info@weingut.at – du brauchst Vollzugriff auf diese Mailbox in Exchange.</p>
          <div className="flex gap-2">
            <input value={monitoredEmail} onChange={e => setMonitoredEmail(e.target.value)}
              placeholder="office@weingut.at"
              className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            <button onClick={async () => {
              setMonitoredSaving(true)
              await fetch('/api/nachrichten/monitored', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ monitored_email: monitoredEmail || null }),
              })
              setMonitoredSaving(false)
              window.location.reload()
            }} disabled={monitoredSaving}
              className="text-xs border border-s112-border px-3 py-1.5 rounded-lg hover:bg-s112-bg disabled:opacity-40">
              {monitoredSaving ? '…' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (verbunden === null) {
    return <div className="flex items-center justify-center h-48 text-s112-muted">⏳ Verbindung wird geprüft…</div>
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
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {/* Echte Ordnerstruktur aus Mailbox */}
          {folders.length > 0 ? folders.map(f => (
            <button key={f.id} onClick={() => { setFolderId(f.id); setFolder('inbox'); setSelected(null) }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                ${folderId === f.id ? 'bg-s112-teal/10 text-s112-teal font-medium' : 'text-gray-600 hover:bg-white'}`}>
              <span className="text-sm">{f.name === 'Inbox' || f.name === 'Posteingang' ? '📥' : f.name === 'Sent Items' || f.name === 'Gesendete Elemente' ? '📤' : f.name === 'Deleted Items' || f.name === 'Gelöschte Elemente' ? '🗑' : f.name === 'Drafts' || f.name === 'Entwürfe' ? '📝' : '📁'}</span>
              <span className="flex-1 text-left truncate text-xs">{f.name}</span>
              {f.unread > 0 && <span className="text-xs bg-s112-teal text-white px-1.5 py-0.5 rounded-full">{f.unread}</span>}
            </button>
          )) : (
            // Fallback wenn keine Ordner geladen
            ['inbox', 'sent'].map(id => (
              <button key={id} onClick={() => { setFolderId(null); setFolder(id as 'inbox'|'sent') }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                  ${folder === id && !folderId ? 'bg-s112-teal/10 text-s112-teal font-medium' : 'text-gray-600 hover:bg-white'}`}>
                <span>{id === 'inbox' ? '📥' : '📤'}</span>
                <span className="flex-1 text-left">{id === 'inbox' ? 'Posteingang' : 'Gesendet'}</span>
              </button>
            ))
          )}
        </nav>
        <div className="p-3 border-t border-s112-border">
          <button onClick={ladeMessages} disabled={laden}
            className="w-full text-xs text-s112-muted hover:text-s112-teal py-1">
            {laden ? '⏳ Laden…' : '↻ Aktualisieren'}
          </button>
          <button onClick={() => setShowSettings(v => !v)}
            className="w-full text-xs text-s112-muted hover:text-s112-teal py-1">
            ⚙ Einstellungen
          </button>
          {showSettings && (
            <div className="mt-2 pt-2 border-t border-s112-border space-y-2">
              <div className="space-y-1">
                <p className="text-[10px] text-s112-muted font-medium uppercase tracking-wide">Verbindung</p>
                <button onClick={async () => {
                  await fetch('/api/nachrichten/disconnect', { method: 'POST' })
                  window.location.reload()
                }} className="w-full text-[10px] border border-red-200 text-red-500 px-2 py-1 rounded hover:bg-red-50">
                  Trennen &amp; neu verbinden
                </button>
              </div>
              <p className="text-[10px] text-s112-muted font-medium uppercase tracking-wide">Weitere Mailbox</p>
              <p className="text-[10px] text-s112-muted">z.B. office@weingut.at – Vollzugriff in Exchange nötig</p>
              <div className="space-y-1">
                <input value={monitoredEmail} onChange={e => setMonitoredEmail(e.target.value)}
                  placeholder="office@weingut.at"
                  className="w-full border border-s112-border rounded px-2 py-1 text-[10px] focus:outline-none" />
                <button onClick={async () => {
                  setMonitoredSaving(true)
                  await fetch('/api/nachrichten/monitored', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ monitored_email: monitoredEmail || null }),
                  })
                  setMonitoredSaving(false); setShowSettings(false)
                  window.location.reload()
                }} disabled={monitoredSaving}
                  className="w-full text-[10px] bg-s112-teal text-white px-2 py-1 rounded hover:bg-opacity-90 disabled:opacity-40">
                  {monitoredSaving ? '…' : monitoredEmail ? 'Speichern' : 'Eigene Mailbox'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Nachrichten-Liste ── */}
      <div className="w-72 flex-shrink-0 border-r border-s112-border flex flex-col bg-white">
        <div className="px-4 py-3 border-b border-s112-border">
          <p className="text-sm font-semibold text-gray-800">
            {folderId
              ? (folders.find(f => f.id === folderId)?.name ?? 'Posteingang')
              : folder === 'inbox' ? 'Posteingang' : 'Gesendet'}
          </p>
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
        {selected && forwardMode && (
          <div className="flex-1 flex flex-col p-6 gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">↪ Weiterleiten</h3>
              <button onClick={() => setForwardMode(false)} className="text-xs text-s112-muted hover:text-gray-700">✕ Abbrechen</button>
            </div>
            <p className="text-xs text-s112-muted">Betreff: Fwd: {selected.betreff}</p>
            <input value={forwardAn} onChange={e => setForwardAn(e.target.value)}
              placeholder="An: empfaenger@example.com"
              className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-s112-teal" />
            <button onClick={async () => {
              if (!forwardAn) return
              setSending(true)
              const body = `---------- Weitergeleitet von ${selected.vonName} <${selected.von}> ----------\n${selected.bodyText ?? ''}`
              const r = await fetch('/api/email/unified', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ an: forwardAn, betreff: `Fwd: ${selected.betreff}`, text: body }),
              })
              const d = await r.json()
              setSending(false)
              if (!r.ok) { setFehler('Weiterleiten fehlgeschlagen: ' + (d.fehler ?? r.status)); return }
              setForwardMode(false)
            }} disabled={sending || !forwardAn}
              className="text-sm bg-s112-teal text-white px-4 py-2 rounded-lg hover:bg-opacity-90 disabled:opacity-40">
              {sending ? '⏳ Senden…' : '↪ Weiterleiten'}
            </button>
          </div>
        )}
        {selected && !forwardMode && !compose && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-s112-border">
              <h2 className="text-base font-bold text-gray-900 mb-2">{selected.betreff}</h2>
              <div className="text-xs text-s112-muted space-y-0.5">
                <p><span className="font-medium text-gray-700">Von:</span> {selected.vonName} &lt;{selected.von}&gt;</p>
                {selected.an && <p><span className="font-medium text-gray-700">An:</span> {selected.an}</p>}
                <p><span className="font-medium text-gray-700">Datum:</span> {new Date(selected.datum).toLocaleString('de-AT')}</p>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
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
                  <button onClick={() => { setForwardMode(true); setForwardAn(''); setCompose(false) }}
                    className="text-xs border border-s112-border text-gray-600 px-3 py-1.5 rounded-lg hover:bg-s112-bg">
                    ↪ Weiterleiten
                  </button>
                  {!deleteConfirm ? (
                    <button onClick={() => setDeleteConfirm(true)} title="Löschen"
                      className="border border-red-200 text-red-400 p-1.5 rounded-lg hover:bg-red-50 hover:text-red-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                  ) : (
                    <span className="flex items-center gap-1">
                      <span className="text-xs text-red-500">Löschen?</span>
                      <button onClick={async () => {
                        const delId = selected.id
                        setDeleteConfirm(false)
                        loadGenRef.current++  // in-flight ladeMessages ignorieren
                        setMessages(prev => prev.filter(m => m.id !== delId))
                        setSelected(null)
                        const r = await fetch(`/api/nachrichten/delete?id=${delId}`, { method: 'DELETE' })
                        if (!r.ok) {
                          const d = await r.json().catch(() => ({}))
                          setFehler('Löschen fehlgeschlagen: ' + (d.fehler ?? r.status))
                        }
                      }} className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">Ja</button>
                      <button onClick={() => setDeleteConfirm(false)}
                        className="text-xs border border-gray-300 text-gray-600 px-2 py-1 rounded hover:bg-gray-50">Nein</button>
                    </span>
                  )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {/* ── Thread-Nachrichten (andere Folder) ── */}
              {(threadLaden || threadMsgs.length > 0) && (
                <div className="border-t border-s112-border mt-4 pt-4">
                  <p className="text-xs font-medium text-s112-muted mb-3 uppercase tracking-wide">
                    Weitere Nachrichten in diesem Thread {threadLaden && '⏳'}
                  </p>
                  <div className="space-y-3">
                    {threadMsgs.map(tm => (
                      <div key={tm.id} className="border border-s112-border rounded-xl p-4 hover:bg-s112-bg/30 cursor-pointer"
                        onClick={() => openMessage(tm)}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-gray-800">{tm.vonName || tm.von}</span>
                          <span className="text-[10px] text-s112-muted">{fmtDate(tm.datum)}</span>
                        </div>
                        <p className="text-xs text-gray-700 truncate">{tm.betreff}</p>
                        {tm.vorschau && <p className="text-[11px] text-s112-muted mt-1 line-clamp-2">{tm.vorschau}</p>}
                        <div className="flex gap-2 mt-2">
                          <button onClick={e => { e.stopPropagation(); setCompose(true); setAn(tm.von); setBetreff(`Re: ${tm.betreff}`); setText('') }}
                            className="text-[10px] text-s112-teal border border-s112-teal/30 px-2 py-0.5 rounded hover:bg-s112-teal/5">
                            ↩ Antworten
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
              {monitoredEmail && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSendVon('own')}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sendVon === 'own' ? 'bg-s112-teal text-white border-s112-teal' : 'border-s112-border text-gray-600 hover:bg-s112-bg'}`}>
                      Eigene Mailbox
                    </button>
                    <button type="button" onClick={() => setSendVon('shared')}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sendVon === 'shared' ? 'bg-s112-teal text-white border-s112-teal' : 'border-s112-border text-gray-600 hover:bg-s112-bg'}`}>
                      {monitoredEmail}
                    </button>
                  </div>
                </div>
              )}
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
