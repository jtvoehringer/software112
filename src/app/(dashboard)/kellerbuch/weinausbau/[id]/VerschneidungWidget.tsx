'use client'

import { useState } from 'react'
import VerschneidungForm from '@/components/kellerbuch/VerschneidungForm'

type ChargeOpt = { id: string; name: string; menge_liter: number | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  zielCharge:      ChargeOpt
  alleChargen:     ChargeOpt[]
  verschneidungen: R[]
}

function fmtDate(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function VerschneidungWidget({ zielCharge, alleChargen, verschneidungen }: Props) {
  const [showForm, setShowForm] = useState(false)

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">🍷 Verschneidungen</h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors font-medium"
          >
            ＋ Verschneidung erfassen
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4">
          <VerschneidungForm
            zielCharge={zielCharge}
            alleChargen={alleChargen}
            onDone={() => setShowForm(false)}
          />
        </div>
      )}

      {verschneidungen.length > 0 ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="text-left px-4 py-2 font-semibold">Datum</th>
                <th className="text-left px-4 py-2 font-semibold">Quellen</th>
                <th className="text-left px-4 py-2 font-semibold">Notizen</th>
              </tr>
            </thead>
            <tbody>
              {verschneidungen.map((v: R) => (
                <tr key={v.id} className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30">
                  <td className="px-4 py-2.5 text-s112-muted tabular-nums whitespace-nowrap">
                    {fmtDate(v.datum)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="space-y-0.5">
                      {((v.quellen ?? []) as R[]).map((q: R, i: number) => (
                        <p key={i} className="text-xs">
                          <span className="font-medium text-gray-800">{(q.quelle as R | null)?.name ?? '?'}</span>
                          {q.menge_liter != null && (
                            <span className="text-s112-muted ml-1">
                              {parseFloat(q.menge_liter).toLocaleString('de-AT')} L
                              {q.anteil_pct != null && ` (${q.anteil_pct} %)`}
                            </span>
                          )}
                        </p>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-s112-muted">{v.notizen ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !showForm && (
          <div className="card border-dashed text-center py-6 text-sm text-s112-muted">
            Noch keine Verschneidungen für diese Charge erfasst.
          </div>
        )
      )}
    </section>
  )
}
