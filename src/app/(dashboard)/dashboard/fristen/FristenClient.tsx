'use client'

// Fristen-Ampel (Client-Teil der Sicht "Meldungen & Fristen"): Tabelle aller
// Fristen (betriebseigen + abgeleitet), Erledigen/Wiedereröffnen/Löschen und
// Anlegen betriebseigener Fristen über Server Actions.

import { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { Plus, Check, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Th, Td, fmtDate, type BadgeTone } from '../_shared/ui'
import type { Frist, FristStatus } from '../_shared/types'
import { KATEGORIE_LABEL } from './vorlage'
import { standardfristenAnlegen, fristAnlegen, fristErledigen, fristWiedereroeffnen, fristLoeschen } from './actions'
import { HINWEISE_EVENT } from '@/components/layout/Topbar'

const STATUS: Record<FristStatus, { label: string; tone: BadgeTone }> = {
  ueberfaellig: { label: 'Überfällig', tone: 'err' },
  faellig:      { label: 'Fällig',     tone: 'warn' },
  offen:        { label: 'Offen',      tone: 'gray' },
  laufend:      { label: 'Laufend',    tone: 'info' },
  erledigt:     { label: 'Erledigt',   tone: 'ok' },
}

export default function FristenClient({ fristen, darfSchreiben, vorwarnungTage }: { fristen: Frist[]; darfSchreiben: boolean; vorwarnungTage: number }) {
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [formOffen, setFormOffen] = useState(false)
  const [neu, setNeu] = useState({ bezeichnung: '', beschreibung: '', kategorie: 'meldung', faellig_am: '', wiederholung: 'jaehrlich' })
  const [zeigeErledigt, setZeigeErledigt] = useState(false)

  const run = (fn: () => Promise<void>) => start(async () => {
    setFehler(null)
    try { await fn(); window.dispatchEvent(new Event(HINWEISE_EVENT)) } catch (e) { setFehler(e instanceof Error ? e.message : String(e)) }
  })

  const sichtbar = fristen.filter(f => zeigeErledigt || f.status !== 'erledigt' || f.quelle === 'system')
  const eigene = fristen.filter(f => f.quelle === 'betrieb').length

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr><Th>Meldung / Regel</Th><Th>Frist / Bezug</Th><Th>Status</Th>{darfSchreiben && <Th />}</tr></thead>
          <tbody>
            {sichtbar.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[13px] text-s112-text-2">Keine Fristen vorhanden.</td></tr>}
            {sichtbar.map(f => (
              <tr key={f.key} className={`hover:bg-[#F7F8FA] ${pending ? 'opacity-70' : ''}`}>
                <Td>
                  {f.href ? <Link href={f.href} className="font-semibold text-s112-text hover:text-s112-blue-700">{f.bezeichnung}</Link> : <span className="font-semibold text-s112-text">{f.bezeichnung}</span>}
                  <span className="block text-[11.5px] text-s112-text-2">{f.hinweis}{f.quelle === 'betrieb' && <span className="text-s112-tertiary"> · {KATEGORIE_LABEL[f.kategorie] ?? f.kategorie}</span>}</span>
                </Td>
                <Td mono>{f.statusText}</Td>
                <Td><Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge></Td>
                {darfSchreiben && (
                  <Td right className="whitespace-nowrap">
                    {f.quelle === 'betrieb' && f.id && (
                      <span className="inline-flex gap-1">
                        {f.status === 'erledigt'
                          ? <button type="button" title="Wieder öffnen" disabled={pending} onClick={() => run(() => fristWiedereroeffnen(f.id!))} className="p-1 rounded text-s112-tertiary hover:text-s112-blue-700 hover:bg-s112-blue-50"><RotateCcw size={14} strokeWidth={1.75} /></button>
                          : <button type="button" title="Als erledigt markieren" disabled={pending} onClick={() => run(() => fristErledigen(f.id!))} className="p-1 rounded text-s112-tertiary hover:text-s112-ok-fg hover:bg-s112-ok-bg"><Check size={14} strokeWidth={1.75} /></button>}
                        <button type="button" title="Löschen" disabled={pending} onClick={() => run(() => fristLoeschen(f.id!))} className="p-1 rounded text-s112-tertiary hover:text-s112-err-fg hover:bg-s112-err-bg"><Trash2 size={14} strokeWidth={1.75} /></button>
                      </span>
                    )}
                    {f.quelle === 'system' && <span className="font-mono text-[10px] text-s112-tertiary">automatisch</span>}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
        <label className="inline-flex items-center gap-1.5 text-s112-text-2 cursor-pointer">
          <input type="checkbox" checked={zeigeErledigt} onChange={e => setZeigeErledigt(e.target.checked)} className="accent-s112-teal" /> erledigte anzeigen
        </label>
        {darfSchreiben && (
          <>
            <button type="button" onClick={() => setFormOffen(o => !o)} className="inline-flex items-center gap-1.5 text-s112-blue-700 hover:underline">
              <Plus size={14} strokeWidth={1.75} /> Frist anlegen
            </button>
            {eigene === 0 && (
              <button type="button" disabled={pending} onClick={() => run(standardfristenAnlegen)} className="text-s112-blue-700 hover:underline">
                Standardfristen aus Vorlage anlegen
              </button>
            )}
          </>
        )}
      </div>

      {formOffen && darfSchreiben && (
        <form className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_130px_140px_130px] gap-2 items-end"
          onSubmit={e => { e.preventDefault(); run(async () => { await fristAnlegen(neu); setNeu({ bezeichnung: '', beschreibung: '', kategorie: 'meldung', faellig_am: '', wiederholung: 'jaehrlich' }); setFormOffen(false) }) }}>
          <label className="block"><span className="form-label">Bezeichnung</span><input className="form-input" required value={neu.bezeichnung} onChange={e => setNeu({ ...neu, bezeichnung: e.target.value })} /></label>
          <label className="block"><span className="form-label">Hinweis</span><input className="form-input" value={neu.beschreibung} onChange={e => setNeu({ ...neu, beschreibung: e.target.value })} /></label>
          <label className="block"><span className="form-label">Kategorie</span>
            <select className="form-input" value={neu.kategorie} onChange={e => setNeu({ ...neu, kategorie: e.target.value })}>
              {Object.entries(KATEGORIE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="block"><span className="form-label">Fällig am</span><input type="date" className="form-input" required value={neu.faellig_am} onChange={e => setNeu({ ...neu, faellig_am: e.target.value })} /></label>
          <div className="flex items-end gap-2">
            <label className="block flex-1"><span className="form-label">Wiederholung</span>
              <select className="form-input" value={neu.wiederholung} onChange={e => setNeu({ ...neu, wiederholung: e.target.value })}>
                <option value="jaehrlich">jährlich</option><option value="einmalig">einmalig</option>
              </select></label>
            <button type="submit" disabled={pending} className="btn-primary text-[13px] py-2">Speichern</button>
          </div>
        </form>
      )}
      {fehler && <p className="text-[12px] text-s112-err-fg mt-2">{fehler}</p>}
      <p className="text-[11px] text-s112-tertiary mt-3">Ampel: überfällig = Frist verstrichen · fällig = innerhalb {vorwarnungTage} Tagen (einstellbar unter Mein Betrieb) · laufend = fortlaufend überwacht. Fälligkeit heute: {fmtDate(new Date())}.</p>
    </div>
  )
}
