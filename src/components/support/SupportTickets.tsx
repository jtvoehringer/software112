'use client'

// KAN-438 (12.11.2026): Support-Anfragen in der Darstellung der Hohenstein Suite – Ticket (Nummer, Betreff, Typ),
// Betrieb und Melder, Status nach Phase, Priorität, Bearbeiter, Erstellt, Fällig laut SLA. Ab md als Tabelle, am Handy
// als Karten. „Verlauf“ klappt je Anfrage auf (der Aufrufer liefert den Inhalt), die Karte auf der Übersicht nutzt
// dieselben Bausteine (StatusMarke, Faellig) in der kompakten Form.

import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, Pause } from 'lucide-react'
import { PHASE_KLASSE, alterText, istUeberfaellig, prioritaetHoch, type SupportTicket } from '@/lib/support/tickets'

const TZ = 'Europe/Vienna'
const tagWien = (iso: string) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ }) : '')   // JJJJ-MM-TT in Wiener Zeit
const datum = (iso: string) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('de-AT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '–')
const datumZeit = (iso: string) => new Date(iso).toLocaleString('de-AT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function StatusMarke({ t }: { t: Pick<SupportTicket, 'phase' | 'status'> }) {
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${PHASE_KLASSE[t.phase]}`}>{t.status}</span>
}

/** Fällig laut SLA „Time to resolution“ (sonst das manuelle Fälligkeitsdatum); erledigt → Datum der Erledigung */
export function Faellig({ t, heute, kurz = false }: { t: SupportTicket; heute: string; kurz?: boolean }) {
  if (t.erledigt) return <span className="text-s112-tertiary">{t.erledigtAm ? `erledigt ${datum(t.erledigtAm)}` : '–'}</span>
  const rot = istUeberfaellig(t, new Date(), heute)
  if (t.sla) {
    return (
      <span className={`inline-flex items-center gap-1 ${rot ? 'text-s112-err-fg font-semibold' : ''}`} title="Zugesagte Lösungszeit (SLA)">
        {t.sla.pausiert && <Pause className="w-3 h-3 text-s112-tertiary" aria-label="pausiert" />}
        {kurz ? datum(t.sla.faellig) : datumZeit(t.sla.faellig)}
        {rot && <span className="text-[10.5px]">überschritten</span>}
      </span>
    )
  }
  return <span className={rot ? 'text-s112-err-fg font-semibold' : ''}>{t.faellig ? datum(t.faellig) : '–'}</span>
}

function Prioritaet({ p }: { p: string | null }) {
  if (!p) return <span className="text-s112-tertiary">–</span>
  return <span className={prioritaetHoch(p) ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}>{p}</span>
}

function Betrieb({ t }: { t: SupportTicket }) {
  return (
    <>
      <span className="text-s112-text-1">{t.betrieb ?? (t.eigene ? 'Eigene Anfrage' : '–')}</span>
      <span className="block text-[11px] text-s112-tertiary">{t.melder ?? '–'}{t.eigene ? ' (du)' : ''}</span>
    </>
  )
}

export default function SupportTickets({ tickets, heute, offen, onVerlauf, verlauf }: {
  tickets: SupportTicket[]
  /** heute als JJJJ-MM-TT (Wien, vom Server) – für „heute / vor 3 Tagen“ und die Fälligkeit */
  heute: string
  /** Schlüssel der aufgeklappten Anfrage */
  offen: string | null
  onVerlauf: (key: string) => void
  /** Inhalt des aufgeklappten Verlaufs */
  verlauf: (t: SupportTicket) => ReactNode
}) {
  const knopf = (t: SupportTicket) => (
    <button type="button" onClick={() => onVerlauf(t.key)} aria-expanded={offen === t.key}
      className="text-s112-blue-700 hover:underline inline-flex items-center gap-1 text-[12.5px] whitespace-nowrap"
      aria-label={`Verlauf von ${t.key} ${offen === t.key ? 'schließen' : 'anzeigen'}`}>
      {offen === t.key ? <ChevronDown className="w-3 h-3" aria-hidden /> : <ChevronRight className="w-3 h-3" aria-hidden />} Verlauf
    </button>
  )
  return (
    <>
      {/* ab md: Tabelle */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-s112-tertiary border-b border-s112-line">
              <th className="px-3 py-2 font-semibold">Ticket</th>
              <th className="px-3 py-2 font-semibold">Betrieb</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Priorität</th>
              <th className="px-3 py-2 font-semibold">Bearbeiter</th>
              <th className="px-3 py-2 font-semibold">Erstellt</th>
              <th className="px-3 py-2 font-semibold">Fällig (SLA)</th>
              <th className="px-3 py-2"><span className="sr-only">Verlauf</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-s112-line">
            {tickets.map(t => (
              <FragmentZeile key={t.key} offen={offen === t.key} verlauf={() => verlauf(t)}>
                <td className="px-3 py-2 max-w-[360px]">
                  <span className="inline-flex items-start gap-1.5">
                    <span className="font-mono text-[11.5px] text-s112-tertiary pt-px shrink-0">{t.key}</span>
                    <span className="text-s112-text">{t.betreff}</span>
                  </span>
                  <span className="block text-[11px] text-s112-tertiary">{t.typ}</span>
                </td>
                <td className="px-3 py-2"><Betrieb t={t} /></td>
                <td className="px-3 py-2"><StatusMarke t={t} /></td>
                <td className="px-3 py-2"><Prioritaet p={t.prioritaet} /></td>
                <td className="px-3 py-2">{t.bearbeiter ?? <span className="text-s112-tertiary">noch offen</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {datum(t.erstellt)}<span className="block text-[11px] text-s112-tertiary">{alterText(tagWien(t.erstellt), heute)}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums"><Faellig t={t} heute={heute} /></td>
                <td className="px-3 py-2 text-right">{knopf(t)}</td>
              </FragmentZeile>
            ))}
          </tbody>
        </table>
      </div>

      {/* am Handy: Karten */}
      <ul className="md:hidden divide-y divide-s112-line">
        {tickets.map(t => (
          <li key={t.key} className="py-3 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm text-s112-text">
                <span className="font-mono text-[11.5px] text-s112-tertiary mr-1.5">{t.key}</span>{t.betreff}
              </p>
              <StatusMarke t={t} />
            </div>
            <p className="text-[11.5px] text-s112-tertiary">
              {[t.typ, t.betrieb, t.melder ? `${t.melder}${t.eigene ? ' (du)' : ''}` : null].filter(Boolean).join(' · ')}
            </p>
            <p className="text-[11.5px] text-s112-text-2 tabular-nums">
              {datum(t.erstellt)} ({alterText(tagWien(t.erstellt), heute)})
              {t.prioritaet ? <> · <Prioritaet p={t.prioritaet} /></> : null}
              {' · '}{t.bearbeiter ?? 'noch kein Bearbeiter'}
              {(t.erledigt || t.sla || t.faellig) && <> · {t.erledigt ? '' : 'fällig '}<Faellig t={t} heute={heute} kurz /></>}
            </p>
            {knopf(t)}
            {offen === t.key && <div className="pt-1">{verlauf(t)}</div>}
          </li>
        ))}
      </ul>
    </>
  )
}

/** Tabellenzeile samt aufgeklapptem Verlauf darunter (eigene Zeile über alle Spalten) */
function FragmentZeile({ children, offen, verlauf }: { children: ReactNode; offen: boolean; verlauf: () => ReactNode }) {
  return (
    <>
      <tr className="align-top hover:bg-s112-bg/60">{children}</tr>
      {offen && <tr><td colSpan={8} className="px-3 pb-3 bg-s112-bg/40">{verlauf()}</td></tr>}
    </>
  )
}
