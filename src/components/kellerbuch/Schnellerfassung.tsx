'use client'

// KAN-117 (07.10.2026): Schnellerfassung auf der Behälterseite – Ziel des QR-Codes am Gebinde (WLAN im Keller).
// Kacheln Behandlung, Analyse, Umziehen (bestehende Formulare), Schwund und Notiz (direkt hier), dazu Inhalt und die
// letzten Maßnahmen. Ohne Netz: eindeutige Meldung, der Entwurf bleibt im localStorage (keine Offline-Warteschlange).

import { useState, useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { FlaskConical, ArrowLeftRight, Droplet, StickyNote, Wrench, WifiOff } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { fmtLiter, zahlAus } from '@/lib/format'
import { schwundGrundFehler } from '@/lib/keller/gebindeAnzeige'
import {
  entwurfSchluessel, fuellgrad, inhaltLiter, notizFehler, schnellZiele,
  type Massnahme, type SchnellCharge,
} from '@/lib/keller/schnellerfassung'

type Formular = 'notiz' | 'schwund' | 'analyse' | null

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' })
const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const kachelCls = 'flex flex-col items-center justify-center gap-1 rounded-xl border border-s112-line bg-white px-2 py-3 text-sm font-medium text-s112-text hover:border-s112-teal hover:bg-s112-bg transition-colors min-h-[72px]'

// Netzstatus des Geräts (online/offline-Ereignisse); auf dem Server immer „online“
function abonniereNetz(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}

function leseEntwurf<T>(schluessel: string): T | null {
  try {
    const roh = window.localStorage.getItem(schluessel)
    return roh ? (JSON.parse(roh) as T) : null
  } catch { return null }
}
function schreibeEntwurf(schluessel: string, wert: unknown) {
  try { window.localStorage.setItem(schluessel, JSON.stringify(wert)) } catch { /* privater Modus: ohne Entwurf */ }
}
function loescheEntwurf(schluessel: string) {
  try { window.localStorage.removeItem(schluessel) } catch { /* egal */ }
}

export default function Schnellerfassung({
  behaelterId, volumenLiter, chargen, massnahmen, schreiben, nurLesenGrund,
  notizAction, schwundAction,
}: {
  behaelterId: string
  volumenLiter: number | null
  chargen: SchnellCharge[]
  massnahmen: Massnahme[]
  /** Schreibrecht im Kellerbuch und kein Nur-Lesen-Modus */
  schreiben: boolean
  /** Hinweis, warum nur gelesen werden kann (Leser, Nur-Lesen-Modus) */
  nurLesenGrund: string | null
  notizAction: (fd: FormData) => Promise<{ bestaetigung?: string; hinweis?: string } | void>
  schwundAction: (weinausbauId: string, fd: FormData) => Promise<void>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [offen, setOffen] = useState<Formular>(null)
  const online = useSyncExternalStore(abonniereNetz, () => navigator.onLine, () => true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const nk = entwurfSchluessel(behaelterId, 'notiz')
  const sk = entwurfSchluessel(behaelterId, 'schwund')
  const [notiz, setNotiz] = useState({ text: '', charge: '' })
  const [schwund, setSchwund] = useState({ menge: '', grund: '', charge: '', datum: '' })
  const [analyseCharge, setAnalyseCharge] = useState('')

  const liter = inhaltLiter(chargen)
  const grad = fuellgrad(liter, volumenLiter)
  const einzige = chargen.length === 1 ? chargen[0].id : ''
  const ziele = schnellZiele(behaelterId, einzige || null)

  function umschalten(f: Formular) {
    setFehler(null); setOk(null)
    // Entwurf vom letzten Versuch (z. B. ohne Netz) wieder einsetzen
    if (f === 'notiz' && !notiz.text) { const n = leseEntwurf<typeof notiz>(nk); if (n) setNotiz(n) }
    if (f === 'schwund' && !schwund.menge && !schwund.grund) { const e = leseEntwurf<typeof schwund>(sk); if (e) setSchwund(e) }
    setOffen(o => (o === f ? null : f))
  }

  function ohneNetz(): boolean {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFehler('Keine Verbindung zum Netz – nichts gespeichert. Der Entwurf bleibt auf diesem Gerät; bitte erneut senden, sobald das WLAN wieder da ist.')
      return true
    }
    return false
  }

  function notizSenden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null); setOk(null)
    const f = notizFehler(notiz.text)
    if (f) { setFehler(f); return }
    if (chargen.length > 1 && !notiz.charge) { setFehler('Bitte die Charge wählen, zu der die Notiz gehört.'); return }
    if (ohneNetz()) return
    const fd = new FormData()
    fd.set('behaelter_id', behaelterId)
    fd.set('datum', heute())
    fd.set('notiz', notiz.text)
    if (notiz.charge || einzige) fd.set('weinausbau_id', notiz.charge || einzige)
    startTransition(async () => {
      try {
        const erg = await notizAction(fd)
        if (erg && erg.bestaetigung) { setFehler(erg.bestaetigung); return }   // Typ „Notiz“ wirkt auf die Prüfnummer – nicht hier
        loescheEntwurf(nk)
        setNotiz({ text: '', charge: '' })
        setOffen(null)
        setOk(erg && 'hinweis' in erg && erg.hinweis ? `Notiz gespeichert. ${erg.hinweis}` : 'Notiz gespeichert.')
        router.refresh()
      } catch (err) {
        setFehler(navigator.onLine ? fehlerText(err, 'Notiz konnte nicht gespeichert werden')
          : 'Keine Verbindung zum Netz – nichts gespeichert. Der Entwurf bleibt auf diesem Gerät.')
      }
    })
  }

  function schwundSenden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null); setOk(null)
    const charge = schwund.charge || einzige
    const l = zahlAus(schwund.menge)
    if (!charge) { setFehler('Bitte die Charge wählen.'); return }
    if (l == null || l < 0.01) { setFehler('Bitte eine Schwundmenge von mindestens 0,01 L angeben.'); return }
    const gf = schwundGrundFehler(schwund.grund)
    if (gf) { setFehler(gf); return }
    const bestand = Number(chargen.find(c => c.id === charge)?.menge_liter ?? 0)
    if (l > bestand + 0.005) { setFehler(`Die Schwundmenge übersteigt den Bestand der Charge (${fmtLiter(bestand)}).`); return }
    if (bestand - l <= 0.01 && !window.confirm('Nach diesem Schwund ist die Charge leer und wird abgeschlossen. Fortfahren?')) return
    if (ohneNetz()) return
    const fd = new FormData()
    fd.set('menge', schwund.menge)
    fd.set('datum', schwund.datum || heute())
    fd.set('notiz', schwund.grund)
    startTransition(async () => {
      try {
        await schwundAction(charge, fd)
        loescheEntwurf(sk)
        setSchwund({ menge: '', grund: '', charge: '', datum: '' })
        setOffen(null)
        setOk(`Schwund von ${fmtLiter(l)} gebucht.`)
        router.refresh()
      } catch (err) {
        setFehler(navigator.onLine ? fehlerText(err, 'Schwund konnte nicht gebucht werden')
          : 'Keine Verbindung zum Netz – nichts gebucht. Der Entwurf bleibt auf diesem Gerät.')
      }
    })
  }

  const chargeAuswahl = (wert: string, setze: (v: string) => void, id: string) => chargen.length > 1 && (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-s112-text-2 mb-1">Charge *</label>
      <select id={id} value={wert} onChange={e => setze(e.target.value)} className={inputCls}>
        <option value="">– wählen –</option>
        {chargen.map(c => <option key={c.id} value={c.id}>{c.name ?? 'Charge'} ({fmtLiter(Number(c.menge_liter ?? 0))})</option>)}
      </select>
    </div>
  )

  return (
    <section aria-labelledby="schnell-titel" className="card p-4 space-y-4 mb-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 id="schnell-titel" className="text-base font-semibold text-s112-text">Schnellerfassung</h2>
        <p className="text-sm text-s112-text-2">
          {chargen.length === 0 ? 'Leer' : <>Inhalt <strong>{fmtLiter(liter)}</strong>{volumenLiter ? <> von {fmtLiter(volumenLiter)}{grad != null ? ` (${grad} %)` : ''}</> : null}</>}
        </p>
      </div>

      {chargen.length > 0 && (
        <ul className="text-sm space-y-1">
          {chargen.map(c => (
            <li key={c.id} className="flex justify-between gap-3">
              <Link href={`/kellerbuch/weinausbau/${c.id}`} className="text-s112-blue-700 hover:underline truncate">{c.name ?? 'Charge'}</Link>
              <span className="tabular-nums text-s112-text-2 shrink-0">{fmtLiter(Number(c.menge_liter ?? 0))}</span>
            </li>
          ))}
        </ul>
      )}

      {!online && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-s112-warn-bg text-s112-warn-fg px-3 py-2 text-sm">
          <WifiOff size={16} aria-hidden /> Keine Verbindung – Einträge werden erst gespeichert, wenn das Netz wieder da ist. Entwürfe bleiben auf diesem Gerät.
        </p>
      )}

      {schreiben ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Link href={ziele.behandlung} className={kachelCls}><Wrench size={20} aria-hidden />Behandlung</Link>
          {chargen.length === 1 && ziele.analyse
            ? <Link href={ziele.analyse} className={kachelCls}><FlaskConical size={20} aria-hidden />Analyse</Link>
            : <button type="button" onClick={() => umschalten('analyse')} disabled={chargen.length === 0}
                className={`${kachelCls} disabled:opacity-40`} aria-expanded={offen === 'analyse'}><FlaskConical size={20} aria-hidden />Analyse</button>}
          <Link href={ziele.umziehen} className={kachelCls}><ArrowLeftRight size={20} aria-hidden />Umziehen</Link>
          <button type="button" onClick={() => umschalten('schwund')} disabled={chargen.length === 0}
            className={`${kachelCls} disabled:opacity-40`} aria-expanded={offen === 'schwund'}><Droplet size={20} aria-hidden />Schwund</button>
          <button type="button" onClick={() => umschalten('notiz')} className={kachelCls} aria-expanded={offen === 'notiz'}>
            <StickyNote size={20} aria-hidden />Notiz</button>
        </div>
      ) : (
        nurLesenGrund && <p className="text-sm text-s112-muted">{nurLesenGrund}</p>
      )}

      {schreiben && offen === 'analyse' && chargen.length > 1 && (
        <div className="space-y-2">
          {chargeAuswahl(analyseCharge, setAnalyseCharge, 'schnell-analyse-charge')}
          <Link href={analyseCharge ? `/kellerbuch/weinausbau/${analyseCharge}/analysen/neu` : '#'}
            aria-disabled={!analyseCharge}
            className={`btn-primary inline-block ${analyseCharge ? '' : 'pointer-events-none opacity-50'}`}>Analyse erfassen</Link>
        </div>
      )}

      {schreiben && offen === 'notiz' && (
        <form onSubmit={notizSenden} className="space-y-2">
          {chargeAuswahl(notiz.charge, v => { const n = { ...notiz, charge: v }; setNotiz(n); schreibeEntwurf(nk, n) }, 'schnell-notiz-charge')}
          <div>
            <label htmlFor="schnell-notiz" className="block text-xs font-medium text-s112-text-2 mb-1">Notiz *</label>
            <textarea id="schnell-notiz" rows={3} maxLength={500} value={notiz.text}
              onChange={e => { const n = { ...notiz, text: e.target.value }; setNotiz(n); schreibeEntwurf(nk, n) }}
              placeholder="z. B. Gärung ruhig, Temperatur 16 °C" className={inputCls} />
          </div>
          <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto">{pending ? 'Speichert …' : 'Notiz speichern'}</button>
        </form>
      )}

      {schreiben && offen === 'schwund' && (
        <form onSubmit={schwundSenden} className="grid grid-cols-2 gap-2">
          <div className="col-span-2">{chargeAuswahl(schwund.charge, v => { const s = { ...schwund, charge: v }; setSchwund(s); schreibeEntwurf(sk, s) }, 'schnell-schwund-charge')}</div>
          <div>
            <label htmlFor="schnell-schwund-menge" className="block text-xs font-medium text-s112-text-2 mb-1">Menge (L) *</label>
            <input id="schnell-schwund-menge" type="text" inputMode="decimal" value={schwund.menge} placeholder="z. B. 12,5"
              onChange={e => { const s = { ...schwund, menge: e.target.value }; setSchwund(s); schreibeEntwurf(sk, s) }} className={inputCls} />
          </div>
          <div>
            <label htmlFor="schnell-schwund-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
            <input id="schnell-schwund-datum" type="date" value={schwund.datum || heute()} max={heute()}
              onChange={e => { const s = { ...schwund, datum: e.target.value }; setSchwund(s); schreibeEntwurf(sk, s) }} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label htmlFor="schnell-schwund-grund" className="block text-xs font-medium text-s112-text-2 mb-1">Begründung *</label>
            <input id="schnell-schwund-grund" type="text" value={schwund.grund} placeholder="z. B. Verdunstung, Trub"
              onChange={e => { const s = { ...schwund, grund: e.target.value }; setSchwund(s); schreibeEntwurf(sk, s) }} className={inputCls} />
          </div>
          <button type="submit" disabled={pending} className="btn-primary col-span-2 sm:col-span-1">{pending ? 'Bucht …' : 'Schwund buchen'}</button>
        </form>
      )}

      {fehler && <p role="alert" className="text-sm text-s112-err">{fehler}</p>}
      {ok && <p role="status" className="text-sm text-s112-ok">{ok}</p>}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-s112-muted mb-2">Letzte Maßnahmen</h3>
        {massnahmen.length === 0 ? (
          <p className="text-sm text-s112-muted">Noch keine Maßnahmen an diesem Gebinde.</p>
        ) : (
          <ul className="divide-y divide-s112-line text-sm">
            {massnahmen.map(m => (
              <li key={m.key} className="py-1.5">
                <Link href={m.href} className="flex gap-3 hover:bg-s112-bg rounded">
                  <span className="tabular-nums text-s112-muted shrink-0 w-[5.5rem]">{m.datum ? new Date(`${m.datum}T00:00:00`).toLocaleDateString('de-DE') : ''}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-s112-text">{m.titel}</span>
                    {m.detail && <span className="block text-s112-text-2 truncate">{m.detail}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-4 mt-2 text-sm">
          <Link href={`/kellerbuch/behaelter/${behaelterId}/behandlungen`} className="text-s112-blue-700 hover:underline">Alle Behandlungen</Link>
          <Link href={`/kellerbuch/behaelter/${behaelterId}/bewegungen`} className="text-s112-blue-700 hover:underline">Bewegungsbuch</Link>
        </div>
      </div>
    </section>
  )
}
