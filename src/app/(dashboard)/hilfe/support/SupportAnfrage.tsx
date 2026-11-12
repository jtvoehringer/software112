'use client'

// KAN-230 Phase 2: „Problem melden“ und die Anfragen auf der Support-Seite. Daten über
// /api/support/anfragen (Jira Service Management, Projekt SUP); der Screenshot geht nur mit Haken mit.
// KAN-438: „Support-Anfragen“ zeigt alle Anfragen der Betriebe des Benutzers in der Darstellung der Hohenstein Suite.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import AnfrageVerlauf from './AnfrageVerlauf'
import SupportTickets from '@/components/support/SupportTickets'
import type { SupportTicket } from '@/lib/support/tickets'
import { screenshotFehler } from '@/lib/support/anfrage'
import { fehlerText } from '@/lib/fehler'

type Option = { wert: string; label: string }
type Stand = { aktiv: boolean; arten: Option[]; dringlichkeiten: Option[]; anfragen: SupportTicket[]; heute?: string; fehler?: string }

/** Herkunftsseite: Pfad der vorigen Seite in software:112 (ohne Query), sonst die Support-Seite */
function herkunft(): string {
  try {
    const r = document.referrer ? new URL(document.referrer) : null
    if (r && r.origin === location.origin && r.pathname !== location.pathname) return r.pathname
  } catch { /* egal */ }
  return location.pathname
}

