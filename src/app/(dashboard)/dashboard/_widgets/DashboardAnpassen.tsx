'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, GripVertical, LayoutGrid, X } from 'lucide-react'
import { useDialog } from '@/components/ui/useDialog'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { fehlerText } from '@/lib/fehler'
import { BEREICH_TITEL, layoutAusEditor, umschalten, verschieben, verschiebenNach, type EditorEintrag, type WidgetBereich, type WidgetGroesse } from '@/lib/dashboard/widgets'
import { dashboardSpeichern, dashboardZuruecksetzen } from '../actions'

// KAN-388: Knopf „Dashboard anpassen“ und Fenster zum Ein-/Ausblenden, Verschieben (Pfeile, am PC auch Ziehen) und
// zur Größenwahl. Die Zeilen kommen fertig aus editorEintraege() (Register + gespeichertes Layout + Rechte); nicht
// verfügbare Widgets werden nicht angeboten, bleiben aber an ihrem Platz gespeichert.

const GROESSE_TEXT: Record<WidgetGroesse, string> = { klein: 'Kachel', mittel: 'halbe Breite', breit: 'ganze Breite' }
const BEREICHE = Object.keys(BEREICH_TITEL) as WidgetBereich[]

export default function DashboardAnpassen({ eintraege, eigenes }: { eintraege: EditorEintrag[]; eigenes: boolean }) {
  const [offen, setOffen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}
        className="inline-flex items-center gap-1.5 border border-s112-line bg-white text-s112-text-2 px-3 py-1.5 rounded-lg text-[13px] font-medium hover:border-s112-teal hover:text-s112-text">
        <LayoutGrid size={14} strokeWidth={1.75} aria-hidden="true" />Dashboard anpassen
      </button>
      {offen && <Fenster start={eintraege} eigenes={eigenes} schliessen={() => setOffen(false)} />}
    </>
  )
}

