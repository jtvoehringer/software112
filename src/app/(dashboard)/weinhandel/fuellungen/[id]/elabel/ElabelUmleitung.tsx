'use client'

// KAN-219 (07.10.2026): Umleitung des gedruckten QR-Codes auf ein anderes freigegebenes E-Label des Betriebs
// (z. B. die Nachfolgefüllung) – mit Grund, protokolliert; Aufheben ebenso.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { umleitungGrundFehler } from '@/lib/elabel/oeffentlich'

export type UmleitungZiel = { id: string; label: string }
export type UmleitungProtokoll = { id: string; am: string; von: string | null; nach: string | null; grund: string; wer: string | null }

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'

export default function ElabelUmleitung({ ziele, aktuell, protokoll, schreiben, umleiten }: {
  ziele: UmleitungZiel[]
  /** aktuelles Ziel (id) oder null */
  aktuell: string | null
  protokoll: UmleitungProtokoll[]
  schreiben: boolean
  umleiten: (zielId: string | null, grund: string) => Promise<void>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [ziel, setZiel] = useState(aktuell ?? '')
  const [grund, setGrund] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const aktuellLabel = aktuell ? (ziele.find(z => z.id === aktuell)?.label ?? 'anderes E-Label') : null

  function senden(neu: string | null) {
    setFehler(null)
    const gf = umleitungGrundFehler(grund)
    if (gf) { setFehler(gf); return }
    startTransition(async () => {
      try {
        await umleiten(neu, grund)
        setGrund('')
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Umleitung konnte nicht gespeichert werden'))
      }
    })
  }

  return (
    <section className="card p-5 space-y-3">
      <h2 className="font-semibold text-s112-text text-sm">Umleitung des QR-Codes</h2>
      <p className="text-sm text-s112-text-2">
        {aktuellLabel
          ? <>Der QR-Code dieses E-Labels zeigt derzeit auf <strong>{aktuellLabel}</strong>.</>
          : 'Der QR-Code zeigt auf dieses E-Label. Für bereits gedruckte Etiketten lässt er sich auf ein anderes freigegebenes E-Label umleiten, z. B. auf die Nachfolgefüllung.'}
      </p>
      {schreiben && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
          <div>
            <label htmlFor="umleitung-ziel" className="block text-xs font-medium text-s112-text-2 mb-1">Ziel</label>
            <select id="umleitung-ziel" value={ziel} onChange={e => setZiel(e.target.value)} className={inputCls}>
              <option value="">– kein Ziel –</option>
              {ziele.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="umleitung-grund" className="block text-xs font-medium text-s112-text-2 mb-1">Grund *</label>
            <input id="umleitung-grund" value={grund} onChange={e => setGrund(e.target.value)} placeholder="z. B. Nachfolgefüllung 2027" className={inputCls} />
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={pending || !ziel || ziel === aktuell} onClick={() => senden(ziel)} className="btn-primary text-sm">Umleiten</button>
            {aktuell && <button type="button" disabled={pending} onClick={() => senden(null)} className="btn-secondary text-sm">Aufheben</button>}
          </div>
        </div>
      )}
      {schreiben && ziele.length === 0 && <p className="text-xs text-s112-muted">Es gibt noch kein anderes freigegebenes E-Label in diesem Betrieb.</p>}
      {fehler && <p role="alert" className="text-sm text-s112-err">{fehler}</p>}
      {protokoll.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-s112-muted mb-1">Protokoll</h3>
          <ul className="text-xs text-s112-text-2 space-y-1">
            {protokoll.map(p => (
              <li key={p.id}>
                {new Date(p.am).toLocaleString('de-DE', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' })}
                {' · '}{p.nach ? `→ ${p.nach}` : 'Umleitung aufgehoben'}{p.von ? ` (vorher ${p.von})` : ''}
                {' · '}{p.grund}{p.wer ? ` · ${p.wer}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
