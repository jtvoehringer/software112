'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import VerschneidungForm from '@/components/kellerbuch/VerschneidungForm'
import { deleteVerschneidung } from '@/app/(dashboard)/kellerbuch/actions'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { GitMerge } from 'lucide-react'
import { fmtNum } from '@/lib/format'

type ChargeOpt = { id: string; name: string; menge_liter: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null; rebsorte?: string | null; weinart?: string | null; behaelter_id?: string | null; behaelter_volumen_liter?: number | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  zielCharge:          ChargeOpt
  alleChargen:         ChargeOpt[]
  verschneidungen:     R[]
  initialOpen?:        boolean
  initialQuelleId?:    string
  initialQuelleMenge?: string
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
        <span className="text-xs text-s112-err-fg">Wirklich stornieren?</span>
        <button
          onClick={() => startTransition(async () => {
            await deleteVerschneidung(id)
            void zielId
          })}
          disabled={pending}
          className="text-xs bg-s112-err text-white px-2 py-0.5 rounded font-medium disabled:opacity-50"
        >
          {pending ? '…' : 'Ja'}
        </button>
        <button onClick={() => setConfirm(false)} className="text-xs text-s112-text-2 hover:text-s112-text-1 px-1">
          Nein
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="text-xs text-s112-err hover:text-s112-err-fg transition-colors opacity-0 group-hover:opacity-100"
      title="Verschneidung stornieren"
    >
      Storno
    </button>
  )
}

export default function VerschneidungWidget({ zielCharge, alleChargen, verschneidungen, initialOpen = false, initialQuelleId, initialQuelleMenge }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(initialOpen)
  const sectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    setShowForm(initialOpen)
    // Nach automatischem Öffnen (z.B. Redirect aus dem Umziehen nach erkanntem
    // Rebsortenmix) liegt diese Sektion oft weit unten auf der Seite (nach
    // Bewegungsbuch + Umziehen-Formular) - ohne aktives Hinscrollen sieht es dann so
    // aus, als hätte sich "kein Dialog geöffnet", obwohl das Formular tatsächlich
    // bereits offen ist, nur außerhalb des sichtbaren Bereichs (Bugreport 5.8.2026).
    if (initialOpen) {
      const t = setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
      return () => clearTimeout(t)
    }
  }, [initialOpen])

  function handleClose() {
    setShowForm(false)
    router.push(`/kellerbuch/weinausbau/${zielCharge.id}`)
  }

  return (
    <section ref={sectionRef}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-s112-text flex items-center gap-1.5">
          <GitMerge size={16} strokeWidth={1.75} className="text-s112-text-1" />Verschneidungen
        </h2>
      </div>

      {showForm && (
        <div className="mb-4">
          <VerschneidungForm
            zielCharge={zielCharge}
            alleChargen={alleChargen}
            initialQuelleId={initialQuelleId}
            initialQuelleMenge={initialQuelleMenge}
            onDone={() => {
              setShowForm(false)
              router.push(`/kellerbuch/weinausbau/${zielCharge.id}`)
              router.refresh()
            }}
          />
          <button type="button" onClick={handleClose}
            className="mt-2 text-sm text-s112-muted hover:text-s112-text-1 transition-colors">
            Abbrechen
          </button>
        </div>
      )}

      {verschneidungen.length > 0 && (() => {
        // Aggregation nach Rebsorte/Name – gleiche Rebsorten (auch über mehrere Verschneidungen) zusammenfassen
        // istRebsorte merkt sich, ob "name" wirklich eine Rebsorte ist (nur dann macht ein
        // Kürzel-Zusatz Sinn - beim Fallback auf den Chargen-Namen würde formatRebsorteMitKuerzel()
        // sonst einen unsinnigen 4-Buchstaben-"Kürzel" aus dem Namen erzeugen).
        const quellenMap: Record<string, { name: string; menge: number; istRebsorte: boolean }> = {}
        let gesamtMenge = 0
        for (const v of verschneidungen) {
          for (const q of ((v.quellen ?? []) as R[])) {
            const src    = q.quelle as R | null
            // Rebsorte bevorzugen; Fallback auf Name der Charge
            const rebsorteWert = src?.rebsorte ?? null
            const label  = rebsorteWert ?? src?.name ?? '?'
            const ml     = parseFloat(q.menge_liter) || 0
            if (!quellenMap[label]) quellenMap[label] = { name: label, menge: 0, istRebsorte: !!rebsorteWert }
            quellenMap[label].menge += ml
            gesamtMenge += ml
          }
        }
        const gesamtVerschnittMenge = gesamtMenge
        const originalMenge = (zielCharge.menge_liter ?? 0) - gesamtVerschnittMenge
        if (originalMenge > 0.5) {
          // Original-Anteil unter der Rebsorte des Ziel-Weins eintragen und ggf. mit
          // gleichnamiger Verschnitt-Quelle zusammenführen (z.B. 2× Rotgipfler → eine Bubble)
          const originalIstRebsorte = !!(zielCharge.rebsorte && zielCharge.rebsorte !== 'Sortenverschnitt')
          const originalLabel = originalIstRebsorte ? (zielCharge.rebsorte as string) : zielCharge.name
          if (quellenMap[originalLabel]) {
            quellenMap[originalLabel].menge += originalMenge
          } else {
            quellenMap[originalLabel] = { name: originalLabel, menge: originalMenge, istRebsorte: originalIstRebsorte }
          }
          gesamtMenge += originalMenge
        }
        const quellenliste = Object.values(quellenMap).sort((a, b) => b.menge - a.menge)
        if (quellenliste.length === 0) return null
        return (
          <div className="mb-3 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-s112-text-2 uppercase tracking-wide">Besteht aus:</span>
            {quellenliste.map((q, i) => {
              const pct = gesamtMenge > 0 ? Math.round((q.menge / gesamtMenge) * 1000) / 10 : 0
              return (
                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F2F3F5] border border-s112-line-str text-xs text-s112-text-1 font-medium">
                  {q.istRebsorte ? formatRebsorteMitKuerzel(q.name) : q.name}
                  <span className="text-s112-text-1 font-normal">{fmtNum(pct)} %</span>
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
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-s112-text-2">
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
                            <span className="font-medium text-s112-text">{(q.quelle as R | null)?.name ?? '?'}</span>
                            {q.menge_liter != null && (
                              <span className="text-s112-muted">
                                {fmtNum(parseFloat(q.menge_liter))} L
                                {q.anteil_pct != null && ` (${q.anteil_pct} %)`}
                              </span>
                            )}
                            {ql && (
                              <span className="text-xs bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg px-1.5 py-0.5 rounded-full">
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
