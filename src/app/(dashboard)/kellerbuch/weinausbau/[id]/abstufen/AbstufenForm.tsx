'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { zielNachVorgang, zurueckZiel } from '@/lib/navigation/zurueckBrowser'
import { chargeAbstufen } from '../../../actions'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, zahlAus } from '@/lib/format'
import { ABSTUFEN_GRUND_MIN, abstufenFehler, abstufenStufen, teilmengeFehler, type ChargeMerkmale } from '@/lib/kellerbuch/abstufen'
import { QUALITAET_OPTS, qualitaetAnzeige } from '@/lib/wein/qualitaet'
import { HERKUNFT_LABEL } from '@/lib/herkunft'

type Option = { value: string; label: string }

// KAN-82: Formular „Abstufen“ – ganze Charge oder Teilmenge (mit Umzug in ein leeres Gebinde), nur niedriger, Pflichtgrund
export default function AbstufenForm({ chargeId, bestand, heute, alt, zusaetze, herkuenfte, leereGebinde }: {
  chargeId: string; bestand: number; heute: string; alt: ChargeMerkmale
  zusaetze: Option[]; herkuenfte: Option[]; leereGebinde: { id: string; name: string }[]
}) {
  const router = useRouter()
  // Liste der Zieltabelle weinausbau (KAN-73), eingeschränkt auf die bisherige und niedrigere Stufen
  const stufen = abstufenStufen(alt, QUALITAET_OPTS)
  const [pending, startTransition] = useTransition()
  const [umfang, setUmfang] = useState<'ganz' | 'teil'>('ganz')
  const [datum, setDatum] = useState(heute)
  const [menge, setMenge] = useState('')
  const [ziel, setZiel] = useState('')
  const [stufe, setStufe] = useState(alt.stufe ?? '')
  const [zusatz, setZusatz] = useState(alt.zusatz ?? '')
  const [herkunft, setHerkunft] = useState(alt.herkunft ?? '')
  const [grund, setGrund] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)

  const neu: ChargeMerkmale = { stufe: stufe || null, zusatz: (zusatz || null) as ChargeMerkmale['zusatz'], erzeugnis: alt.erzeugnis, herkunft: herkunft || null }
  const pruefung = abstufenFehler(alt, neu)
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  function absenden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)
    if (pruefung) { setFehler(pruefung); return }
    if (grund.trim().length < ABSTUFEN_GRUND_MIN) { setFehler(`Bitte einen Grund angeben (mindestens ${ABSTUFEN_GRUND_MIN} Zeichen).`); return }
    if (umfang === 'teil') {
      const f = teilmengeFehler(zahlAus(menge), bestand)
      if (f) { setFehler(f); return }
      if (!ziel) { setFehler('Bitte das leere Gebinde für die Teilmenge wählen.'); return }
    }
    const fd = new FormData()
    fd.set('weinausbau_id', chargeId)
    fd.set('datum', datum)
    fd.set('umfang', umfang)
    if (umfang === 'teil') { fd.set('menge', menge); fd.set('ziel_behaelter_id', ziel) }
    fd.set('qualitaetsstufe', stufe)
    if (zusaetze.length > 0) fd.set('zusatzbezeichnung', zusatz)
    if (herkuenfte.length > 0) fd.set('herkunft_code', herkunft)
    fd.set('grund', grund)
    startTransition(async () => {
      try {
        let r = await chargeAbstufen(fd)
        if (r.bestaetigung) {
          if (!window.confirm(r.bestaetigung)) return
          fd.set('pn_bestaetigt', '1')
          r = await chargeAbstufen(fd)
        }
        // KAN-224: zurück, woher man kam (Standard: die Charge), mit Bestätigung
        router.push(zielNachVorgang(`/kellerbuch/weinausbau/${r.chargeId ?? chargeId}`, 'abstufung'))
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Abstufen fehlgeschlagen'))
      }
    })
  }

  return (
    <form onSubmit={absenden} className="card p-5 space-y-4">
      <p className="text-xs text-s112-text-2">
        Bisher: <span className="font-medium">{qualitaetAnzeige(alt)}</span>
        {alt.herkunft && <> · {HERKUNFT_LABEL[alt.herkunft] ?? alt.herkunft}</>} · Bestand {fmtNum(bestand)} L
      </p>

      <fieldset className="space-y-1">
        <legend className="block text-xs font-medium text-s112-text-2 mb-1">Umfang</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="umfang" checked={umfang === 'ganz'} onChange={() => setUmfang('ganz')} className="accent-s112-teal" />
          Ganze Charge ({fmtNum(bestand)} L)
        </label>
        <label className={`flex items-center gap-2 text-sm ${leereGebinde.length === 0 ? 'opacity-50' : ''}`}>
          <input type="radio" name="umfang" checked={umfang === 'teil'} disabled={leereGebinde.length === 0} onChange={() => setUmfang('teil')} className="accent-s112-teal" />
          Teilmenge – wird in ein leeres Gebinde umgezogen und dort abgestuft
        </label>
        {leereGebinde.length === 0 && <p className="text-xs text-s112-muted">Kein leeres Gebinde frei – für eine Teilmenge zuerst ein Gebinde leeren.</p>}
      </fieldset>

      {umfang === 'teil' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="abstufen-menge" className="block text-xs font-medium text-s112-text-2 mb-1">Teilmenge (L) *</label>
            <input id="abstufen-menge" type="text" inputMode="decimal" value={menge} onChange={e => setMenge(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="abstufen-ziel" className="block text-xs font-medium text-s112-text-2 mb-1">Leeres Gebinde *</label>
            <select id="abstufen-ziel" value={ziel} onChange={e => setZiel(e.target.value)} className={inputCls}>
              <option value="">– wählen –</option>
              {leereGebinde.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="abstufen-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input id="abstufen-datum" type="date" value={datum} max={heute} onChange={e => setDatum(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="abstufen-qualitaetsstufe" className="block text-xs font-medium text-s112-text-2 mb-1">Qualitätsstufe</label>
          <select id="abstufen-qualitaetsstufe" value={stufe} onChange={e => setStufe(e.target.value)} className={inputCls}>
            {stufen.map(o => <option key={o.value} value={o.value}>{o.label}{o.value === alt.stufe ? ' (bisher)' : ''}</option>)}
          </select>
        </div>
        {zusaetze.length > 0 && (
          <div>
            <label htmlFor="abstufen-zusatz" className="block text-xs font-medium text-s112-text-2 mb-1">Zusatzbezeichnung</label>
            <select id="abstufen-zusatz" value={zusatz} onChange={e => setZusatz(e.target.value)} className={inputCls}>
              <option value="">– keine –</option>
              {zusaetze.map(o => <option key={o.value} value={o.value}>{o.label}{o.value === alt.zusatz ? ' (bisher)' : ''}</option>)}
            </select>
          </div>
        )}
        {herkuenfte.length > 0 && (
          <div>
            <label htmlFor="abstufen-herkunft" className="block text-xs font-medium text-s112-text-2 mb-1">Herkunft</label>
            <select id="abstufen-herkunft" value={herkunft} onChange={e => setHerkunft(e.target.value)} className={inputCls}>
              {herkuenfte.map(o => <option key={o.value} value={o.value}>{o.label}{o.value === alt.herkunft ? ' (bisher)' : ''}</option>)}
            </select>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="abstufen-grund" className="block text-xs font-medium text-s112-text-2 mb-1">Grund * <span className="text-s112-muted font-normal">(mindestens {ABSTUFEN_GRUND_MIN} Zeichen, steht im Weinbuch und im Änderungsprotokoll)</span></label>
        <textarea id="abstufen-grund" value={grund} onChange={e => setGrund(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
      </div>

      {pruefung && stufe && <p className="text-xs text-s112-muted">{pruefung}</p>}
      {fehler && <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{fehler}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending || !!pruefung}
          className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-4 py-3 sm:py-1.5 rounded-lg text-base sm:text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50">
          {pending ? 'Speichert…' : 'Abstufen'}
        </button>
        <button type="button" onClick={() => router.push(zurueckZiel(`/kellerbuch/weinausbau/${chargeId}`))} className="px-4 py-3 sm:py-1.5 text-base sm:text-sm text-s112-text-2 hover:text-s112-text">Abbrechen</button>
      </div>
    </form>
  )
}
