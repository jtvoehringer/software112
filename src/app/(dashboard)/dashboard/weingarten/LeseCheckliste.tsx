'use client'

// Lesevorbereitungs-Checkliste (Client-Teil der Sicht "Weingarten & Ernte").
// Abhaken, ergänzen, löschen – alles über Server Actions (actions.ts).

import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { checklisteAnlegen, punktUmschalten, punktHinzufuegen, punktLoeschen } from './actions'
import { fehlerText } from '@/lib/fehler'

export type Punkt = { id: string; text: string; zustaendig: string | null; faellig_am: string | null; faellig_hinweis: string | null; erledigt: boolean }

export default function LeseCheckliste({ listeId, jahr, punkte, darfSchreiben }: { listeId: string | null; jahr: number; punkte: Punkt[]; darfSchreiben: boolean }) {
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [neu, setNeu] = useState({ text: '', zustaendig: '', hinweis: '' })
  const [formOffen, setFormOffen] = useState(false)

  const run = (fn: () => Promise<void>) => start(async () => {
    setFehler(null)
    try { await fn() } catch (e) { setFehler(fehlerText(e)) }
  })

  const done = punkte.filter(p => p.erledigt).length
  const pct = punkte.length ? Math.round(done / punkte.length * 100) : 0

  if (!listeId) {
    return (
      <div className="py-4 text-center">
        <p className="text-[13px] text-s112-text-2">Für {jahr} gibt es noch keine Lesevorbereitungs-Checkliste.</p>
        {darfSchreiben ? (
          <button type="button" disabled={pending} onClick={() => run(() => checklisteAnlegen(jahr))} className="btn-primary text-[13px] py-1.5 mt-3">
            {pending ? 'Wird angelegt …' : `Checkliste ${jahr} aus Vorlage anlegen`}
          </button>
        ) : <p className="text-[12px] text-s112-tertiary mt-1">Anlegen ist Betriebsleitung/Winzer vorbehalten.</p>}
        {fehler && <p className="text-[12px] text-s112-err-fg mt-2">{fehler}</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[12.5px] mb-1">
        <span className="text-s112-text-2">Fortschritt</span>
        <span className="font-mono text-s112-ok-fg">{done} / {punkte.length} erledigt</span>
      </div>
      <div className="h-2 rounded bg-s112-line overflow-hidden mb-2">
        <div className="h-full rounded bg-s112-ok transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <ul>
        {punkte.map(p => (
          <li key={p.id} className={`flex items-start gap-2.5 py-2 border-b border-s112-line last:border-0 text-[13.5px] ${pending ? 'opacity-70' : ''}`}>
            <input type="checkbox" id={`cl-${p.id}`} checked={p.erledigt} disabled={!darfSchreiben || pending}
              onChange={e => run(() => punktUmschalten(p.id, e.target.checked))}
              className="w-4 h-4 mt-[3px] accent-s112-teal" />
            <label htmlFor={`cl-${p.id}`} className={`flex-1 cursor-pointer ${p.erledigt ? 'line-through text-s112-tertiary' : 'text-s112-text'}`}>{p.text}</label>
            <span className="font-mono text-[11px] text-s112-tertiary whitespace-nowrap mt-0.5">
              {[p.zustaendig, p.faellig_am ? new Date(p.faellig_am).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' }) : p.faellig_hinweis].filter(Boolean).join(' · ')}
            </span>
            {darfSchreiben && (
              <button type="button" title="Punkt löschen" disabled={pending} onClick={() => run(() => punktLoeschen(p.id))}
                className="text-s112-tertiary hover:text-s112-err-fg mt-0.5"><Trash2 size={14} strokeWidth={1.75} /></button>
            )}
          </li>
        ))}
      </ul>

      {darfSchreiben && (
        formOffen ? (
          <form className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_120px_110px_auto] gap-2"
            onSubmit={e => { e.preventDefault(); run(async () => { await punktHinzufuegen(listeId, neu.text, neu.zustaendig, neu.hinweis); setNeu({ text: '', zustaendig: '', hinweis: '' }); setFormOffen(false) }) }}>
            <input className="form-input py-2.5 sm:py-2 text-base sm:text-sm" placeholder="Neuer Punkt" value={neu.text} onChange={e => setNeu({ ...neu, text: e.target.value })} required autoFocus />
            <input className="form-input py-2.5 sm:py-2 text-base sm:text-sm" placeholder="Zuständig" value={neu.zustaendig} onChange={e => setNeu({ ...neu, zustaendig: e.target.value })} />
            <input className="form-input py-2.5 sm:py-2 text-base sm:text-sm" placeholder="Wann" value={neu.hinweis} onChange={e => setNeu({ ...neu, hinweis: e.target.value })} />
            <div className="flex gap-1.5">
              <button type="submit" disabled={pending} className="btn-primary text-[13px] py-1.5">Hinzufügen</button>
              <button type="button" onClick={() => setFormOffen(false)} className="btn-secondary text-[13px] py-1.5">Abbrechen</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setFormOffen(true)} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-s112-blue-700 hover:underline">
            <Plus size={14} strokeWidth={1.75} /> Punkt ergänzen
          </button>
        )
      )}
      {fehler && <p className="text-[12px] text-s112-err-fg mt-2">{fehler}</p>}
    </div>
  )
}
