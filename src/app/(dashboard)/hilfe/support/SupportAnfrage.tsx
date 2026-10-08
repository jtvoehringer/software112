'use client'

// KAN-230 Phase 2: „Problem melden“ und „Meine Anfragen“ auf der Support-Seite. Daten über
// /api/support/anfragen (Jira Service Management, Projekt SUP); der Screenshot geht nur mit Haken mit.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Send } from 'lucide-react'

type Option = { wert: string; label: string }
type Anfrage = { key: string; betreff: string; status: string; erledigt: boolean; erstellt: string; link: string }
type Stand = { aktiv: boolean; arten: Option[]; dringlichkeiten: Option[]; anfragen: Anfrage[]; fehler?: string }

const datum = (iso: string) => (iso ? new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')

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

  const [ladeZaehler, setLadeZaehler] = useState(0)
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
      .catch(e => { if (!abgebrochen) setLadeFehler((e as Error).message) })
    return () => { abgebrochen = true }
  }, [ladeZaehler])
  useEffect(() => () => { if (vorschau) URL.revokeObjectURL(vorschau) }, [vorschau])

  const dateiWaehlen = (f: File | null) => {
    if (vorschau) URL.revokeObjectURL(vorschau)
    setScreenshot(f)
    setVorschau(f ? URL.createObjectURL(f) : null)
    setZustimmung(false)
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
      setBetreff(''); setBeschreibung(''); setDringlichkeit('normal'); dateiWaehlen(null)
      if (dateiRef.current) dateiRef.current.value = ''
      laden()
    } catch (err) {
      setFehler((err as Error).message)
    } finally {
      setSendet(false)
    }
  }

  if (ladeFehler) return <p className="text-sm text-s112-err-fg">Support-Anfragen konnten nicht geladen werden: {ladeFehler}</p>
  if (!stand) return <p className="text-sm text-s112-muted">Wird geladen …</p>
  if (!stand.aktiv) return null

  return (
    <div className="space-y-4">
      <section className="card p-5 space-y-3">
        <h2 className="text-base font-semibold text-s112-text">Problem melden</h2>
        <p className="text-sm text-s112-text-2">
          Ihre Anfrage geht direkt an unser Support-Team. Sie bekommen eine E-Mail mit einem Link, unter dem Sie den
          Bearbeitungsstand sehen und antworten können.
        </p>

        {erfolg && (
          <div className="rounded-lg bg-s112-ok-bg text-s112-ok-fg p-3 text-sm space-y-1" role="status">
            <p>Danke! Ihre Anfrage <strong>{erfolg.key}</strong> ist eingegangen.{' '}
              <a href={erfolg.link} target="_blank" rel="noopener noreferrer" className="underline">Im Support-Portal ansehen</a></p>
            {erfolg.hinweise.map(h => <p key={h}>{h}</p>)}
          </div>
        )}
        {fehler && <p className="text-sm text-s112-err-fg" role="alert">{fehler}</p>}

        <form onSubmit={senden} className="space-y-3">
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
            <label className="space-y-1 block">
              <span className="text-s112-text-2">Screenshot (optional, PNG/JPG/WebP, höchstens 5 MB)</span>
              <input ref={dateiRef} type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => dateiWaehlen(e.target.files?.[0] ?? null)} className="block text-sm" />
            </label>
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

      <section className="card p-5 space-y-3">
        <h2 className="text-base font-semibold text-s112-text">Meine Anfragen</h2>
        {stand.fehler && <p className="text-sm text-s112-err-fg">{stand.fehler}</p>}
        {stand.anfragen.length === 0 ? (
          <p className="text-sm text-s112-muted">Noch keine Anfragen.{emailFallback && <> Alternativ erreichen Sie uns unter {emailFallback}.</>}</p>
        ) : (
          <ul className="divide-y divide-s112-line text-sm">
            {stand.anfragen.map(a => (
              <li key={a.key} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-s112-muted">{a.key}</span>
                <span className="flex-1 min-w-0 truncate">{a.betreff}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${a.erledigt ? 'bg-s112-ok-bg text-s112-ok-fg' : 'bg-s112-warn-bg text-s112-warn-fg'}`}>{a.status}</span>
                <span className="text-xs text-s112-muted tabular-nums">{datum(a.erstellt)}</span>
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-s112-blue-700 hover:underline inline-flex items-center gap-1" aria-label={`${a.key} im Support-Portal öffnen`}>
                  Öffnen <ExternalLink className="w-3 h-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
