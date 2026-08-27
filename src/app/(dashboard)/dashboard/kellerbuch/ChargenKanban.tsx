'use client'

// Chargen-Pipeline (Kanban) + Detail-Modal – Client-Teil der Sicht "Kellerbuch".
// Die Daten kommen fertig aus der Server-Seite (ladeKeller). bot:112-Aktionen
// übergeben eine vorformulierte Frage an das Assistent-Widget (Ereignis
// ASSISTENT_EVENT, siehe components/assistent/AssistentWidget.tsx) – jede
// Buchung wird dort wie gewohnt vom Menschen bestätigt.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, Sparkles } from 'lucide-react'
import { Badge, fmtNum, fmtDate } from '../_shared/ui'
import { STATUS_LABEL, type Charge } from '../_shared/types'

export const ASSISTENT_EVENT = 's112:assistent'

const PHASEN: { status: string; label: string; hinweis: string }[] = [
  { status: 'ernte',      label: 'Lese / Übernahme', hinweis: 'Maische, Pressung' },
  { status: 'gaerung',    label: 'Gärung',           hinweis: 'Gärkontrolle' },
  { status: 'ausbau',     label: 'Ausbau',           hinweis: 'Abstich, Schwefelung' },
  { status: 'abfuellung', label: 'Füllfertig',       hinweis: 'Abfüllung planen' },
]

