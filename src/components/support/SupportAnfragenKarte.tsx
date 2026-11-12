'use client'

// KAN-438 (12.11.2026): Karte „Support-Anfragen“ auf der Übersicht – die offenen Anfragen aller Betriebe des Benutzers
// (höchstens fünf), „alle →“ führt zur Support-Seite. Die Karte lädt nach dem Seitenaufbau über /api/support/anfragen,
// damit die Übersicht nicht auf Jira wartet; ist Jira nicht erreichbar, steht hier ein Hinweis statt einer Fehlerseite.

import { useEffect, useState } from 'react'
import Link from '@/components/ui/Link'
import { fehlerText } from '@/lib/fehler'
import { offeneAnfragen, type SupportTicket } from '@/lib/support/tickets'
import { Faellig, StatusMarke } from './SupportTickets'

type Stand = { aktiv: boolean; anfragen: SupportTicket[]; heute?: string; fehler?: string }

export default function SupportAnfragenKarte() {
  const [stand, setStand] = useState<Stand | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    let abgebrochen = false
    fetch('/api/support/anfragen', { cache: 'no-store' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.fehler ?? `HTTP ${r.status}`)
        return d as Stand
      })
      .then(d => { if (!abgebrochen) setStand(d) })
      .catch(e => { if (!abgebrochen) setFehler(fehlerText(e)) })
    return () => { abgebrochen = true }
  }, [])

  const { zeilen, offen } = offeneAnfragen(stand?.anfragen ?? [])
  const heute = stand?.heute ?? ''
  return (
    <div className="bg-white border border-s112-line rounded-xl p-[18px]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Support-Anfragen{stand?.aktiv && offen > 0 ? ` (${offen} offen)` : ''}</h2>
        <Link href="/hilfe/support" className="text-[11.5px] text-s112-blue-700 hover:underline">alle →</Link>
      </div>
      {fehler || stand?.fehler ? (
        <p role="status" className="text-[13px] text-s112-text-2">Die Support-Anfragen sind gerade nicht abrufbar ({fehler ?? stand?.fehler}).</p>
      ) : !stand ? (
        <p className="text-[13px] text-s112-muted">Wird geladen …</p>
      ) : !stand.aktiv ? (
        <p className="text-[13px] text-s112-text-2">Fragen und Probleme meldest du unter <Link href="/hilfe/support" className="text-s112-blue-700 hover:underline">Hilfe › Support</Link>.</p>
      ) : zeilen.length === 0 ? (
        <p className="text-[13px] text-s112-text-2">Keine offenen Anfragen. <Link href="/hilfe/support" className="text-s112-blue-700 hover:underline">Problem melden</Link></p>
      ) : (
        <ul className="divide-y divide-s112-line">
          {zeilen.map(t => (
            <li key={t.key} className="py-2 flex items-start gap-2">
              <Link href="/hilfe/support" className="flex-1 min-w-0 group">
                <span className="block text-[13px] text-s112-text group-hover:text-s112-blue-700 truncate">
                  <span className="font-mono text-[11px] text-s112-tertiary mr-1.5">{t.key}</span>{t.betreff}
                </span>
                <span className="block text-[11px] text-s112-tertiary">
                  {[t.typ, t.betrieb, t.bearbeiter ?? 'noch kein Bearbeiter'].filter(Boolean).join(' · ')}
                  {(t.sla || t.faellig) && heute && <> · fällig <Faellig t={t} heute={heute} kurz /></>}
                </span>
              </Link>
              <StatusMarke t={t} />
            </li>
          ))}
        </ul>
      )}
      {stand?.aktiv && offen > zeilen.length && <p className="text-[11.5px] text-s112-tertiary mt-2">und {offen - zeilen.length} weitere</p>}
    </div>
  )
}
