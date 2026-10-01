'use client'

import { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { Pencil, Trash2, X } from 'lucide-react'
import { deleteLage, assignWeingartenToLage } from './actions'
import type { Lage, WeingartenRow } from './page'
import { fmtHa } from '@/lib/format'

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

// ── Lage-Karte ────────────────────────────────────────────────────────────────
function LageKarte({
  lage, weingaerten, alleWeingaerten, writeOk, adminOk,
}: {
  lage: Lage
  weingaerten: WeingartenRow[]       // dieser Lage zugeordnet
  alleWeingaerten: WeingartenRow[]   // alle (für Zuweisung)
  writeOk: boolean
  adminOk: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const haTotal = weingaerten.reduce((s, w) => s + (w.flaeche_ha ?? 0), 0)

  function handleDelete() {
    if (weingaerten.length > 0) {
      alert(`Diese Ried hat noch ${weingaerten.length} Weingarten/Weingärten. Bitte zuerst die Zuordnungen entfernen.`)
      return
    }
    if (!confirm(`Ried "${lage.name}" wirklich löschen?`)) return
    startTransition(async () => {
      const result = await deleteLage(lage.id)
      if (result?.error) alert(`Fehler beim Löschen: ${result.error}`)
    })
  }

  function handleAssign(weingartenId: string, assign: boolean) {
    startTransition(() => assignWeingartenToLage(weingartenId, assign ? lage.id : null))
  }

  // nicht zugeordnete Weingärten zum Hinzufügen
  const verfuegbar = alleWeingaerten.filter(w => !w.lage_id || w.lage_id === lage.id)

  return (
    <div className={`card p-0 overflow-hidden ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-s112-bg border-b border-s112-border cursor-pointer hover:bg-s112-bg/80 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-s112-blue-700"><ChevronIcon open={open} /></span>
          <div>
            <span className="font-semibold text-s112-text">{lage.name}</span>
            {lage.gemeinde && <span className="ml-2 text-xs text-s112-muted">{lage.gemeinde}</span>}
            {/* KAN-165: aus den Grundstücken abgeleitet, sonst der früher erfasste Freitext */}
            {lage.gebieteAbgeleitet.length > 0
              ? <span className="ml-2 text-xs text-s112-tertiary" title="aus dem Herkunft-Code (BKI) der Grundstücke">{lage.gebieteAbgeleitet.join(', ')}</span>
              : lage.weinbaugebiet && <span className="ml-2 text-xs text-s112-tertiary" title="früher erfasst – Herkunft-Code der Grundstücke fehlt">{lage.weinbaugebiet}</span>}
          </div>
          <span className="text-xs text-s112-muted bg-white px-2 py-0.5 rounded-full border border-s112-border">
            {weingaerten.length} WG · {fmtHa(haTotal, 2)} ha
          </span>
        </div>
        <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
          {writeOk && (
            <Link href={`/lagen/${lage.id}`}
              title="Bearbeiten" aria-label="Bearbeiten"
              className="text-s112-blue-700 hover:text-s112-blue-700/70">
              <Pencil size={16} strokeWidth={2} />
            </Link>
          )}
          {adminOk && (
            <button onClick={handleDelete}
              title="Löschen" aria-label="Löschen"
              className="text-s112-err hover:text-s112-err-fg">
              <Trash2 size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="p-4">
          {/* Zugeordnete Weingärten */}
          {weingaerten.length > 0 ? (
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="text-left border-b border-s112-border">
                  <th className="pb-1 font-medium text-s112-text-2">Weingarten</th>
                  <th className="pb-1 font-medium text-s112-text-2">Rebsorte</th>
                  <th className="pb-1 font-medium text-s112-text-2 text-right">Fläche (ha)</th>
                  {writeOk && <th className="pb-1" />}
                </tr>
              </thead>
              <tbody>
                {weingaerten.map(w => (
                  <tr key={w.id} className="border-b border-s112-border/50 last:border-0">
                    <td className="py-1.5 font-medium text-s112-text">{w.name}</td>
                    <td className="py-1.5 text-s112-muted">{w.rebsorte ?? '–'}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtHa(w.flaeche_ha)}
                    </td>
                    {writeOk && (
                      <td className="py-1.5 text-right">
                        <button
                          onClick={() => handleAssign(w.id, false)}
                          className="text-xs text-s112-tertiary hover:text-s112-err transition-colors"
                          title="Zuordnung entfernen"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-s112-muted mb-4">Noch keine Weingärten zugeordnet.</p>
          )}

          {/* Weingarten zuordnen */}
          {writeOk && verfuegbar.filter(w => w.lage_id !== lage.id).length > 0 && (
            <div className="border-t border-s112-border pt-3">
              <p className="text-xs font-medium text-s112-text-2 mb-2">Weingarten hinzufügen:</p>
              <div className="flex flex-wrap gap-2">
                {verfuegbar
                  .filter(w => w.lage_id !== lage.id)
                  .map(w => (
                    <button
                      key={w.id}
                      onClick={() => handleAssign(w.id, true)}
                      className="text-xs bg-s112-bg hover:bg-s112-teal/10 border border-s112-border hover:border-s112-teal text-s112-text-1 hover:text-s112-blue-700 px-2 py-1 rounded-lg transition-colors"
                    >
                      + {w.name}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {lage.notizen && (
            <p className="text-xs text-s112-muted mt-3 italic">{lage.notizen}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function LagenClient({
  lagen, weingaerten, writeOk, adminOk,
}: {
  lagen: Lage[]; weingaerten: WeingartenRow[]; writeOk: boolean; adminOk: boolean
}) {
  const wgMap = new Map<string, WeingartenRow[]>()
  for (const l of lagen) wgMap.set(l.id, [])
  for (const w of weingaerten) {
    if (w.lage_id && wgMap.has(w.lage_id)) {
      wgMap.get(w.lage_id)!.push(w)
    }
  }

  const unzugeordnet = weingaerten.filter(w => !w.lage_id)

  if (lagen.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="text-s112-text-1 font-medium">Noch keine Lagen angelegt</p>
        <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihre erste Ried an</p>
        {writeOk && (
          <Link href="/lagen/neu" className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Erste Lage
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {lagen.map(l => (
        <LageKarte
          key={l.id}
          lage={l}
          weingaerten={wgMap.get(l.id) ?? []}
          alleWeingaerten={weingaerten}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      ))}

      {unzugeordnet.length > 0 && (
        <div className="card border-dashed border-s112-warn/30 bg-s112-warn-bg/50 p-4">
          <p className="text-sm font-medium text-s112-warn-fg mb-2">
            {unzugeordnet.length} Weingarten/Weingärten ohne Ried
          </p>
          <div className="flex flex-wrap gap-1">
            {unzugeordnet.map(w => (
              <span key={w.id} className="text-xs bg-white border border-s112-warn/30 text-s112-warn-fg px-2 py-0.5 rounded">
                {w.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