function Fenster({ start, eigenes, schliessen }: { start: EditorEintrag[]; eigenes: boolean; schliessen: () => void }) {
  const router = useRouter()
  const [liste, setListe] = useState(start)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [gezogen, setGezogen] = useState<string | null>(null)
  const dialog = useDialog(true, laeuft ? undefined : schliessen, 'Dashboard anpassen')
  const eingeblendet = liste.filter(e => e.verfuegbar && e.an)
  const weitere = liste.filter(e => e.verfuegbar && !e.an)
  const nichtVerfuegbar = liste.filter(e => !e.verfuegbar)

  const aendern = (id: string, teil: Partial<EditorEintrag>) => setListe(l => l.map(e => (e.id === id ? { ...e, ...teil } : e)))

  async function speichern() {
    setFehler(null)
    setLaeuft(true)
    try {
      const r = await dashboardSpeichern(layoutAusEditor(liste))
      if (!r.ok) { setFehler(r.fehler); return }
      zeigeErfolg('Dashboard gespeichert.')
      schliessen()
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(false)
    }
  }

  async function zuruecksetzen() {
    if (!(await rueckfrage({ titel: 'Dashboard auf Standard zurücksetzen?', text: 'Deine eigene Anordnung wird gelöscht; die Übersicht sieht dann in allen Betrieben wieder aus wie bei allen anderen.', bestaetigen: 'Zurücksetzen', gefaehrlich: true }))) return
    setFehler(null)
    setLaeuft(true)
    try {
      const r = await dashboardZuruecksetzen()
      if (!r.ok) { setFehler(r.fehler); return }
      zeigeErfolg('Dashboard auf Standard zurückgesetzt.')
      schliessen()
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={laeuft ? undefined : schliessen}>
      <div {...dialog} className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="font-display font-semibold text-base text-s112-text">Dashboard anpassen</h2>
          <button type="button" aria-label="Schließen" onClick={schliessen} disabled={laeuft} className="text-s112-muted hover:text-s112-text"><X className="w-5 h-5" /></button>
        </div>
        <p className="px-5 text-[12.5px] text-s112-text-2">Häkchen blendet ein oder aus, die Pfeile (am PC auch Ziehen) ändern die Reihenfolge. Gilt für dich in allen Betrieben, am Handy in derselben Reihenfolge.</p>

        <h3 className="px-5 pt-3 text-[11.5px] font-semibold uppercase tracking-[.08em] text-s112-tertiary">Auf deiner Übersicht</h3>
        {eingeblendet.length === 0 && <p className="px-5 pt-1.5 text-[12.5px] text-s112-text-2">Noch nichts eingeblendet – unten ein Widget anhaken.</p>}
        <ul className="px-5 py-2 space-y-1.5" aria-label="Eingeblendete Widgets">
          {eingeblendet.map((e, i) => (
            <li key={e.id}
              draggable={!laeuft}
              onDragStart={() => setGezogen(e.id)}
              onDragEnd={() => setGezogen(null)}
              onDragOver={ev => { if (gezogen && gezogen !== e.id) ev.preventDefault() }}
              onDrop={ev => { ev.preventDefault(); if (gezogen) setListe(l => verschiebenNach(l, gezogen, e.id)); setGezogen(null) }}
              className={`flex items-center gap-2 border rounded-lg px-2.5 py-2 ${gezogen === e.id ? 'border-s112-teal bg-s112-bg' : 'border-s112-line'}`}>
              <GripVertical size={16} strokeWidth={1.5} className="text-s112-tertiary shrink-0 max-sm:hidden cursor-grab" aria-hidden="true" />
              <label className="flex items-center gap-2 flex-1 min-w-0 text-[13.5px] text-s112-text">
                <input type="checkbox" checked disabled={laeuft} onChange={() => setListe(l => umschalten(l, e.id, false))} />
                <span className="truncate">{e.titel}</span>
                {e.bereich !== 'uebersicht' && <span className="max-sm:hidden shrink-0 text-[11px] text-s112-tertiary">{BEREICH_TITEL[e.bereich]}</span>}
              </label>
              {e.groessen.length > 1 && (
                <select aria-label={`Größe ${e.titel}`} value={e.groesse} disabled={laeuft}
                  onChange={ev => aendern(e.id, { groesse: ev.target.value as WidgetGroesse })}
                  className="border border-s112-line rounded-md text-[12.5px] px-1.5 py-1 bg-white">
                  {e.groessen.map(g => <option key={g} value={g}>{GROESSE_TEXT[g]}</option>)}
                </select>
              )}
              <button type="button" aria-label={`${e.titel} nach oben`} disabled={laeuft || i === 0}
                onClick={() => setListe(l => verschieben(l, e.id, -1))}
                className="p-1 rounded text-s112-text-2 hover:text-s112-text disabled:opacity-30"><ArrowUp size={16} strokeWidth={1.75} /></button>
              <button type="button" aria-label={`${e.titel} nach unten`} disabled={laeuft || i === eingeblendet.length - 1}
                onClick={() => setListe(l => verschieben(l, e.id, 1))}
                className="p-1 rounded text-s112-text-2 hover:text-s112-text disabled:opacity-30"><ArrowDown size={16} strokeWidth={1.75} /></button>
            </li>
          ))}
        </ul>

        {/* KAN-389: ausgeblendete Widgets nach Herkunft – Anhaken setzt sie ans Ende der Übersicht */}
        {weitere.length > 0 && (
          <>
            <h3 className="px-5 pt-3 text-[11.5px] font-semibold uppercase tracking-[.08em] text-s112-tertiary">Weitere Widgets</h3>
            {BEREICHE.filter(b => weitere.some(e => e.bereich === b)).map(b => (
              <div key={b} className="px-5 pt-2">
                <p className="text-[12px] font-semibold text-s112-text-2 mb-1">{BEREICH_TITEL[b]}</p>
                <ul className="space-y-1.5" aria-label={`Weitere Widgets ${BEREICH_TITEL[b]}`}>
                  {weitere.filter(e => e.bereich === b).map(e => (
                    <li key={e.id} className="flex items-center gap-2 border border-s112-line rounded-lg px-2.5 py-2">
                      <label className="flex items-center gap-2 flex-1 min-w-0 text-[13.5px] text-s112-text-2">
                        <input type="checkbox" checked={false} disabled={laeuft} onChange={() => setListe(l => umschalten(l, e.id, true))} />
                        <span className="truncate">{e.titel}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}

        {nichtVerfuegbar.length > 0 && (
          <p className="px-5 text-[12px] text-s112-tertiary">
            In diesem Betrieb nicht verfügbar, bleibt gespeichert: {nichtVerfuegbar.map(e => e.titel).join(', ')}.
          </p>
        )}

        {fehler && <p role="alert" className="mx-5 mt-3 text-[12.5px] text-s112-err-fg bg-s112-err-bg rounded-lg px-3 py-2">{fehler}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 mt-2 border-t border-s112-line">
          <button type="button" onClick={zuruecksetzen} disabled={laeuft || !eigenes}
            title={eigenes ? undefined : 'Du verwendest bereits den Standard.'}
            className="text-[13px] text-s112-text-2 hover:text-s112-err-fg disabled:opacity-40">Auf Standard zurücksetzen</button>
          <div className="flex gap-2">
            <button type="button" onClick={schliessen} disabled={laeuft}
              className="px-3.5 py-1.5 rounded-lg text-[13px] border border-s112-line text-s112-text-2 hover:text-s112-text">Abbrechen</button>
            <button type="button" onClick={speichern} disabled={laeuft}
              className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold bg-s112-teal text-s112-yellow hover:opacity-90 disabled:opacity-40">{laeuft ? 'wird gespeichert …' : 'Speichern'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
