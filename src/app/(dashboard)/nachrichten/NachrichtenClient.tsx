'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from '@/components/ui/Link'
import { Mail, Inbox, Send, Trash2, FileText, Folder, X, UserPlus, Paperclip } from 'lucide-react'
import LeadDialog from './LeadDialog'
import { ignoriereAbsender, emailHinzufuegen } from '../crm/actions'
import EmailEingabe from '@/components/crm/EmailEingabe'
import EmailHtmlAnzeige from '@/components/EmailHtmlAnzeige'

// absender: Status aus der Absender-Erkennung (lib/crm/absender.ts) - 'lead'
// und 'unbekannt' werden in der Liste markiert, 'unbekannt' löst beim Öffnen
// die Frage „Soll ein Lead angelegt werden?“ aus (E-Mail → Lead, 15.9.2026).
type Msg = {
  id: string; betreff: string; von: string; vonName: string
  an: string; datum: string; gelesen: boolean; vorschau: string; quelle: string
  conversationId?: string | null
  absender?: 'kontakt' | 'firma' | 'lead' | 'unbekannt' | 'ignoriert' | 'system' | 'eigen' | null
}
type MsgDetail = Msg & {
  bodyHtml: string | null; bodyText: string
  conversationId: string | null
  kontaktInfo: { typ: string; id: string; name: string; accountnummer: string | null; istLead?: boolean; ueber?: 'email' | 'domain' } | null
  leadVorschlag?: boolean
  // Unbekannte Adresse, aber Name passt zu bestehendem Kontakt/Firma (18.9.2026)
  namensTreffer?: { typ: 'kontakt' | 'firma'; id: string; name: string; accountnummer: string | null; email: string | null; istLead: boolean }[]
  cc?: string
  // Echte Anhänge (17.9.2026) - eingebettete Bilder stecken bereits im bodyHtml
  anhaenge?: { id: string; name: string; groesse: number; typ: string }[]
  mailbox?: 'own' | 'shared'
}

