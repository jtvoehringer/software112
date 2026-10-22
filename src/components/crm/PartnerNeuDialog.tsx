'use client'

// KAN-353 (22.10.2026): Kunde/Lieferant direkt aus der Partner-Suche anlegen – kleiner Dialog mit den Pflichtfeldern
// (Firma: Name; Kontakt: Vor-/Nachname wie im CRM), Betriebsnummer (optional), Land (Standard AT) und bei Firmen
// Kunde/Lieferant (vom Formular vorbelegt). Gespeichert wird über partnerSchnellAnlegen (CRM-Actions, dieselbe
// Anlage wie im CRM). Kein form-Element: der Dialog liegt in Formularen (Zukauf, Verkauf …) – Enter speichert hier,
// nicht das äußere Formular; gerendert per Portal, damit er nicht in Karten/Scroll-Bereichen abgeschnitten wird.

import { useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useDialog } from '@/components/ui/useDialog'
import LandOptionen from '@/components/crm/LandOptionen'
import { partnerSchnellAnlegen } from '@/app/(dashboard)/crm/actions'
import { fehlerText } from '@/lib/fehler'
import {
  namensVorschlag, schnellAnlagePruefen, standardRolle,
  type PartnerSuchArt, type SchnellRolle, type SchnellTreffer, type SchnellTyp, type SchnellPartnerEingabe,
} from '@/lib/crm/schnellAnlage'

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

