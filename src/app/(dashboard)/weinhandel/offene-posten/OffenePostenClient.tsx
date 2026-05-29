'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { markiereAlsBezahlt } from '../verkauf/actions'

type Posten = {
  id: string
  datum: string
  rechnungsnummer: string | null
  bezahlt: boolean
  bezahlt_am: string | null
  gesamt: number
  kundenName: string
  kontaktId: string | null
  firmaId: string | null
}

function fmt(n: number) {
  return n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
}

function PostenZeile({ p, writeOk }: { p: Posten; writeOk: boolean }) {
  const [pending, startTransition] = useTransition()

  function handleBezahlt() {
    startTransition(async () => { await markiereAlsBezahlt(p.id) })
  }

  return (
    <tr className={`border-b border-s112-border last:border-0 hover:bg-s112-bg/50 transition-colors ${p.bezahlt ? 'opacity-60' : ''}`}>
      <td className="px-4 py-3 text-sm tabular-nums text-s112-muted">
        {new Date(p.datum).toLocaleDateString('de-AT')}
      </td>
      <td className="px-4 py-3">
        <Link href={`/weinhandel/verkauf/${p.id}`}
          className="text-sm font-mono font-semibold text-s112-teal hover:underline">
          {p.rechnungsnummer ?? '–'}
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-gray-800">
        {p.kontaktId ? (
          <Link href={`/crm/kontakte/${p.kontaktId}`} className="hover:text-s112-teal hover:underline">
            {p.kundenName}
          </Link>
        ) : p.firmaId ? (
          <Link href={`/crm/firmen/${p.firmaId}`} className="hover:text-s112-teal hover:underline">
            {p.kundenName}
          </Link>
        ) : (
          <span>{p.kundenName}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-s112-teal tabular-nums">
        {fmt(p.gesamt)}
      </td>
      <td className="px-4 py-3 text-center">
        {p.bezahlt ? (
          <div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Bezahlt</span>
            {p.bezahlt_am && (
              <p className="text-[10px] text-s112-muted mt-0.5">
                {new Date(p.bezahlt_am).toLocaleDateString('de-AT')}
              </p>
            )}
          </div>
        ) : writeOk ? (
          <button
            onClick={handleBezahlt}
            disabled={pending}
            className="text-xs font-medium text-green-700 border border-green-300 rounded-full px-3 py-0.5 hover:bg-green-500 hover:text-white hover:border-green-500 transition-colors disabled:opacity-40"
          >
            {pending ? '…' : 'Als bezahlt markieren'}
          </button>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Offen</span>
        )}
      </td>
    </tr>
  )
}

export default function OffenePostenClient({
  offene, bezahlte, summeOffen, writeOk,
}: {
  offene:     Posten[]
  bezahlte:   Posten[]
  summeOffen: number
  writeOk:    boolean
}) {
  const [showBezahlt, setShowBezahlt] = useState(false)
  const alle = showBezahlt ? [...offene, ...bezahlte] : offene

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Offene Posten</h1>
          <p className="text-sm text-s112-muted mt-0.5">
            {offene.length} offene {offene.length === 1 ? 'Rechnung' : 'Rechnungen'}
          </p>
        </div>
        <div className="card px-5 py-3 text-right">
          <p className="text-xs text-s112-muted">Offener Gesamtbetrag</p>
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{fmt(summeOffen)}</p>
        </div>
      </div>

      {/* Toggle bezahlte anzeigen */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showBezahlt}
            onChange={e => setShowBezahlt(e.target.checked)}
            className="rounded accent-s112-teal"
          />
          Bezahlte Rechnungen anzeigen ({bezahlte.length})
        </label>
        <Link href="/weinhandel/verkauf" className="text-xs text-s112-teal hover:underline">
          → Alle Verkäufe
        </Link>
      </div>

      {/* Tabelle */}
      {alle.length === 0 ? (
        <div className="card p-12 text-center text-s112-muted text-sm">
          {offene.length === 0
            ? '✓ Keine offenen Rechnungen – alles bezahlt!'
            : 'Keine Einträge vorhanden.'}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Datum</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Belegnr.</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Kunde</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Betrag</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {alle.map(p => (
                <PostenZeile key={p.id} p={p} writeOk={writeOk} />
              ))}
            </tbody>
            {offene.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-s112-border bg-s112-bg">
                  <td colSpan={3} className="px-4 py-3 text-right font-semibold text-gray-700">
                    Offen gesamt
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-lg text-s112-teal tabular-nums">
                    {fmt(summeOffen)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