export default function SupportAnfrage({ emailFallback }: { emailFallback: string | null }) {
  const [stand, setStand] = useState<Stand | null>(null)
  const [ladeFehler, setLadeFehler] = useState<string | null>(null)
  const [art, setArt] = useState('')
  const [betreff, setBetreff] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [dringlichkeit, setDringlichkeit] = useState('normal')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [vorschau, setVorschau] = useState<string | null>(null)
  const [zustimmung, setZustimmung] = useState(false)
  const [sendet, setSendet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState<{ key: string; link: string; hinweise: string[] } | null>(null)
  const dateiRef = useRef<HTMLInputElement>(null)
  // KAN-234: Anhang per Knopf, Ziehen oder Einfügen (Strg+V) – mit sofortiger Prüfung von Typ und Größe
  const [ziehen, setZiehen] = useState(false)
  const [dateiFehler, setDateiFehler] = useState<string | null>(null)

  const [ladeZaehler, setLadeZaehler] = useState(0)
  // KAN-235: aufgeklappte Anfrage (Verlauf in software:112 statt Portal-Link)
  const [offen, setOffen] = useState<string | null>(null)
  const laden = useCallback(() => setLadeZaehler(z => z + 1), [])

  useEffect(() => {
    let abgebrochen = false
    fetch('/api/support/anfragen', { cache: 'no-store' })
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.fehler ?? `HTTP ${r.status}`)
        return d as Stand
      })
      .then(d => {
        if (abgebrochen) return
        setStand(d)
        setArt(a => a || d.arten?.[0]?.wert || '')
      })
      .catch(e => { if (!abgebrochen) setLadeFehler(fehlerText(e)) })
    return () => { abgebrochen = true }
  }, [ladeZaehler])
  useEffect(() => () => { if (vorschau) URL.revokeObjectURL(vorschau) }, [vorschau])

  const dateiWaehlen = (f: File | null) => {
    if (vorschau) URL.revokeObjectURL(vorschau)
    setScreenshot(f)
    setVorschau(f ? URL.createObjectURL(f) : null)
    setZustimmung(false)
  }

  /** Bild übernehmen (Auswahl, Ziehen, Einfügen) – ungültige Dateien mit Meldung abweisen */
  const bildUebernehmen = (f: File | null | undefined) => {
    if (!f) return
    const fehlerText = screenshotFehler({ typ: f.type, groesse: f.size })
    setDateiFehler(fehlerText)
    if (fehlerText) return
    dateiWaehlen(f)
  }
  const anhangEntfernen = () => {
    dateiWaehlen(null)
    setDateiFehler(null)
    if (dateiRef.current) dateiRef.current.value = ''
  }
  /** Strg+V im Formular: ein Bild aus der Zwischenablage wird zum Screenshot (Text wird normal eingefügt) */
  const einfuegen = (e: React.ClipboardEvent) => {
    const bild = [...e.clipboardData.files].find(f => f.type.startsWith('image/'))
    if (!bild) return
    e.preventDefault()
    bildUebernehmen(bild)
  }

  const senden = async (e: React.FormEvent) => {
    e.preventDefault()
    setFehler(null)
    setSendet(true)
    try {
      const fd = new FormData()
      fd.append('art', art)
      fd.append('betreff', betreff)
      fd.append('beschreibung', beschreibung)
      fd.append('dringlichkeit', dringlichkeit)
      fd.append('seite', herkunft())
      if (screenshot) {
        fd.append('screenshot', screenshot)
        fd.append('screenshot_zustimmung', zustimmung ? '1' : '0')
      }
      const r = await fetch('/api/support/anfragen', { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.fehler ?? `Fehler ${r.status}`)
      setErfolg(d)
      setBetreff(''); setBeschreibung(''); setDringlichkeit('normal'); anhangEntfernen()
      laden()
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      setSendet(false)
    }
  }

  if (ladeFehler) return <p className="text-sm text-s112-err-fg">Support-Anfragen konnten nicht geladen werden: {ladeFehler}</p>
  if (!stand) return <p className="text-sm text-s112-muted">Wird geladen …</p>
  if (!stand.aktiv) return null

  return (
    <div className="space-y-4">
      <section className="card p-5 space-y-3 max-w-3xl">
        <h2 className="text-base font-semibold text-s112-text">Problem melden</h2>
        <p className="text-sm text-s112-text-2">
          Ihre Anfrage geht direkt an unser Support-Team. Bearbeitungsstand und Antworten sehen Sie unten unter
          „Support-Anfragen“ – dort können Sie auch antworten. Bei jeder Antwort des Supports kommt zusätzlich eine E-Mail.
        </p>

        {erfolg && (
          <div className="rounded-lg bg-s112-ok-bg text-s112-ok-fg p-3 text-sm space-y-1" role="status">
            <p>Danke! Ihre Anfrage <strong>{erfolg.key}</strong> ist eingegangen – Sie finden sie unten unter „Support-Anfragen“.</p>
            {erfolg.hinweise.map(h => <p key={h}>{h}</p>)}
          </div>
        )}
        {fehler && <p className="text-sm text-s112-err-fg" role="alert">{fehler}</p>}

        <form onSubmit={senden} onPaste={einfuegen} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm space-y-1 block">
              <span className="text-s112-text-2">Art der Anfrage</span>
              <select value={art} onChange={e => setArt(e.target.value)} className="form-input w-full" required>
                {stand.arten.map(a => <option key={a.wert} value={a.wert}>{a.label}</option>)}
              </select>
            </label>
            <label className="text-sm space-y-1 block">
              <span className="text-s112-text-2">Dringlichkeit (Ihr Vorschlag)</span>
              <select value={dringlichkeit} onChange={e => setDringlichkeit(e.target.value)} className="form-input w-full">
                {stand.dringlichkeiten.map(d => <option key={d.wert} value={d.wert}>{d.label}</option>)}
              </select>
            </label>
          </div>
          <label className="text-sm space-y-1 block">
            <span className="text-s112-text-2">Betreff</span>
            <input value={betreff} onChange={e => setBetreff(e.target.value)} maxLength={200} required minLength={3}
              placeholder="z. B. Füllung lässt sich nicht speichern" className="form-input w-full" />
          </label>
          <label className="text-sm space-y-1 block">
            <span className="text-s112-text-2">Beschreibung</span>
            <textarea value={beschreibung} onChange={e => setBeschreibung(e.target.value)} rows={6} maxLength={10000} required minLength={10}
              placeholder="Was haben Sie gemacht, was ist passiert, was hätten Sie erwartet?" className="form-input w-full" />
          </label>
          <div className="text-sm space-y-2">
            <span id="support-anhang-titel" className="text-s112-text-2 block">Screenshot (optional, PNG/JPG/WebP, höchstens 5 MB)</span>
            <input ref={dateiRef} id="support-anhang" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
              aria-labelledby="support-anhang-titel" onChange={e => bildUebernehmen(e.target.files?.[0])} />
            <div
              onDragOver={e => { e.preventDefault(); setZiehen(true) }}
              onDragLeave={() => setZiehen(false)}
              onDrop={e => { e.preventDefault(); setZiehen(false); bildUebernehmen(e.dataTransfer.files?.[0]) }}
              className={`rounded-lg border-2 border-dashed px-4 py-3 flex flex-wrap items-center gap-3 transition-colors ${ziehen ? 'border-s112-teal bg-s112-bg' : 'border-s112-line'}`}>
              <button type="button" onClick={() => dateiRef.current?.click()}
                className="inline-flex items-center gap-2 border border-s112-line-str bg-white text-s112-text-1 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-bg">
                <Paperclip className="w-4 h-4" aria-hidden /> {screenshot ? 'Anderen Screenshot wählen' : 'Screenshot anhängen'}
              </button>
              <span className="text-xs text-s112-muted min-w-0 truncate">
                {screenshot ? screenshot.name || 'Bild aus der Zwischenablage' : 'oder Bild hierher ziehen bzw. mit Strg+V einfügen'}
              </span>
              {screenshot && (
                <button type="button" onClick={anhangEntfernen} className="inline-flex items-center gap-1 text-xs text-s112-err-fg hover:underline">
                  <X className="w-3 h-3" aria-hidden /> Entfernen
                </button>
              )}
            </div>
            {dateiFehler && <p className="text-xs text-s112-err-fg" role="alert">{dateiFehler}</p>}
            {vorschau && (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={vorschau} alt="Vorschau des Screenshots" className="max-h-48 rounded border border-s112-line" />
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={zustimmung} onChange={e => setZustimmung(e.target.checked)} className="mt-1" />
                  <span>Screenshot mitsenden. Mir ist bewusst, dass er Daten unseres Betriebs (z. B. Kundendaten) enthalten kann.</span>
                </label>
              </div>
            )}
          </div>
          <p className="text-xs text-s112-muted">
            Mitgesendet werden Betrieb, Ihr Name, Ihre Rolle, die zuletzt geöffnete Seite, der Browser und die App-Version – keine Passwörter oder Zugangsdaten.
          </p>
          <button type="submit" disabled={sendet || (!!screenshot && !zustimmung)}
            className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
            <Send className="w-4 h-4" aria-hidden /> {sendet ? 'Wird gesendet …' : 'Anfrage senden'}
          </button>
        </form>
      </section>

      {/* KAN-438: alle Anfragen der Betriebe des Benutzers – volle Breite, die übrigen Karten bleiben schmal */}
      <section className="card p-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-s112-text">Support-Anfragen</h2>
          <p className="text-xs text-s112-muted mt-0.5">Alle Anfragen Ihrer Betriebe – auch die Ihrer Kolleginnen und Kollegen. Im Verlauf können Sie mitlesen und antworten.</p>
        </div>
        {stand.fehler && <p role="alert" className="text-sm text-s112-err-fg">{stand.fehler}</p>}
        {stand.anfragen.length === 0 ? (
          !stand.fehler && <p className="text-sm text-s112-muted">Noch keine Anfragen.{emailFallback && <> Alternativ erreichen Sie uns unter {emailFallback}.</>}</p>
        ) : (
          <SupportTickets tickets={stand.anfragen} heute={stand.heute ?? ''} offen={offen}
            onVerlauf={key => setOffen(o => (o === key ? null : key))}
            verlauf={t => <AnfrageVerlauf anfrageKey={t.key} onGeaendert={laden} />} />
        )}
      </section>
    </div>
  )
}
