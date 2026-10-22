'use client'

// ── „Mit Grund korrigieren“ (KAN-196, 06.10.2026) ──────────────────────────────────────────────────────
// Baustein für gesperrte Datensätze (Freeze, KAN-96): nur für die Betriebsleitung eingeblendet (die Seite entscheidet,
// die Server Action und die RPC prüfen erneut). Zeigt die korrigierbaren Felder mit den gespeicherten Werten, Grund ist
// Pflicht (≥ 10 Zeichen); übergeben werden nur geänderte Felder (freezeKorrigieren → s112_freeze_korrektur).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { KORREKTUR_ZUSATZ, korrekturAnzeige, korrekturGrundFehler, type KorrekturFeld } from '@/lib/freeze/korrektur'
import { freezeKorrigieren } from '@/app/(dashboard)/freeze-korrektur-actions'

export default function FreezeKorrektur({ tabelle, id, felder, werte, hinweis }: {
  tabelle: string
  id: string
  felder: readonly KorrekturFeld[]
  /** gespeicherte Werte je Spalte */
  werte: Record<string, unknown>
  hinweis?: string
}) {
  const router = useRouter()
  const start = () => Object.fromEntries(felder.map(f => [f.spalte, korrekturAnzeige(f, werte[f.spalte])]))
  const [offen, setOffen] = useState(false)
  const [eingabe, setEingabe] = useState<Record<string, string>>(start)
  const [grund, setGrund] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState(false)
  const [pending, startTransition] = useTransition()
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  function absenden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)
    setErfolg(false)
    const gf = korrekturGrundFehler(grund)
    if (gf) { setFehler(gf); return }
    const geaendert = Object.fromEntries(felder
      .filter(f => eingabe[f.spalte] !== korrekturAnzeige(f, werte[f.spalte]))
      .map(f => [f.spalte, eingabe[f.spalte]]))
    if (Object.keys(geaendert).length === 0) { setFehler('Keine Änderung – bitte mindestens einen Wert ändern.'); return }
    startTransition(async () => {
      try {
        await freezeKorrigieren(tabelle, id, geaendert, grund)
        setGrund('')
        setErfolg(true)
        setOffen(false)
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Korrektur fehlgeschlagen'))
      }
    })
  }

  if (!offen) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => { setEingabe(start()); setOffen(true) }}
          className="inline-flex items-center gap-1.5 text-xs border border-s112-warn/40 text-s112-warn-fg px-3 py-1.5 rounded-lg hover:bg-s112-warn-bg font-medium">
          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" /> Mit Grund korrigieren (Betriebsleitung)
        </button>
        {erfolg && <span role="status" className="text-xs text-s112-ok-fg">Korrektur gespeichert und protokolliert.</span>}
      </div>
    )
  }

  return (
    <form onSubmit={absenden} className="card p-4 space-y-3 border-s112-warn/30">
      <div>
        <h3 className="text-sm font-semibold text-s112-text">Korrektur trotz Sperre</h3>
        <p className="text-xs text-s112-muted mt-0.5">
          {hinweis ?? 'Nur für die Betriebsleitung. Geänderte Werte landen mit Alt/Neu, Benutzer und Grund im Änderungsprotokoll.'}
        </p>
        {/* KAN-349: fester Zusatz je Tabelle (Prüfnummernantrag: Charge nicht änderbar) */}
        {KORREKTUR_ZUSATZ[tabelle] && <p className="text-xs font-medium text-s112-text-2 mt-1">{KORREKTUR_ZUSATZ[tabelle]}</p>}
      </div>
      {fehler &&<div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-3 py-2 rounded-lg text-sm">{fehler}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {felder.map(f => {
          const fid = `korrektur-${f.spalte}`
          const wert = eingabe[f.spalte] ?? ''
          const setzen = (v: string) => setEingabe(x => ({ ...x, [f.spalte]: v }))
          return (
            <div key={f.spalte}>
              <label htmlFor={fid} className="block text-xs font-medium text-s112-text-2 mb-1">{f.label}{f.pflicht ? ' *' : ''}</label>
              {f.typ === 'auswahl' ? (
                <select id={fid} required={f.pflicht} value={wert} onChange={e => setzen(e.target.value)} className={inputCls}>
                  {(f.optionen ?? []).map(o => <option key={o.wert} value={o.wert}>{o.label}</option>)}
                </select>
              ) : (
                <input id={fid} required={f.pflicht} type={f.typ === 'datum' ? 'date' : 'text'} inputMode={f.typ === 'zahl' ? 'decimal' : undefined}
                  value={wert} onChange={e => setzen(e.target.value)} className={inputCls} />
              )}
            </div>
          )
        })}
      </div>
      <div>
        <label htmlFor="korrektur-grund" className="block text-xs font-medium text-s112-text-2 mb-1">Grund der Korrektur * (mind. 10 Zeichen)</label>
        <textarea id="korrektur-grund" value={grund} onChange={e => setGrund(e.target.value)} rows={2} required className={inputCls} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-warn-fg text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {pending ? 'Wird gespeichert …' : 'Korrektur speichern'}
        </button>
        <button type="button" onClick={() => { setOffen(false); setFehler(null) }} className="text-sm text-s112-muted px-3 py-2 hover:text-s112-text-1">
          Abbrechen
        </button>
      </div>
    </form>
  )
}