function fmtGroesse(b: number) {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} B`
}

function fmtDate(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  const heute = new Date().toDateString()
  if (dt.toDateString() === heute) return dt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
  return dt.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })
}

// Wichtige Ordner zuerst, dann alphabetisch (für eigene & geteilte Mailbox gleich);
// Unterordner (parentId/depth aus /api/nachrichten/folders) direkt unter ihrem
// Elternordner, alphabetisch (Rückmeldung 17.9.2026: Unterordner mitspiegeln).
const FOLDER_PRIO = ['Inbox','Posteingang','Sent Items','Gesendete Elemente','Drafts','Entwürfe','Deleted Items','Gelöschte Elemente','Junk Email','Junk-E-Mail']
type MailFolder = { id: string; name: string; unread: number; total: number; parentId?: string | null; depth?: number }
function sortFolders(list: MailFolder[]): MailFolder[] {
  const byParent = new Map<string | null, MailFolder[]>()
  for (const f of list) {
    const key = f.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(f)
  }
  const cmpTop = (a: MailFolder, b: MailFolder) => {
    const ai = FOLDER_PRIO.findIndex(p => p.toLowerCase() === a.name.toLowerCase())
    const bi = FOLDER_PRIO.findIndex(p => p.toLowerCase() === b.name.toLowerCase())
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.name.localeCompare(b.name, 'de')
  }
  const out: MailFolder[] = []
  const walk = (parent: string | null, depth: number) => {
    const kinder = [...(byParent.get(parent) ?? [])].sort(parent === null ? cmpTop : (a, b) => a.name.localeCompare(b.name, 'de'))
    for (const k of kinder) { out.push({ ...k, depth }); if (depth < 6) walk(k.id, depth + 1) }
  }
  walk(null, 0)
  // Ordner, deren Eltern nicht geladen wurden (sollte nicht vorkommen), hinten anhängen
  const seen = new Set(out.map(f => f.id))
  for (const f of list) if (!seen.has(f.id)) out.push({ ...f, depth: 0 })
  return out
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
  // Migration/Feature: geteilte Mailbox wird ZUSÄTZLICH angezeigt statt die
  // eigene zu ersetzen - activeMailbox bestimmt, welche der beiden gerade in
  // Ordnerliste/Nachrichtenliste angezeigt wird (rein clientseitig, wird bei
  // jedem API-Aufruf als ?mailbox=own|shared mitgeschickt).
  const [activeMailbox, setActiveMailbox] = useState<'own'|'shared'>('own')
  // E-Mail → Lead: Frage-Leiste je geöffneter Mail, Dialog, „Jetzt nicht“ merkt sich Absender für diese Sitzung
  const [leadDialog, setLeadDialog] = useState(false)
  const [leadSpaeter, setLeadSpaeter] = useState<Set<string>>(new Set())
  const composeRef = useRef(false)
  useEffect(() => { composeRef.current = compose }, [compose])
  const autoOeffnen = useRef<Msg | null>(null)
  useEffect(() => {
    const m = autoOeffnen.current
    if (m && messages.some(x => x.id === m.id)) { autoOeffnen.current = null; void openMessage(m) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])
  const [emailHinzu, setEmailHinzu] = useState(false)
  const [leadIgnoriere, setLeadIgnoriere] = useState(false)
  const [showSettings, setShowSettings]       = useState(false)
  // Höhe des Nachrichten-Rahmens exakt an den sichtbaren Bereich anpassen
  // (Rückmeldung 18.9.2026: auf einem MacBook Air 13" mit Firefox lag der Knopf
  // „Ältere Nachrichten laden“ unterhalb des Fensters - die bisherige feste
  // Rechnung 100vh − 120 px unterschätzte Kopfzeile, Navigation und Seitenrand,
  // sodass die Seite selbst scrollen musste, was auf dem Mac ohne sichtbare
  // Scrollleiste nicht auffiel). Gemessen wird der Abstand des Rahmens zum
  // oberen Fensterrand; Rest bis zum unteren Rand abzüglich 24 px Rand.
  const rahmenRef = useRef<HTMLDivElement>(null)
  const [rahmenHoehe, setRahmenHoehe] = useState<number | null>(null)
  useEffect(() => {
    function messen() {
      const el = rahmenRef.current
      if (!el) return
      const main = el.closest('main')
      const scrollTop = main ? main.scrollTop : 0
      const top = el.getBoundingClientRect().top + scrollTop
      setRahmenHoehe(Math.max(420, Math.floor(window.innerHeight - top - 24)))
    }
    messen()
    const t = setTimeout(messen, 300)   // nach Schriften/Layout
    window.addEventListener('resize', messen)
    return () => { clearTimeout(t); window.removeEventListener('resize', messen) }
  }, [])
  const [spiegelInfo, setSpiegelInfo]         = useState<string | null>(null)
  const [spiegelLaeuft, setSpiegelLaeuft]     = useState(false)
  async function spiegeln(voll: boolean) {
    setSpiegelLaeuft(true)
    try {
      const r = await fetch(`/api/nachrichten/spiegeln${voll ? '?voll=1' : ''}`, { method: 'POST' })
      const d = await r.json()
      if (typeof d.fehler === 'string') { setFehler(d.fehler); return }
      const probleme: string[] = Array.isArray(d.fehler) ? d.fehler : []
      const teile = [`${new Date().toISOString().slice(0, 16)}`, `${d.nachrichten ?? 0} geprüft`, `${d.angelegt ?? 0} neu`]
      if ((d.postfaecher ?? 0) === 0) teile.push('kein verbundenes Postfach')
      if (probleme.length) teile.push(probleme[0])
      setSpiegelInfo(teile.join(' · '))
    } catch (e) { setFehler(String(e)) }
    finally { setSpiegelLaeuft(false) }
  }
  const [deleteConfirm, setDeleteConfirm]       = useState(false)
  const [moveMode, setMoveMode]                 = useState(false)
  const [moveTarget, setMoveTarget]             = useState('')
  const [moving, setMoving]                     = useState(false)
  const [forwardAn, setForwardAn]               = useState('')
  const [forwardMode, setForwardMode]           = useState(false)
  const [sendVon, setSendVon]                   = useState<'own'|'shared'>('own')
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [threadMsgs, setThreadMsgs]             = useState<Msg[]>([])
  const [threadLaden, setThreadLaden]           = useState(false)
  const loadGenRef = useRef(0)
  const pendingEmailIdRef = useRef<string | null>(null)
  const [folders, setFolders]     = useState<MailFolder[]>([])
  // Seitenweise laden (50 je Seite): weitere ältere Nachrichten anhängen
  const [hatMehr, setHatMehr]     = useState(false)
  const [naechsteSeite, setNaechsteSeite] = useState(0)
  const [mehrLaden, setMehrLaden] = useState(false)
  // Antwort / Allen antworten: Originalnachricht über Graph zitiert mitschicken
  const [cc, setCc]               = useState('')
  const [antwortAuf, setAntwortAuf] = useState<{ id: string; modus: 'reply' | 'replyAll'; mailbox: 'own' | 'shared'; zitat: string; von: string; datum: string } | null>(null)
  const [folderId, setFolderId]   = useState<string | null>(null)  // null = inbox
  const isFirstMailboxRender = useRef(true)

  // Ordnerstruktur für eine bestimmte Mailbox ('own' oder 'shared') laden.
  // Wiederverwendet vom initialen Verbindungscheck und beim Umschalten der
  // aktiven Mailbox.
  const ladeFolders = useCallback(async (mb: 'own'|'shared') => {
    try {
      const res = await fetch(`/api/nachrichten/folders?mailbox=${mb}`)
      const d = await res.json()
      // Vorher wurde d.fehler hier nie ausgewertet - bei einem Graph-API-Fehler
      // (z.B. fehlende "Vollzugriff"-Berechtigung auf eine geteilte Mailbox)
      // blieb die Ordnerliste einfach leer, ohne dass der Grund sichtbar war.
      if (d.folders) { setFolders(sortFolders(d.folders)); setFehler(null) }
      else if (d.fehler) setFehler(d.fehler)
    } catch (e) { setFehler(String(e)) }
  }, [])

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
    // Gespeicherte "Funktionale Mailbox" laden - bisher gab es dafür keinen
    // GET-Endpunkt, der State startete daher nach jedem Reload wieder leer.
    fetch('/api/nachrichten/monitored').then(r => r.json()).then(d => {
      if (d.monitored_email) setMonitoredEmail(d.monitored_email)
      if (d.spiegel_info) setSpiegelInfo(d.spiegel_info)
    }).catch(() => {})
    // Verbindungsstatus prüfen
    fetch('/api/nachrichten/list?folder=inbox').then(async r => {
      const data = await r.json()
      if (!r.ok || data.fehler) {
        setFehler(data.fehler
          ? 'Verbindungsfehler: ' + data.fehler
          : 'Mailbox nicht erreichbar – bitte neu verbinden.')
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
        // Ordnerstruktur aus Mailbox laden (eigene Mailbox - beim ersten Laden
        // immer activeMailbox==='own'; das separate Effect unten übernimmt
        // das Nachladen beim Umschalten auf die geteilte Mailbox)
        ladeFolders('own')
      }
    }).catch(() => setVerbunden(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ladeMessages = useCallback(async () => {
    const gen = ++loadGenRef.current
    setLaden(true); setFehler(null); setSelected(null)
    try {
      const res = await fetch(`/api/nachrichten/list?folder=${folder}${folderId ? `&folderId=${folderId}` : ''}&mailbox=${activeMailbox}`)
      const data = await res.json()
      if (gen !== loadGenRef.current) return  // veraltete Antwort – ignorieren
      if (!res.ok || data.fehler) { setFehler(data.fehler ?? 'Fehler'); return }
      setMessages(data.messages ?? [])
      setHatMehr(!!data.hatMehr); setNaechsteSeite(data.naechsteSeite ?? (data.messages?.length ?? 0))
      // Oberste Nachricht direkt öffnen (Rückmeldung 18.9.2026) - außer im Verfassen-Modus
      const erste = (data.messages ?? [])[0] as Msg | undefined
      if (erste && !composeRef.current) autoOeffnen.current = erste
    } catch (e) { if (gen === loadGenRef.current) setFehler(String(e)) }
    finally { if (gen === loadGenRef.current) setLaden(false) }
  }, [folder, folderId, activeMailbox])

  // Ältere Nachrichten nachladen (Rückmeldung 17.9.2026: bisher nur die 30 neuesten)
  async function ladeWeitere() {
    if (mehrLaden || !hatMehr) return
    setMehrLaden(true)
    const gen = loadGenRef.current
    try {
      const res = await fetch(`/api/nachrichten/list?folder=${folder}${folderId ? `&folderId=${folderId}` : ''}&mailbox=${activeMailbox}&skip=${naechsteSeite}`)
      const data = await res.json()
      if (gen !== loadGenRef.current) return
      if (!res.ok || data.fehler) { setFehler(data.fehler ?? 'Fehler'); return }
      setMessages(prev => { const ids = new Set(prev.map(m => m.id)); return [...prev, ...((data.messages ?? []) as Msg[]).filter(m => !ids.has(m.id))] })
      setHatMehr(!!data.hatMehr); setNaechsteSeite(data.naechsteSeite ?? naechsteSeite + 50)
    } catch (e) { setFehler(String(e)) }
    finally { setMehrLaden(false) }
  }

  // Eigene Adressen (für „Allen antworten“: nicht an sich selbst)
  const eigeneAdressen = () => new Set([verbEmail, monitoredEmail].map(e => e.trim().toLowerCase()).filter(Boolean))
  const splitAdr = (v: string | null | undefined) => (v ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  const zitatVon = (m: { von: string; vonName: string; datum: string; bodyText?: string | null }) =>
    `Am ${new Date(m.datum).toLocaleString('de-AT')} schrieb ${m.vonName || m.von} <${m.von}>:\n` + (m.bodyText ?? '').replace(/<[^>]*>/g, '').trim().split('\n').map(z => `> ${z}`).join('\n')

  function antworten(m: MsgDetail | (Msg & { bodyText?: string | null; cc?: string }), modus: 'reply' | 'replyAll') {
    const eigene = eigeneAdressen()
    const anListe = [m.von.toLowerCase()]
    let ccListe: string[] = []
    if (modus === 'replyAll') {
      for (const e of splitAdr(m.an)) if (!eigene.has(e) && !anListe.includes(e)) anListe.push(e)
      ccListe = splitAdr(m.cc).filter(e => !eigene.has(e) && !anListe.includes(e))
    }
    setForwardMode(false); setCompose(true)
    setAn(anListe.join(', ')); setCc(ccListe.join(', '))
    setBetreff(/^(re|aw|wg):/i.test(m.betreff.trim()) ? m.betreff : `Re: ${m.betreff}`)
    setText('')
    setAntwortAuf({ id: m.id, modus, mailbox: activeMailbox, zitat: zitatVon({ von: m.von, vonName: m.vonName, datum: m.datum, bodyText: (m as MsgDetail).bodyText ?? '' }), von: m.vonName || m.von, datum: m.datum })
  }

  useEffect(() => { ladeMessages() }, [ladeMessages])

  // Mailbox gewechselt (Eigene ↔ geteilte Mailbox): Ordnerliste neu laden und
  // Auswahl zurücksetzen, da Ordner-IDs zwischen Mailboxen nicht kompatibel sind.
  // Der erste Render lädt bereits über den obigen Verbindungscheck-Effect.
  useEffect(() => {
    if (isFirstMailboxRender.current) { isFirstMailboxRender.current = false; return }
    setFolderId(null); setFolder('inbox'); setSelected(null)
    ladeFolders(activeMailbox)
  }, [activeMailbox, ladeFolders])

  // Löschen mit Sprung zur nächsten Nachricht (18.9.2026): aus der Liste
  // (Hover-Papierkorb) und aus dem Detail; die nächste Mail in der Liste (oder
  // die vorige, wenn die letzte gelöscht wurde) wird direkt geöffnet.
  async function loescheNachricht(id: string) {
    const idx = messages.findIndex(m => m.id === id)
    const rest = messages.filter(m => m.id !== id)
    const naechste = idx >= 0 ? (rest[idx] ?? rest[idx - 1] ?? null) : null
    setDeleteConfirm(false)
    loadGenRef.current++  // in-flight ladeMessages ignorieren
    setMessages(rest)
    if (!selected || selected.id === id) {
      if (naechste) void openMessage(naechste)
      else setSelected(null)
    }
    const r = await fetch(`/api/nachrichten/delete?id=${id}&mailbox=${activeMailbox}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setFehler('Löschen fehlgeschlagen: ' + (d.fehler ?? r.status))
    }
  }

  async function openMessage(msg: Msg) {
    setDeleteConfirm(false)
    setMoveMode(false); setMoveTarget('')
    setThreadMsgs([]); setForwardMode(false); setLeadDialog(false)
    if (msg.quelle !== 'm365') { setSelected({ ...msg, bodyHtml: null, bodyText: msg.vorschau, conversationId: null, kontaktInfo: null }); return }
    setDetailLaden(true); setSelected(null)
    const res = await fetch(`/api/nachrichten/message?id=${msg.id}&mailbox=${activeMailbox}`)
    const data = await res.json()
    setDetailLaden(false)
    if (data.fehler) return
    setSelected(data)
    // Gelesen markieren in Liste
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, gelesen: true } : m))
    // Thread-Nachrichten nachladen (cross-folder)
    if (data.conversationId) {
      setThreadLaden(true)
      fetch(`/api/nachrichten/conversation?id=${encodeURIComponent(data.conversationId)}&mailbox=${activeMailbox}`)
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
      body: JSON.stringify({
        an, cc, betreff, text, useSharedMailbox: sendVon === 'shared' && !!monitoredEmail,
        antwortAuf: antwortAuf ? { id: antwortAuf.id, modus: antwortAuf.modus, mailbox: antwortAuf.mailbox } : null,
        zitat: antwortAuf?.zitat ?? null,
      }),
    })
    const data = await res.json()
    if (!res.ok || data.fehler) { setSendResult('Fehler: ' + (data.fehler ?? 'Unbekannt')); setSending(false); return }
    setSendResult('Gesendet')
    setTimeout(() => { setCompose(false); setSendResult(null); setAn(''); setCc(''); setBetreff(''); setText(''); setAntwortAuf(null) }, 1500)
    setSending(false)
    if (folder === 'sent') ladeMessages()
  }

  if (verbunden === false) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-5">
        <Mail className="w-10 h-10 text-s112-muted" />
        <h2 className="text-xl font-semibold text-s112-text">Deine Mailbox verbinden</h2>
        <p className="text-sm text-s112-muted text-center max-w-md">
          Verbinde dein persönliches E-Mail-Konto um Nachrichten direkt in software:112 zu lesen und zu schreiben.
          Jeder User verbindet seine eigene Mailbox.
        </p>
        {fehler && <p className="text-sm text-s112-err-fg">{fehler}</p>}
        <a href="/api/auth/m365/user"
          className="flex items-center gap-2 bg-s112-teal text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-s112-blue-700">
          Mit Microsoft 365 verbinden
        </a>
        <div className="mt-4 pt-4 border-t border-s112-border space-y-2">
          <p className="text-xs font-medium text-s112-text-1">Optional: Funktionale Mailbox überwachen</p>
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
    return <div className="flex items-center justify-center h-48 text-s112-muted">Verbindung wird geprüft…</div>
  }

  return (
    <div ref={rahmenRef} style={{ height: rahmenHoehe ? `${rahmenHoehe}px` : undefined }}
      className="flex h-[calc(100vh-190px)] min-h-[420px] gap-0 border border-s112-border rounded-xl overflow-hidden">

      {/* ── Ordner-Sidebar ── */}
      <div className="w-44 flex-shrink-0 bg-s112-bg border-r border-s112-border flex flex-col">
        <div className="p-3">
          <button onClick={() => { setAntwortAuf(null); setCc(''); setAn(''); setBetreff(''); setText(''); setCompose(true) }}
            className="w-full bg-s112-teal text-white px-3 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 flex items-center justify-center gap-2">
            Verfassen
          </button>
        </div>
        {monitoredEmail && (
          <div className="px-3 pb-2 flex flex-col gap-1">
            <p className="text-[11px] text-s112-muted font-medium uppercase tracking-wide">Mailbox</p>
            <button onClick={() => setActiveMailbox('own')}
              className={`w-full text-left text-xs px-2 py-1.5 rounded-lg border transition-colors truncate
                ${activeMailbox === 'own' ? 'bg-s112-teal text-white border-s112-teal font-medium' : 'border-s112-border text-s112-text-2 hover:bg-white'}`}
              title={verbEmail || 'Eigene Mailbox'}>
              Eigene Mailbox
            </button>
            <button onClick={() => setActiveMailbox('shared')}
              className={`w-full text-left text-xs px-2 py-1.5 rounded-lg border transition-colors truncate
                ${activeMailbox === 'shared' ? 'bg-s112-teal text-white border-s112-teal font-medium' : 'border-s112-border text-s112-text-2 hover:bg-white'}`}
              title={monitoredEmail}>
              {monitoredEmail}
            </button>
          </div>
        )}
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {/* Echte Ordnerstruktur aus Mailbox */}
          {folders.length > 0 ? folders.map(f => (
            <button key={f.id} onClick={() => { setFolderId(f.id); setFolder('inbox'); setSelected(null) }}
              style={{ paddingLeft: `${12 + (f.depth ?? 0) * 14}px` }} title={f.name}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                ${folderId === f.id ? 'bg-s112-teal/10 text-s112-blue-700 font-medium' : 'text-s112-text-2 hover:bg-white'}`}>
              <span className="flex-shrink-0">{f.name === 'Inbox' || f.name === 'Posteingang' ? <Inbox className="w-3.5 h-3.5" /> : f.name === 'Sent Items' || f.name === 'Gesendete Elemente' ? <Send className="w-3.5 h-3.5" /> : f.name === 'Deleted Items' || f.name === 'Gelöschte Elemente' ? <Trash2 className="w-3.5 h-3.5" /> : f.name === 'Drafts' || f.name === 'Entwürfe' ? <FileText className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}</span>
              <span className="flex-1 text-left truncate text-xs">{f.name}</span>
              {f.unread > 0 && <span className="text-xs bg-s112-teal text-white px-1.5 py-0.5 rounded-full">{f.unread}</span>}
            </button>
          )) : (
            // Fallback wenn keine Ordner geladen
            ['inbox', 'sent'].map(id => (
              <button key={id} onClick={() => { setFolderId(null); setFolder(id as 'inbox'|'sent') }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                  ${folder === id && !folderId ? 'bg-s112-teal/10 text-s112-blue-700 font-medium' : 'text-s112-text-2 hover:bg-white'}`}>
                <span>{id === 'inbox' ? <Inbox className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}</span>
                <span className="flex-1 text-left">{id === 'inbox' ? 'Posteingang' : 'Gesendet'}</span>
              </button>
            ))
          )}
        </nav>
        <div className="p-3 border-t border-s112-border">
          <button onClick={ladeMessages} disabled={laden}
            className="w-full text-xs text-s112-muted hover:text-s112-blue-700 py-1">
            {laden ? 'Laden…' : 'Aktualisieren'}
          </button>
          <button onClick={() => setShowSettings(v => !v)}
            className="w-full text-xs text-s112-muted hover:text-s112-blue-700 py-1">
            Einstellungen
          </button>
          {showSettings && (
            <div className="mt-2 pt-2 border-t border-s112-border space-y-2">
              <div className="space-y-1">
                <p className="text-[11px] text-s112-muted font-medium uppercase tracking-wide">Verbindung</p>
                <button onClick={async () => {
                  await fetch('/api/nachrichten/disconnect', { method: 'POST' })
                  window.location.reload()
                }} className="w-full text-[11px] border border-s112-err/30 text-s112-err px-2 py-1 rounded hover:bg-s112-err-bg">
                  Trennen &amp; neu verbinden
                </button>
              </div>
              {/* CRM-Spiegelung: Stand + manueller Lauf (18.9.2026) */}
              <div className="space-y-1">
                <p className="text-[11px] text-s112-muted font-medium uppercase tracking-wide">CRM-Spiegelung</p>
                <p className="text-[11px] text-s112-muted">E-Mails bekannter Kontakte/Firmen als Aktivität. {spiegelInfo ? `Stand: ${spiegelInfo}` : 'Noch nicht gelaufen.'}</p>
                {/* Antwort: { postfaecher, nachrichten, angelegt, fehler: string[] } - fehler ist
                    ein Array (auch leer), ein String nur bei 401/500 */}
                <button disabled={spiegelLaeuft} onClick={() => spiegeln(false)}
                  className="w-full text-[11px] border border-s112-border text-s112-text-2 px-2 py-1 rounded hover:bg-s112-bg disabled:opacity-50">
                  {spiegelLaeuft ? 'Läuft …' : 'Jetzt spiegeln'}
                </button>
                <button disabled={spiegelLaeuft} onClick={() => spiegeln(true)} title="Stand zurücksetzen und die letzten 90 Tage komplett neu prüfen - z.B. nachdem eine geteilte Mailbox erst nachträglich lesbar wurde"
                  className="w-full text-[11px] text-s112-muted hover:text-s112-blue-700 disabled:opacity-50">
                  Letzte 90 Tage erneut prüfen
                </button>
              </div>
              <p className="text-[11px] text-s112-muted font-medium uppercase tracking-wide">Weitere Mailbox</p>
              <p className="text-[11px] text-s112-muted">z.B. office@weingut.at – Vollzugriff in Exchange nötig</p>
              <div className="space-y-1">
                <input value={monitoredEmail} onChange={e => setMonitoredEmail(e.target.value)}
                  placeholder="office@weingut.at"
                  className="w-full border border-s112-border rounded px-2 py-1 text-[11px] focus:outline-none" />
                <button onClick={async () => {
                  setMonitoredSaving(true)
                  await fetch('/api/nachrichten/monitored', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ monitored_email: monitoredEmail || null }),
                  })
                  setMonitoredSaving(false); setShowSettings(false)
                  window.location.reload()
                }} disabled={monitoredSaving}
                  className="w-full text-[11px] bg-s112-teal text-white px-2 py-1 rounded hover:bg-opacity-90 disabled:opacity-40">
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
          <p className="text-sm font-semibold text-s112-text">
            {folderId
              ? (folders.find(f => f.id === folderId)?.name ?? 'Posteingang')
              : folder === 'inbox' ? 'Posteingang' : 'Gesendet'}
          </p>
          <p className="text-xs text-s112-muted">{messages.length} Nachrichten</p>
        </div>
        {fehler && <p className="text-xs text-s112-err px-4 py-2">{fehler}</p>}
        <div className="flex-1 overflow-y-auto divide-y divide-s112-border/40">
          {messages.map(msg => (
            <div key={msg.id} onClick={() => openMessage(msg)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMessage(msg) } }}
              className={`group relative w-full text-left px-4 py-3 hover:bg-s112-bg/50 transition-colors cursor-pointer
                ${selected?.id === msg.id ? 'bg-s112-teal/5 border-l-2 border-s112-teal' : ''}
                ${!msg.gelesen ? 'bg-s112-blue-50/30' : ''}`}>
              {/* Papierkorb bei Hover: löschen und zur nächsten Nachricht springen */}
              <button type="button" onClick={e => { e.stopPropagation(); void loescheNachricht(msg.id) }}
                title="In Gelöschte Elemente verschieben"
                className="absolute right-2 bottom-2 hidden group-hover:inline-flex items-center justify-center w-6 h-6 rounded-md bg-white border border-s112-border text-s112-muted hover:text-s112-err hover:border-s112-err/40 shadow-sm">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className={`text-xs truncate ${!msg.gelesen ? 'font-semibold text-s112-text' : 'font-medium text-s112-text-1'}`}>
                  {folder === 'sent' ? msg.an : (msg.vonName || msg.von)}
                  {folder !== 'sent' && msg.absender === 'unbekannt' && <span title="Absender nicht im CRM – Lead anlegen?" className="ml-1.5 align-middle inline-block text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded bg-s112-warn-bg text-s112-warn-fg">neu</span>}
                  {folder !== 'sent' && msg.absender === 'lead' && <span title="Lead im CRM" className="ml-1.5 align-middle inline-block text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded bg-s112-blue-50 text-s112-blue-700">lead</span>}
                </p>
                <p className="text-[11px] text-s112-muted flex-shrink-0">{fmtDate(msg.datum)}</p>
              </div>
              <p className={`text-xs truncate ${!msg.gelesen ? 'font-semibold text-s112-text' : 'text-s112-text-1'}`}>{msg.betreff}</p>
              {msg.vorschau && <p className="text-[11px] text-s112-muted truncate mt-0.5 group-hover:pr-7">{msg.vorschau}</p>}
            </div>
          ))}
          {!laden && messages.length === 0 && !fehler && (
            <p className="text-center text-s112-muted text-xs py-8">Keine Nachrichten</p>
          )}
          {!laden && hatMehr && (
            <button onClick={ladeWeitere} disabled={mehrLaden}
              className="w-full text-xs text-s112-blue-700 hover:bg-s112-bg/60 py-3 disabled:opacity-50">
              {mehrLaden ? 'Lade ältere Nachrichten…' : 'Ältere Nachrichten laden'}
            </button>
          )}
        </div>
      </div>

      {/* ── E-Mail-Inhalt ── */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {!selected && !detailLaden && !compose && (
          <div className="flex-1 flex items-center justify-center text-s112-muted text-sm">
            E-Mail aus der Liste wählen oder Verfassen klicken
          </div>
        )}
        {detailLaden && (
          <div className="flex-1 flex items-center justify-center text-s112-muted text-sm">E-Mail wird geladen…</div>
        )}
        {selected && forwardMode && (
          <div className="flex-1 flex flex-col p-6 gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-s112-text">Weiterleiten</h3>
              <button onClick={() => setForwardMode(false)} className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
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
              {sending ? 'Senden…' : 'Weiterleiten'}
            </button>
          </div>
        )}
        {selected && !forwardMode && !compose && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-s112-border">
              <h2 className="text-base font-semibold text-s112-text mb-2">{selected.betreff}</h2>
              <div className="text-xs text-s112-muted space-y-0.5">
                <p><span className="font-medium text-s112-text-1">Von:</span> {selected.vonName} &lt;{selected.von}&gt;</p>
                {selected.an && <p><span className="font-medium text-s112-text-1">An:</span> {selected.an}</p>}
                <p><span className="font-medium text-s112-text-1">Datum:</span> {new Date(selected.datum).toLocaleString('de-AT')}</p>
              </div>
              {/* Namensgleicher Kontakt/Firma unter anderer Adresse → Adresse hinzufügen statt Lead anlegen */}
              {selected.leadVorschlag && !selected.kontaktInfo && (selected.namensTreffer?.length ?? 0) > 0 && !leadSpaeter.has(selected.von.toLowerCase()) && (
                <div className="mt-3 rounded-lg border border-s112-warn/40 bg-s112-warn-bg px-3.5 py-2.5 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <UserPlus className="w-4 h-4 text-s112-warn-fg shrink-0 mt-0.5" />
                    <span className="text-xs text-s112-text">
                      <b>{selected.vonName || selected.von}</b> schreibt von <span className="font-mono">{selected.von}</span> – im CRM gibt es bereits
                      {selected.namensTreffer!.length === 1 ? ' einen Eintrag' : ' Einträge'} mit diesem Namen{selected.namensTreffer!.some(t => t.email) ? ' unter anderer Adresse' : ' (noch ohne E-Mail)'}. Diese Adresse dort hinzufügen?
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-6">
                    {selected.namensTreffer!.map(t => (
                      <button key={t.id} disabled={emailHinzu} onClick={async () => {
                        setEmailHinzu(true)
                        const r = await emailHinzufuegen(t.typ, t.id, selected.von)
                        setEmailHinzu(false)
                        if (r.error) { setFehler('Adresse konnte nicht hinzugefügt werden: ' + r.error); return }
                        const info = { typ: t.typ, id: t.id, name: t.name, accountnummer: t.accountnummer, istLead: t.istLead, ueber: 'email' as const }
                        setSelected(prev => prev ? { ...prev, leadVorschlag: false, namensTreffer: [], kontaktInfo: info } : prev)
                        setMessages(prev => prev.map(m => m.von.toLowerCase() === selected.von.toLowerCase() ? { ...m, absender: t.istLead ? 'lead' : t.typ } : m))
                      }} className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-opacity-90 disabled:opacity-50"
                        title={t.email ? `bisher: ${t.email}` : 'bisher ohne E-Mail-Adresse'}>
                        Ja, zu {t.name}{t.accountnummer ? ` (${t.accountnummer})` : ''}{t.typ === 'firma' ? ' · Firma' : ''} hinzufügen
                      </button>
                    ))}
                    <button onClick={() => setLeadDialog(true)} className="text-xs border border-s112-line-str text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-white">Nein, neuer Lead</button>
                    <button onClick={() => setLeadSpaeter(prev => new Set(prev).add(selected.von.toLowerCase()))} className="text-xs text-s112-text-2 px-2 py-1.5 rounded-lg hover:bg-white">Jetzt nicht</button>
                  </div>
                </div>
              )}
              {selected.leadVorschlag && !selected.kontaktInfo && !(selected.namensTreffer?.length) && !leadSpaeter.has(selected.von.toLowerCase()) && (
                <div className="mt-3 rounded-lg border border-s112-teal/40 bg-s112-blue-50 px-3.5 py-2.5 flex flex-wrap items-center gap-2">
                  <UserPlus className="w-4 h-4 text-s112-teal shrink-0" />
                  <span className="text-xs text-s112-text flex-1 min-w-[12rem]"><b>{selected.vonName || selected.von}</b> ist weder Kunde noch Lead. Soll ein Lead angelegt werden?</span>
                  <button onClick={() => setLeadDialog(true)} className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-opacity-90">Ja, Lead anlegen</button>
                  <button onClick={() => setLeadSpaeter(prev => new Set(prev).add(selected.von.toLowerCase()))} className="text-xs border border-s112-line-str text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-white">Jetzt nicht</button>
                  <button disabled={leadIgnoriere} onClick={async () => {
                    setLeadIgnoriere(true)
                    const r = await ignoriereAbsender(selected.von)
                    setLeadIgnoriere(false)
                    if (r.error) { setFehler('Konnte Absender nicht merken: ' + r.error); return }
                    setSelected(prev => prev ? { ...prev, leadVorschlag: false } : prev)
                    setMessages(prev => prev.map(m => m.von.toLowerCase() === selected.von.toLowerCase() ? { ...m, absender: 'ignoriert' } : m))
                  }} className="text-xs text-s112-text-2 px-2 py-1.5 rounded-lg hover:bg-white hover:text-s112-text disabled:opacity-50" title="Für diesen Absender nicht mehr fragen (z. B. Newsletter, Lieferant)">Nein, nicht mehr fragen</button>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                  {selected.kontaktInfo && (
                    <Link href={`/crm/${selected.kontaktInfo.typ === 'firma' ? 'firmen' : 'kontakte'}/${selected.kontaktInfo.id}`}
                      title={selected.kontaktInfo.ueber === 'domain' ? 'Über die Firmendomain zugeordnet' : undefined}
                      className="text-xs text-s112-blue-700 border border-s112-border px-3 py-1.5 rounded-lg hover:bg-s112-bg inline-flex items-center gap-1.5">
                      {selected.kontaktInfo.name}
                      {selected.kontaktInfo.istLead && <span className="text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded bg-s112-blue-50 text-s112-blue-700">Lead</span>}
                    </Link>
                  )}
                  {selected.leadVorschlag && !selected.kontaktInfo && leadSpaeter.has(selected.von.toLowerCase()) && (
                    <button onClick={() => setLeadDialog(true)} className="text-xs border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-s112-bg inline-flex items-center gap-1"><UserPlus className="w-3.5 h-3.5" /> Lead anlegen</button>
                  )}
                  <button onClick={() => antworten(selected, 'reply')}
                    className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg hover:bg-opacity-90">
                    Antworten
                  </button>
                  <button onClick={() => antworten(selected, 'replyAll')} title="Antwort an Absender und alle weiteren Empfänger (An + CC)"
                    className="text-xs border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-s112-bg">
                    Allen antworten
                  </button>
                  <button onClick={() => { setForwardMode(true); setForwardAn(''); setCompose(false) }}
                    className="text-xs border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-s112-bg">
                    Weiterleiten
                  </button>
                  {!moveMode ? (
                    <button onClick={() => { setMoveMode(true); setMoveTarget('') }} title="In Ordner verschieben"
                      className="text-xs border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg hover:bg-s112-bg flex items-center gap-1">
                      <Folder className="w-3.5 h-3.5" /> Verschieben
                    </button>
                  ) : (
                    <span className="flex items-center gap-1">
                      <select value={moveTarget} onChange={e => setMoveTarget(e.target.value)}
                        className="text-xs border border-s112-border rounded-lg px-2 py-1.5 focus:outline-none max-w-[9rem]">
                        <option value="">Zielordner…</option>
                        {folders.filter(f => f.id !== folderId).map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                      <button onClick={async () => {
                        if (!moveTarget) return
                        const moveId = selected.id
                        setMoving(true)
                        const r = await fetch('/api/nachrichten/move', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: moveId, destinationId: moveTarget, mailbox: activeMailbox }),
                        })
                        setMoving(false)
                        if (!r.ok) {
                          const d = await r.json().catch(() => ({}))
                          setFehler('Verschieben fehlgeschlagen: ' + (d.fehler ?? r.status))
                          return
                        }
                        setMoveMode(false); setMoveTarget('')
                        loadGenRef.current++  // in-flight ladeMessages ignorieren
                        setMessages(prev => prev.filter(m => m.id !== moveId))
                        setSelected(null)
                        ladeFolders(activeMailbox)  // Ordner-Zähler aktualisieren
                      }} disabled={moving || !moveTarget}
                        className="text-xs bg-s112-teal text-white px-2 py-1 rounded hover:bg-opacity-90 disabled:opacity-40">
                        {moving ? '…' : 'OK'}
                      </button>
                      <button onClick={() => setMoveMode(false)}
                        className="text-xs border border-s112-line-str text-s112-text-2 px-2 py-1 rounded hover:bg-s112-bg">Abbrechen</button>
                    </span>
                  )}
                  {!deleteConfirm ? (
                    <button onClick={() => setDeleteConfirm(true)} title="Löschen"
                      className="border border-s112-err/30 text-s112-err p-1.5 rounded-lg hover:bg-s112-err-bg hover:text-s112-err-fg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                  ) : (
                    <span className="flex items-center gap-1">
                      <span className="text-xs text-s112-err">Löschen?</span>
                      <button onClick={() => loescheNachricht(selected.id)} className="text-xs bg-s112-err text-white px-2 py-1 rounded hover:bg-s112-err-fg">Ja</button>
                      <button onClick={() => setDeleteConfirm(false)}
                        className="text-xs border border-s112-line-str text-s112-text-2 px-2 py-1 rounded hover:bg-s112-bg">Nein</button>
                    </span>
                  )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {/* ── Thread-Nachrichten (andere Folder) ── */}
              {(threadLaden || threadMsgs.length > 0) && (
                <div className="border-t border-s112-border mt-4 pt-4">
                  <p className="text-xs font-medium text-s112-muted mb-3 uppercase tracking-wide">
                    Weitere Nachrichten in diesem Thread{threadLaden ? ' – lädt…' : ''}
                  </p>
                  <div className="space-y-3">
                    {threadMsgs.map(tm => (
                      <div key={tm.id} className="border border-s112-border rounded-xl p-4 hover:bg-s112-bg/30 cursor-pointer"
                        onClick={() => openMessage(tm)}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-s112-text">{tm.vonName || tm.von}</span>
                          <span className="text-[11px] text-s112-muted">{fmtDate(tm.datum)}</span>
                        </div>
                        <p className="text-xs text-s112-text-1 truncate">{tm.betreff}</p>
                        {tm.vorschau && <p className="text-[11px] text-s112-muted mt-1 line-clamp-2">{tm.vorschau}</p>}
                        <div className="flex gap-2 mt-2">
                          <button onClick={e => { e.stopPropagation(); antworten(tm, 'reply') }}
                            className="text-[11px] text-s112-blue-700 border border-s112-teal/30 px-2 py-0.5 rounded hover:bg-s112-teal/5">
                            Antworten
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(selected.anhaenge?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {selected.anhaenge!.map(a => (
                    <a key={a.id}
                      href={`/api/nachrichten/anhang?id=${encodeURIComponent(selected.id)}&aid=${encodeURIComponent(a.id)}&mailbox=${selected.mailbox ?? activeMailbox}`}
                      download={a.name}
                      className="inline-flex items-center gap-1.5 text-xs border border-s112-border rounded-lg px-2.5 py-1.5 text-s112-text-1 hover:bg-s112-bg/40 hover:border-s112-blue-700/40"
                      title={a.typ}>
                      <Paperclip className="w-3.5 h-3.5 text-s112-muted" />
                      <span className="max-w-[16rem] truncate">{a.name}</span>
                      <span className="text-s112-muted">{fmtGroesse(a.groesse)}</span>
                    </a>
                  ))}
                </div>
              )}
              {selected.bodyHtml ? (
                // KAN-137: gemeinsame Sandbox-Anzeige – ohne allow-same-origin (die Höhe
                // kommt ohnehin aus dem Layout, nicht aus dem Inhalt)
                <EmailHtmlAnzeige html={selected.bodyHtml}
                  className="w-full min-h-96 border-0"
                  style={{ height: '100%', minHeight: '400px' }}
                />
              ) : (
                <pre className="text-sm text-s112-text-1 whitespace-pre-wrap font-sans leading-relaxed">{selected.bodyText}</pre>
              )}
            </div>
          </div>
        )}

        {/* ── Verfassen ── */}
        {compose && (
          <div className="flex-1 min-h-0 flex flex-col p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-s112-text flex items-center gap-2"><Mail className="w-4 h-4" /> {antwortAuf ? (antwortAuf.modus === 'replyAll' ? 'Allen antworten' : 'Antworten') : 'Neue E-Mail verfassen'}</h2>
              <button aria-label="Verfassen schließen" onClick={() => { setCompose(false); setSendResult(null); setAntwortAuf(null); setCc('') }}
                className="text-s112-muted hover:text-s112-text-1"><X className="w-4 h-4" /></button>
            </div>
            {/* min-h-0 + scrollbarer Rahmen (18.9.2026): bei 100 % Zoom auf kleineren
                Bildschirmen lagen Senden/Abbrechen unter dem Rand, weil die Textarea
                über rows eine feste Mindesthöhe erzwang */}
            <form onSubmit={sendEmail} className="flex-1 min-h-0 flex flex-col gap-3">
              {monitoredEmail && (
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Von</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSendVon('own')}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sendVon === 'own' ? 'bg-s112-teal text-white border-s112-teal' : 'border-s112-border text-s112-text-2 hover:bg-s112-bg'}`}>
                      Eigene Mailbox
                    </button>
                    <button type="button" onClick={() => setSendVon('shared')}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sendVon === 'shared' ? 'bg-s112-teal text-white border-s112-teal' : 'border-s112-border text-s112-text-2 hover:bg-s112-bg'}`}>
                      {monitoredEmail}
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">An * <span className="font-normal text-s112-muted">(mehrere mit Komma trennen)</span></label>
                <EmailEingabe value={an} onChange={setAn} required
                  placeholder="Name oder Adresse tippen – Vorschläge aus dem CRM"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">CC <span className="font-normal text-s112-muted">(optional, mehrere mit Komma trennen)</span></label>
                <EmailEingabe value={cc} onChange={setCc}
                  placeholder="kopie@email.at"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Betreff *</label>
                <input aria-label="Betreff" value={betreff} onChange={e => setBetreff(e.target.value)} required
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Nachricht</label>
                <textarea aria-label="Nachricht" value={text} onChange={e => setText(e.target.value)} rows={4} autoFocus={!!antwortAuf}
                  className="flex-1 min-h-[120px] border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
              </div>
              {antwortAuf && (
                <div className="rounded-lg border border-s112-line bg-s112-bg px-3 py-2">
                  <p className="text-[11px] text-s112-text-2 mb-1">Die Originalnachricht von <b className="text-s112-text">{antwortAuf.von}</b> wird unter deiner Antwort mitgeschickt (Vorschau):</p>
                  <pre className="text-[11px] text-s112-text-2 whitespace-pre-wrap max-h-32 overflow-y-auto font-sans">{antwortAuf.zitat.slice(0, 1500)}{antwortAuf.zitat.length > 1500 ? '\n…' : ''}</pre>
                </div>
              )}
              {sendResult && <p className={`text-sm font-medium ${sendResult.startsWith('Fehler') ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>{sendResult}</p>}
              <div className="flex gap-2 shrink-0 pt-1">
                <button type="submit" disabled={sending}
                  className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
                  {sending ? 'Senden…' : 'Senden'}
                </button>
                <button type="button" onClick={() => { setCompose(false); setAntwortAuf(null); setCc('') }}
                  className="text-sm px-4 py-2 rounded-xl border border-s112-border text-s112-text-2 hover:bg-s112-bg">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
      {leadDialog && selected && (
        <LeadDialog
          mail={{ id: selected.id, conversationId: selected.conversationId, betreff: selected.betreff, von: selected.von, vonName: selected.vonName, an: selected.an, datum: selected.datum, bodyText: selected.bodyText ?? '', bodyHtml: selected.bodyHtml, mailbox: selected.mailbox ?? activeMailbox }}
          onClose={() => setLeadDialog(false)}
          onAngelegt={info => {
            // Kopfzeile sofort auf „bekannt“ stellen und alle Mails dieses Absenders in der Liste als Lead markieren
            setSelected(prev => prev && prev.id === selected.id ? { ...prev, leadVorschlag: false, kontaktInfo: { typ: 'kontakt', id: info.id, name: info.name, accountnummer: null, istLead: true, ueber: 'email' } } : prev)
            setMessages(prev => prev.map(m => m.von.toLowerCase() === selected.von.toLowerCase() ? { ...m, absender: 'lead' } : m))
          }}
        />
      )}
    </div>
  )
}
