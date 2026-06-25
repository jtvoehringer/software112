'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import VerschneidungForm from '@/components/kellerbuch/VerschneidungForm'
import { deleteVerschneidung } from '@/app/(dashboard)/kellerbuch/actions'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'

type ChargeOpt = { id: string; name: string; menge_liter: number | null; qualitaetsstufe?: string | null; rebsorte?: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  zielCharge:      ChargeOpt
  alleChargen:     ChargeOpt[]
  verschneidungen: R[]
  initialOpen?:    boolean
}

function fmtDate(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function StornoButton({ id, zielId }: { id: string; zielId: string }) {
  const [confirm, setConfirm] = useState(false)
  const [pending, startTransition] = useTransition()

  if (confirm) {
    return (
      <span className="flex items-center gap-1">
        <span className="text-xs text-red-600">Wirklich stornieren?</span>
        <button
          onClick={() => startTransition(async () => {
            await deleteVerschneidung(id)
            void zielId
          })}
          disabled={pending}
          className="text-xs bg-red-600 text-white px-2 py-0.5 rounded font-medium disabled:opacity-50"
        >
          {pending ? '…' : 'Ja'}
        </button>
        <button onClick={() => setConfirm(false)} className="text-xs text-gray-500 hover:text-gray-700 px-1">
          Nein
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="text-xs text-red-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
      title="Verschneidung stornieren"
    >
      Storno
    </button>
  )
}

export default function VerschneidungWidget({ zielCharge, alleChargen, verschneidungen, initialOpen = false }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(initialOpen)
  useEffect(() => { setShowForm(initialOpen) }, [initialOpen])

  function handleClose() {
    setShowForm(false)
    router.push(`/kellerbuch/weinausbau/${zielCharge.id}`)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">🍷 Verschneidungen</h2>
      </div>

      {showForm && (
        <div className="mb-4">
          <VerschneidungForm
            zielCharge={zielCharge}
            alleChargen={alleChargen}
            onDone={() => {
              setShowForm(false)
              router.push(`/kellerbuch/weinausbau/${zielCharge.id}`)
              router.refresh()
            }}
          />
          <button type="button" onClick={handleClose}
            className="mt-2 text-sm text-s112-muted hover:text-gray-700 transition-colors">
            Abbrechen
          </button>
        </div>
      )}

      {verschneidungen.length > 0 && (() => {
        const quellenMap: Record<string, { name: string; menge: number }> = {}
        let gesamtMenge = 0
        for (const v of verschneidungen) {
          for (const q of ((v.quellen ?? []) as R[])) {
            const name = (q.quelle as R | null)?.name ?? '?'
            const id   = (q.quelle as R | null)?.id ?? name
            const ml   = parseFloat(q.menge_liter) || 0
            if (!quellenMap[id]) quellenMap[id] = { name, menge: 0 }
            quellenMap[id].menge += ml
            gesamtMenge += ml
          }
        }
        const gesamtVerschnittMenge = gesamtMenge
        const originalMenge = (zielCharge.menge_liter ?? 0) - gesamtVerschnittMenge
        if (originalMenge > 0.5 && zielCharge.rebsorte && zielCharge.rebsorte !== 'Sortenverschnitt') {
          quellenMap['__original__'] = { name: zielCharge.rebsorte, menge: originalMenge }
          gesamtMenge += originalMenge
        }
        const quellenliste = Object.values(quellenMap).sort((a, b) => b.menge - a.menge)
        if (quellenliste.length === 0) return null
        return (
          <div className="mb-3 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Besteht aus:</span>
            {quellenliste.map((q, i) => {
              const pct = gesamtMenge > 0 ? Math.round((q.menge / gesamtMenge) * 1000) / 10 : 0
              return (
                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-200 text-xs text-violet-800 font-medium">
                  {q.name}
                  <span className="text-violet-500 font-normal">{pct.toLocaleString('de-AT')} %</span>
                </span>
              )
            })}
          </div>
        )
      })()}

      {verschneidungen.length > 0 ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="text-left px-4 py-2 font-semibold">Datum</th>
                <th className="text-left px-4 py-2 font-semibold">Quellen</th>
                <th className="text-left px-4 py-2 font-semibold">Notizen</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {verschneidungen.map((v: R) => (
                <tr key={v.id} className="group border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30">
                  <td className="px-4 py-2.5 text-s112-muted tabular-nums whitespace-nowrap">
                    {fmtDate(v.datum)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="space-y-0.5">
                      {((v.quellen ?? []) as R[]).map((q: R, i: number) => {
                        const ql = (q.quelle as R | null)?.qualitaetsstufe
                        return (
                          <p key={i} className="text-xs flex items-center gap-1.5">
                            <span className="font-medium text-gray-800">{(q.quelle as R | null)?.name ?? '?'}</span>
                            {q.menge_liter != null && (
                              <span className="text-s112-muted">
                                {parseFloat(q.menge_liter).toLocaleString('de-AT')} L
                                {q.anteil_pct != null && ` (${q.anteil_pct} %)`}
                              </span>
                            )}
                            {ql && (
                              <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-full">
                                {QUALITAET_LABEL[ql] ?? ql}
                              </span>
                            )}
                          </p>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-s112-muted">{v.notizen ?? '–'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <StornoButton id={v.id} zielId={zielCharge.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !showForm && (
          <div className="card border-dashed text-center py-6 text-sm text-s112-muted">
            Noch keine Verschneidungen für diese Partie erfasst.
          </div>
        )
      )}
    </section>
  )
}
