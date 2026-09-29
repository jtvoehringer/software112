'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import VerschneidungForm from '@/components/kellerbuch/VerschneidungForm'
import { deleteVerschneidung } from '@/app/(dashboard)/kellerbuch/actions'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { GitMerge } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'

type ChargeOpt = { id: string; name: string; menge_liter: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null; rebsorte?: string | null; weinart?: string | null; behaelter_id?: string | null; behaelter_volumen_liter?: number | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  /** KAN-76: Rebsorten-Anteile des heutigen Bestands (lib/wein/mischungsrechnung.ts), null = keine Chips */
  bestehtAus?:         { wert: string; anteil_pct: number }[] | null
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

// Storno (KAN-35): nur möglich, solange die Ziel-Charge seither nicht weiterbewegt wurde und
// die Menge noch vollständig hat – sonst zeigt der Server den Grund, der hier erscheint.
function StornoButton({ id, zielId }: { id: string; zielId: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (fehler) {
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span role="alert" className="text-[11px] text-s112-err-fg w-[260px] max-w-[70vw] text-left whitespace-normal break-words">{fehler}</span>
        <button onClick={() => setFehler(null)} className="text-xs text-s112-text-2 hover:text-s112-text-1">Schließen</button>
      </span>
    )
  }

  if (confirm) {
    return (
      <span className="flex items-center gap-1">
        <span className="text-xs text-s112-err-fg">Wirklich stornieren?</span>
        <button
          onClick={() => startTransition(async () => {
            try {
              await deleteVerschneidung(id)
              setConfirm(false)
              router.push(`/kellerbuch/weinausbau/${zielId}`)
              router.refresh()
            } catch (err) {
              setConfirm(false)
              setFehler(fehlerText(err, 'Storno fehlgeschlagen'))
            }
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
      title="Verschneidung stornieren (nur solange die Ziel-Charge seither nicht weiterbewegt wurde)"
    >
      Storno
    </button>
  )
}

export default function VerschneidungWidget({ bestehtAus = null, zielCharge, alleChargen, verschneidungen, initialOpen = false, initialQuelleId, initialQuelleMenge }: Props) {
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

      {bestehtAus && bestehtAus.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-s112-text-2 uppercase tracking-wide">Besteht aus:</span>
          {bestehtAus.map(q => (
            <span key={q.wert} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F2F3F5] border border-s112-line-str text-xs text-s112-text-1 font-medium">
              {q.wert === 'unbekannt' ? 'Herkunft unbekannt' : formatRebsorteMitKuerzel(q.wert)}
              <span className="text-s112-text-1 font-normal">{fmtNum(q.anteil_pct)} %</span>
            </span>
          ))}
        </div>
      )}

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