export default function ChargenKanban({ chargen, assistentAktiv }: { chargen: Charge[]; assistentAktiv: boolean }) {
  const [aktiv, setAktiv] = useState<Charge | null>(null)

  useEffect(() => {
    if (!aktiv) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAktiv(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aktiv])

  const frageBot = (text: string) => {
    window.dispatchEvent(new CustomEvent(ASSISTENT_EVENT, { detail: { nachricht: text } }))
    setAktiv(null)
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {PHASEN.map(p => {
          const items = chargen.filter(c => c.status === p.status)
          return (
            <div key={p.status} className="bg-[#EEF1F5] rounded-[10px] p-2.5 min-h-[120px]">
              <h3 className="flex items-center justify-between font-mono text-[11px] font-semibold uppercase tracking-[.05em] text-s112-text-2 px-1.5 pt-0.5 pb-2">
                {p.label}<span className="text-s112-tertiary">{items.length}</span>
              </h3>
              {items.length === 0 && <p className="px-1.5 pb-1 text-[11.5px] text-s112-tertiary">keine Charge</p>}
              {items.map(c => (
                <button key={c.id} type="button" onClick={() => setAktiv(c)}
                  className="w-full text-left bg-white border border-s112-line rounded-lg px-3 py-2.5 mb-2 hover:shadow-[0_2px_8px_rgba(14,60,98,.14)] hover:-translate-y-px transition-all">
                  <p className="text-[13.5px] font-semibold text-s112-text truncate">{c.name}</p>
                  <p className="text-[12px] text-s112-text-2 mb-1.5 truncate">{[c.jahrgang, c.rebsorte].filter(Boolean).join(' · ') || p.hinweis}</p>
                  {c.messungFaellig
                    ? <Badge tone="warn">Messung fällig</Badge>
                    : <span className="font-mono text-[11px] text-s112-text-2">{c.behaelter ?? '– '}{c.menge_liter ? ` · ${fmtNum(c.menge_liter)} L` : ''}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {aktiv && (
        <div className="fixed inset-0 z-[90] bg-[rgba(10,26,42,.5)] px-4 py-[4vh] overflow-y-auto" onMouseDown={e => { if (e.target === e.currentTarget) setAktiv(null) }}>
          <div role="dialog" aria-modal="true" className="max-w-[720px] mx-auto bg-white rounded-xl border border-s112-line p-6 relative">
            <button type="button" onClick={() => setAktiv(null)} aria-label="Schließen"
              className="absolute top-3.5 right-3.5 w-8 h-8 rounded-md bg-[#EEF1F5] text-s112-text-2 hover:bg-s112-line flex items-center justify-center">
              <X size={15} strokeWidth={1.75} />
            </button>
            <h2 className="font-display text-[20px] font-semibold text-s112-navy pr-10">{aktiv.name}</h2>
            <p className="text-[13px] text-s112-text-2 mt-0.5 mb-4">
              Phase: <b className="font-semibold text-s112-text">{STATUS_LABEL[aktiv.status] ?? aktiv.status}</b>
              {aktiv.behaelter && <> · {aktiv.behaelter}</>}{aktiv.menge_liter ? <> · {fmtNum(aktiv.menge_liter)} L</> : null}
              {aktiv.jahrgang && <> · Jahrgang {aktiv.jahrgang}</>}{aktiv.rebsorte && <> · {aktiv.rebsorte}</>}
            </p>

            <div className="grid grid-cols-[minmax(150px,40%)_1fr] text-[13px]">
              <Kv k="Letzte Analyse">
                {aktiv.letzteAnalyse
                  ? <span className="font-mono text-[12.5px]">{fmtDate(aktiv.letzteAnalyse.datum)}{aktiv.tageSeitMessung !== null ? ` (vor ${aktiv.tageSeitMessung} T)` : ''}</span>
                  : <span className="text-s112-tertiary">keine Analyse erfasst</span>}
              </Kv>
              <Kv k="Alkohol / Restzucker">
                <span className="font-mono text-[12.5px]">
                  {aktiv.letzteAnalyse?.alkohol_vol != null ? `${fmtNum(Number(aktiv.letzteAnalyse.alkohol_vol), 1)} % vol` : '–'}
                  {' / '}
                  {aktiv.letzteAnalyse?.restzucker_gl != null ? `${fmtNum(Number(aktiv.letzteAnalyse.restzucker_gl), 1)} g/l` : '–'}
                </span>
              </Kv>
              <Kv k="Freie SO₂ / Säure">
                <span className="font-mono text-[12.5px]">
                  {aktiv.letzteAnalyse?.freie_so2_mgl != null ? `${fmtNum(Number(aktiv.letzteAnalyse.freie_so2_mgl))} mg/l` : '–'}
                  {' / '}
                  {aktiv.letzteAnalyse?.gesamtsaeure_gl != null ? `${fmtNum(Number(aktiv.letzteAnalyse.gesamtsaeure_gl), 1)} g/l` : '–'}
                </span>
              </Kv>
              <Kv k="Letzte Maßnahme">
                {aktiv.letzteMassnahme
                  ? <>{aktiv.letzteMassnahme.typ ?? 'Kellerbehandlung'} · {fmtDate(aktiv.letzteMassnahme.datum)}{aktiv.letzteMassnahme.menge ? ` · ${fmtNum(Number(aktiv.letzteMassnahme.menge), 1)} ${aktiv.letzteMassnahme.einheit ?? ''}` : ''}</>
                  : <span className="text-s112-tertiary">keine Kellerbehandlung erfasst</span>}
              </Kv>
              <Kv k="Qualitätsstufe">{aktiv.qualitaetsstufe ?? <span className="text-s112-tertiary">–</span>}</Kv>
              <Kv k="Herkunft"><Link href="/kellerbuch/rueckverfolgung" className="text-s112-blue-700 hover:underline">Rückverfolgung bis Grundstück →</Link></Kv>
            </div>

            {/* bot:112 */}
            <div className="mt-4 rounded-[10px] border border-s112-blue-100 bg-gradient-to-br from-[#F1F6FD] to-[#EDF3FA] p-4">
              <h3 className="flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[.05em] text-s112-blue-700">
                <Sparkles size={15} strokeWidth={1.75} className="text-s112-teal" /> bot:112 – KI-Unterstützung
              </h3>
              {assistentAktiv ? (
                <>
                  <p className="text-[12.5px] text-s112-text-2 mt-1.5">Fragen zur Charge stellen oder eine Routineaufgabe anstoßen – jede Buchung wird vor dem Speichern von dir bestätigt.</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {aktiv.status === 'gaerung' && (
                      <BotButton onClick={() => frageBot(`Analysiere den Gärverlauf der Charge „${aktiv.name}“${aktiv.behaelter ? ` (${aktiv.behaelter})` : ''}: Wie entwickeln sich Restzucker und Temperatur laut den erfassten Analysen, gibt es Hinweise auf eine Gärstockung, und wann sollte die nächste Messung erfolgen?`)}>Gärverlauf analysieren</BotButton>
                    )}
                    {['ausbau', 'abfuellung'].includes(aktiv.status) && (
                      <BotButton onClick={() => frageBot(`Entwirf eine kurze Weinbeschreibung (Etikett/Preisliste) für die Charge „${aktiv.name}“${aktiv.rebsorte ? `, Rebsorte ${aktiv.rebsorte}` : ''}${aktiv.jahrgang ? `, Jahrgang ${aktiv.jahrgang}` : ''} auf Basis der erfassten Analysewerte und Herkunft.`)}>Entwurf: Weinbeschreibung</BotButton>
                    )}
                    <BotButton onClick={() => frageBot(`Ich möchte eine Kellerbehandlung für die Charge „${aktiv.name}“${aktiv.behaelter ? ` in ${aktiv.behaelter}` : ''} erfassen.`)}>Kellerbehandlung erfassen</BotButton>
                    {aktiv.status === 'abfuellung' && (
                      <BotButton onClick={() => frageBot(`Ich möchte die Charge „${aktiv.name}“ abfüllen.`)}>Abfüllen</BotButton>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-[12.5px] text-s112-tertiary mt-1.5">bot:112 ist für diesen Betrieb nicht aktiviert (Betriebseinstellungen) oder deine Rolle ist nur lesend.</p>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-s112-line p-3.5">
              <h3 className="text-[13px] font-semibold text-s112-text mb-1">Notizen</h3>
              <p className={`text-[13px] whitespace-pre-wrap ${aktiv.notizen ? 'text-s112-text' : 'text-s112-tertiary'}`}>{aktiv.notizen || 'Noch keine Einträge.'}</p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Link href={`/kellerbuch/weinausbau/${aktiv.id}`} className="btn-primary text-[13px] py-1.5">Charge öffnen</Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <div className="py-1.5 border-b border-s112-line text-s112-text-2">{k}</div>
      <div className="py-1.5 border-b border-s112-line font-medium">{children}</div>
    </>
  )
}
function BotButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-s112-teal bg-white text-s112-blue-700 text-[12.5px] font-medium hover:bg-s112-blue-50 transition-colors">
      ✦ {children}
    </button>
  )
}