export default function PartnerNeuDialog({ typ, art, rolle, suchtext, firmaId, onAngelegt, onAbbrechen }: {
  typ: SchnellTyp
  art: PartnerSuchArt
  rolle?: SchnellRolle | null
  /** bisheriger Suchtext – wird als Name vorbelegt */
  suchtext: string
  /** (art='kontakt') neuer Kontakt als Ansprechperson dieser Firma */
  firmaId?: string | null
  onAngelegt: (t: SchnellTreffer) => void
  onAbbrechen: () => void
}) {
  const titel = typ === 'firma' ? 'Neue Firma anlegen' : 'Neuen Kontakt anlegen'
  const dialog = useDialog(true, onAbbrechen, titel)
  const vorschlag = namensVorschlag(typ, suchtext)
  const r = standardRolle(art, rolle)
  const [name, setName]           = useState(vorschlag.name)
  const [vorname, setVorname]     = useState(vorschlag.vorname)
  const [nachname, setNachname]   = useState(vorschlag.nachname)
  const [betriebNr, setBetriebNr] = useState('')
  const [land, setLand]           = useState('AT')
  const [istKunde, setIstKunde]         = useState(r === 'kunde')
  const [istLieferant, setIstLieferant] = useState(r === 'lieferant')
  const [fehler, setFehler]       = useState<string | null>(null)
  const [dublette, setDublette]   = useState<string | null>(null)
  const [speichern, setSpeichern] = useState(false)

  // Im Verkauf muss die Firma Kunde, im Zukauf Lieferant sein – sonst fände die Suche sie nicht
  const kundePflicht = art === 'kunde'
  const lieferantPflicht = art === 'lieferant'

  async function anlegen(trotzDublette: boolean) {
    const eingabe: SchnellPartnerEingabe = {
      typ, art, name, vorname, nachname, betrieb_nr: betriebNr, land,
      ist_kunde: istKunde || kundePflicht, ist_lieferant: istLieferant || lieferantPflicht,
      firma_id: firmaId ?? null, trotzDublette,
    }
    const vorab = schnellAnlagePruefen(eingabe)   // dieselbe Prüfung wie auf dem Server
    if (!vorab.ok) { setFehler(vorab.fehler); return }
    setFehler(null)
    setSpeichern(true)
    try {
      const erg = await partnerSchnellAnlegen(eingabe)
      if (erg.dublette) { setDublette(erg.dublette); return }
      if (erg.error || !erg.treffer) { setFehler(erg.error ?? 'Nicht gespeichert – bitte erneut versuchen.'); return }
      onAngelegt(erg.treffer)
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setSpeichern(false)
    }
  }

  // Enter in einem Feld speichert diesen Dialog – nie das Formular dahinter
  function enter(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    if (!speichern) void anlegen(false)
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onAbbrechen}>
      <div {...dialog} className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-4"
        onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-semibold text-s112-text">{titel}</h2>
          <p className="text-xs text-s112-muted mt-0.5">Wird im CRM mit Kundennummer angelegt und hier gleich ausgewählt. Weitere Angaben später im CRM.</p>
        </div>

        {typ === 'firma' ? (
          <div>
            <label className={labelCls} htmlFor="partner-neu-name">Name der Firma *</label>
            <input id="partner-neu-name" autoFocus aria-required="true" value={name} onChange={e => { setName(e.target.value); setDublette(null) }} onKeyDown={enter}
              maxLength={200} autoComplete="off" className={inputCls} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="partner-neu-vorname">Vorname</label>
              <input id="partner-neu-vorname" value={vorname} onChange={e => { setVorname(e.target.value); setDublette(null) }} onKeyDown={enter}
                maxLength={200} autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="partner-neu-nachname">Nachname *</label>
              <input id="partner-neu-nachname" autoFocus aria-required="true" value={nachname} onChange={e => { setNachname(e.target.value); setDublette(null) }} onKeyDown={enter}
                maxLength={200} autoComplete="off" className={inputCls} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="partner-neu-betrieb">Betriebsnummer (optional)</label>
            <input id="partner-neu-betrieb" inputMode="numeric" value={betriebNr} onChange={e => setBetriebNr(e.target.value)} onKeyDown={enter}
              placeholder="z.B. 4285221" autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="partner-neu-land">Land</label>
            <select id="partner-neu-land" value={land} onChange={e => setLand(e.target.value)} className={inputCls}>
              <LandOptionen aktuell={land} />
            </select>
          </div>
        </div>

        {typ === 'firma' ? (
          <fieldset className="flex flex-wrap gap-4">
            <legend className={labelCls}>Kennzeichen</legend>
            <label className="flex items-center gap-2 text-sm text-s112-text-1">
              <input type="checkbox" checked={istKunde || kundePflicht} disabled={kundePflicht}
                onChange={e => setIstKunde(e.target.checked)} className="accent-s112-teal" />
              Kunde
            </label>
            <label className="flex items-center gap-2 text-sm text-s112-text-1">
              <input type="checkbox" checked={istLieferant || lieferantPflicht} disabled={lieferantPflicht}
                onChange={e => setIstLieferant(e.target.checked)} className="accent-s112-teal" />
              Lieferant
            </label>
          </fieldset>
        ) : (
          <p className="text-xs text-s112-muted">Kontakte stehen in der Kunden- und in der Lieferantensuche zur Verfügung.</p>
        )}

        {fehler && (
          <p role="alert" className="text-sm bg-s112-err-bg text-s112-err-fg rounded-lg px-3 py-2">{fehler}</p>
        )}
        {dublette && (
          <div role="alert" className="text-sm bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-lg px-3 py-2 space-y-2">
            <p>Es gibt bereits „{dublette}“ im CRM. Bitte zuerst in der Suche nachsehen – oder trotzdem neu anlegen.</p>
            <button type="button" onClick={() => void anlegen(true)} disabled={speichern}
              className="text-xs font-medium underline disabled:opacity-50">Trotzdem anlegen</button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onAbbrechen} disabled={speichern}
            className="px-4 py-2 text-sm rounded-lg border border-s112-border text-s112-text-2 hover:bg-s112-bg disabled:opacity-50">Abbrechen</button>
          <button type="button" onClick={() => void anlegen(false)} disabled={speichern}
            className="px-4 py-2 text-sm rounded-lg bg-s112-teal text-s112-yellow font-medium disabled:opacity-50">
            {speichern ? 'Speichert …' : 'Anlegen und übernehmen'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
