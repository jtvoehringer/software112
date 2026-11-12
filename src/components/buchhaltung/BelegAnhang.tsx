'use client'

// KAN-415 (11.11.2026): Belege einer E&A-Buchung – Büroklammer mit Anzahl, Öffnen, Anhängen (Datei hochladen oder einen
// per Belegscan erfassten, noch nicht verbuchten Beleg zuordnen). Angehängte Belege sind unveränderlich (Nachweis).

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { BELEG_ACCEPT, belegAnzahlText, belegDateienFehler, belegDateiPfad } from '@/lib/buchhaltung/belegAnhang'

export type BelegKurz = { id: string; dateiname: string }

export default function BelegAnhang({ transaktionId, bezeichnung, belege, offeneBelege, darfAnhaengen }: {
  transaktionId: string
  /** Bezeichnung der Buchung – für die Beschriftung */
  bezeichnung: string
  belege: BelegKurz[]
  /** per Belegscan erfasste, noch nicht verbuchte Belege des Betriebs */
  offeneBelege: BelegKurz[]
  darfAnhaengen: boolean
}) {
  const router = useRouter()
  const id = useId()
  const datei = useRef<HTMLInputElement | null>(null)
  const [offen, setOffen] = useState(false)
  const [belegId, setBelegId] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  if (belege.length === 0 && !darfAnhaengen) return null

  async function senden(fd: FormData, erfolg: string) {
    setFehler(null)
    setLaeuft(true)
    try {
      fd.set('transaktion_id', transaktionId)
      const res = await fetch('/api/buchhaltung/belege/anhang', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({})) as { error?: string; anzahl?: number }
      if (!res.ok) {
        setFehler(j.error ?? 'Der Beleg wurde nicht angehängt.')
        if (j.anzahl) router.refresh()   // ein Teil ist angehängt
        return
      }
      zeigeErfolg(erfolg)
      if (datei.current) datei.current.value = ''
      setBelegId('')
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e, 'Der Beleg wurde nicht angehängt'))
    } finally {
      setLaeuft(false)
    }
  }

  function hochladen() {
    const dateien = [...(datei.current?.files ?? [])]
    if (dateien.length === 0) { setFehler('Bitte eine Datei wählen.'); return }
    const f = belegDateienFehler(dateien)
    if (f) { setFehler(f); return }
    const fd = new FormData()
    for (const d of dateien) fd.append('file', d)
    void senden(fd, dateien.length === 1 ? 'Beleg angehängt.' : `${dateien.length} Belege angehängt.`)
  }

  function zuordnen() {
    if (!belegId) { setFehler('Bitte einen Beleg wählen.'); return }
    const fd = new FormData()
    fd.set('beleg_id', belegId)
    void senden(fd, 'Beleg zugeordnet.')
  }

  return (
    <span className="relative inline-block text-left">
      <button type="button" onClick={() => setOffen(o => !o)} aria-expanded={offen} aria-controls={`${id}-feld`}
        title={belege.length ? `${belegAnzahlText(belege.length)} – ${bezeichnung}` : `Beleg anhängen – ${bezeichnung}`}
        className={`inline-flex items-center gap-1 text-xs rounded-md px-1.5 py-1 hover:bg-s112-bg ${belege.length ? 'text-s112-blue-700 font-medium' : 'text-s112-tertiary'}`}>
        <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="tabular-nums">{belege.length || ''}</span>
        <span className="sr-only">{belege.length ? belegAnzahlText(belege.length) : 'Beleg anhängen'}</span>
      </button>
      {offen && (
        <div id={`${id}-feld`} className="absolute right-0 z-20 mt-1 w-80 max-w-[90vw] rounded-xl border border-s112-border bg-white p-3 shadow-lg space-y-3 text-xs text-s112-text text-left whitespace-normal wrap-break-word">
          {belege.length > 0 ? (
            <ul className="space-y-1">
              {belege.map(b => (
                <li key={b.id}>
                  <a href={belegDateiPfad(b.id)} target="_blank" rel="noopener noreferrer" className="text-s112-blue-700 hover:underline break-all">{b.dateiname}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-s112-muted">Noch kein Beleg an dieser Buchung.</p>
          )}
          {darfAnhaengen && (
            <div className="space-y-2 border-t border-s112-border pt-2">
              <div>
                <label htmlFor={`${id}-datei`} className="block font-medium text-s112-text-2 mb-1">Datei anhängen (PDF, JPEG, PNG, WebP – zusammen bis 4 MB)</label>
                <input id={`${id}-datei`} ref={datei} type="file" multiple accept={BELEG_ACCEPT} disabled={laeuft} className="block w-full text-xs" />
                <button type="button" onClick={hochladen} disabled={laeuft}
                  className="mt-1.5 bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
                  {laeuft ? 'Lädt hoch …' : 'Hochladen'}
                </button>
              </div>
              {offeneBelege.length > 0 && (
                <div>
                  <label htmlFor={`${id}-scan`} className="block font-medium text-s112-text-2 mb-1">Oder gescannten Beleg zuordnen</label>
                  <select id={`${id}-scan`} value={belegId} onChange={e => setBelegId(e.target.value)} disabled={laeuft} className="input w-full py-1.5 text-xs">
                    <option value="">– wählen –</option>
                    {offeneBelege.map(b => <option key={b.id} value={b.id}>{b.dateiname}</option>)}
                  </select>
                  <button type="button" onClick={zuordnen} disabled={laeuft || !belegId}
                    className="mt-1.5 border border-s112-teal/30 text-s112-blue-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                    Zuordnen
                  </button>
                </div>
              )}
              <p className="text-s112-muted">Ein angehängter Beleg bleibt als Nachweis an der Buchung und lässt sich nicht mehr entfernen.</p>
            </div>
          )}
          {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-2 py-1.5">{fehler}</div>}
        </div>
      )}
    </span>
  )
}
