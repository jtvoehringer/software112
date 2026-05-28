'use client'

import { useState, useRef, useTransition, useCallback } from 'react'
import { upsertKellerplanPosition, deleteKellerplanPosition } from '../actions'

// ── Typen ─────────────────────────────────────────────────────────────────────

type Plan = { id: string; name: string; breite_m: number; laenge_m: number }

type Behaelter = {
  id: string
  name: string
  typ: string
  volumen_liter: number | null
}

type WeinInfo = { name: string; jahrgang: number | null; rebsorte: string | null }

type PosData = { pos_x_pct: number; pos_y_pct: number; breite_pct: number; hoehe_pct: number }

// ── Behälter-Darstellung ──────────────────────────────────────────────────────

const TYP: Record<string, { bg: string; border: string; label: string }> = {
  stahltank: { bg: '#f1f5f9', border: '#94a3b8', label: 'Stahltank' },
  holzfass:  { bg: '#fffbeb', border: '#d97706', label: 'Holzfass'  },
  betonei:   { bg: '#fafaf9', border: '#78716c', label: 'Betonei'   },
  amphore:   { bg: '#fff7ed', border: '#ea580c', label: 'Amphore'   },
  sonstiges: { bg: '#f9fafb', border: '#9ca3af', label: 'Sonstiges' },
}

const DEFAULT_W = 12  // % Canvas-Breite
const DEFAULT_H = 14  // % Canvas-Höhe

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function KellerplanEditor({
  plan,
  initialPositions,
  behaelter,
  weinMap,
  writeOk,
}: {
  plan: Plan
  initialPositions: Record<string, PosData>
  behaelter: Behaelter[]
  weinMap: Record<string, WeinInfo>
  writeOk: boolean
}) {
  const canvasRef                   = useRef<HTMLDivElement>(null)
  const dragStateRef                = useRef<{
    id: string
    startX: number; startY: number
    origX: number;  origY: number
  } | null>(null)
  const [, startTransition]         = useTransition()
  const [positions, setPositions]   = useState<Record<string, PosData>>(initialPositions)
  const [saving, setSaving]         = useState(false)

  const behaelterMap = Object.fromEntries(behaelter.map(b => [b.id, b]))
  const placedIds    = new Set(Object.keys(positions))
  const unplaced     = behaelter.filter(b => !placedIds.has(b.id))

  // Aspect ratio des Raums
  const aspect = plan.laenge_m / plan.breite_m

  // ── Persistenz ──────────────────────────────────────────────────────────────

  const savePos = useCallback((behaelterId: string, pos: PosData) => {
    setSaving(true)
    startTransition(async () => {
      await upsertKellerplanPosition(plan.id, behaelterId, pos)
      setSaving(false)
    })
  }, [plan.id, startTransition])

  // ── Platzieren aus Sidebar (HTML5 Drag) ──────────────────────────────────────

  function handleSidebarDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData('behaelter_id', id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleCanvasDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleCanvasDrop(e: React.DragEvent) {
    e.preventDefault()
    const id = e.dataTransfer.getData('behaelter_id')
    if (!id || !canvasRef.current) return

    const rect = canvasRef.current.getBoundingClientRect()
    const rawX = ((e.clientX - rect.left) / rect.width)  * 100
    const rawY = ((e.clientY - rect.top)  / rect.height) * 100
    const pos: PosData = {
      pos_x_pct:  Math.max(0, Math.min(100 - DEFAULT_W, rawX - DEFAULT_W / 2)),
      pos_y_pct:  Math.max(0, Math.min(100 - DEFAULT_H, rawY - DEFAULT_H / 2)),
      breite_pct: DEFAULT_W,
      hoehe_pct:  DEFAULT_H,
    }
    setPositions(prev => ({ ...prev, [id]: pos }))
    savePos(id, pos)
  }

  // ── Verschieben auf Canvas (Pointer Events) ───────────────────────────────────

  function handleBlockPointerDown(e: React.PointerEvent, id: string) {
    if (!writeOk || !positions[id] || !canvasRef.current) return
    e.stopPropagation()
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    dragStateRef.current = {
      id,
      startX: e.clientX, startY: e.clientY,
      origX:  positions[id].pos_x_pct,
      origY:  positions[id].pos_y_pct,
    }
  }

  function handleCanvasPointerMove(e: React.PointerEvent) {
    const ds = dragStateRef.current
    if (!ds || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const dx   = ((e.clientX - ds.startX) / rect.width)  * 100
    const dy   = ((e.clientY - ds.startY) / rect.height) * 100
    const pos  = positions[ds.id]
    if (!pos) return
    setPositions(prev => ({
      ...prev,
      [ds.id]: {
        ...pos,
        pos_x_pct: Math.max(0, Math.min(100 - pos.breite_pct, ds.origX + dx)),
        pos_y_pct: Math.max(0, Math.min(100 - pos.hoehe_pct,  ds.origY + dy)),
      },
    }))
  }

  function handleCanvasPointerUp(e: React.PointerEvent) {
    const ds = dragStateRef.current
    if (!ds) return
    canvasRef.current?.releasePointerCapture(e.pointerId)
    dragStateRef.current = null
    const pos = positions[ds.id]
    if (pos) savePos(ds.id, pos)
  }

  // ── Vom Plan entfernen ───────────────────────────────────────────────────────

  function handleRemove(id: string) {
    setPositions(prev => { const n = { ...prev }; delete n[id]; return n })
    startTransition(async () => {
      await deleteKellerplanPosition(plan.id, id)
    })
  }

  // ── Grid-Hintergrund (1 m = 1 Gitterzelle) ───────────────────────────────────

  const gridBgStyle = {
    backgroundImage:
      'linear-gradient(to right, #e5e7eb 1px, transparent 1px), ' +
      'linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)',
    backgroundSize: `${100 / plan.breite_m}% ${100 / plan.laenge_m}%`,
  }

  return (
    <>
      {/* Print-Styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          aside, nav, header, footer, [data-sidebar] { display: none !important; }
          .print-only { display: block !important; }
          body { background: white; }
          .kellerplan-canvas { box-shadow: none !important; }
        }
        @media screen {
          .print-only { display: none !important; }
        }
      `}</style>

      <div className="flex gap-6 items-start">

        {/* ── Canvas ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Saving-Indikator */}
          {saving && (
            <p className="text-xs text-s112-muted mb-1 no-print">Wird gespeichert…</p>
          )}

          {/* Grundriss-Canvas */}
          <div
            ref={canvasRef}
            className="kellerplan-canvas relative w-full border-2 border-gray-500 bg-white select-none"
            style={{
              paddingBottom: `${aspect * 100}%`,
              cursor: writeOk ? 'crosshair' : 'default',
              ...gridBgStyle,
            }}
            onDragOver={writeOk ? handleCanvasDragOver : undefined}
            onDrop={writeOk ? handleCanvasDrop : undefined}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
          >
            {/* Behälter auf dem Plan */}
            {Object.entries(positions).map(([behaelterId, pos]) => {
              const b    = behaelterMap[behaelterId]
              if (!b) return null
              const typ  = TYP[b.typ] ?? TYP.sonstiges
              const wein = weinMap[behaelterId] ?? null

              return (
                <div
                  key={behaelterId}
                  className="absolute rounded-md border-2 flex flex-col items-center justify-center overflow-hidden"
                  style={{
                    left:            `${pos.pos_x_pct}%`,
                    top:             `${pos.pos_y_pct}%`,
                    width:           `${pos.breite_pct}%`,
                    height:          `${pos.hoehe_pct}%`,
                    backgroundColor: typ.bg,
                    borderColor:     typ.border,
                    cursor:          writeOk ? 'grab' : 'default',
                    touchAction:     'none',
                  }}
                  onPointerDown={e => handleBlockPointerDown(e, behaelterId)}
                >
                  {/* Entfernen-Button */}
                  {writeOk && (
                    <button
                      className="no-print absolute -top-2 -right-2 w-4 h-4 rounded-full bg-gray-500 hover:bg-red-500 text-white text-[9px] flex items-center justify-center z-10 leading-none"
                      onClick={e => { e.stopPropagation(); handleRemove(behaelterId) }}
                      onPointerDown={e => e.stopPropagation()}
                      title="Vom Plan entfernen"
                    >
                      ×
                    </button>
                  )}

                  {/* Inhalt: Name, Volumen, Wein */}
                  <div className="px-1 text-center w-full pointer-events-none">
                    <p className="font-bold text-gray-800 leading-tight truncate w-full text-center"
                       style={{ fontSize: 'clamp(6px, 1.2cqw, 11px)' }}>
                      {b.name}
                    </p>
                    {b.volumen_liter && (
                      <p className="text-gray-500 leading-tight"
                         style={{ fontSize: 'clamp(5px, 1cqw, 9px)' }}>
                        {b.volumen_liter.toLocaleString('de-AT')} L
                      </p>
                    )}
                    {wein && (
                      <p className="leading-tight mt-0.5 truncate w-full text-center font-medium"
                         style={{ fontSize: 'clamp(5px, 1cqw, 9px)', color: 'var(--s112-teal, #14b8a6)' }}>
                        {wein.name}{wein.jahrgang ? ` ${wein.jahrgang}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Leer-Hinweis */}
            {Object.keys(positions).length === 0 && writeOk && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-gray-400 text-center px-8">
                  Behälter aus der Liste rechts in den Grundriss ziehen
                </p>
              </div>
            )}
          </div>

          {/* Legende */}
          <div className="no-print mt-2 flex flex-wrap gap-2">
            {Object.entries(TYP).map(([key, t]) => (
              <span key={key}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border"
                style={{ backgroundColor: t.bg, borderColor: t.border, color: '#374151' }}>
                {t.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-teal-200 bg-teal-50 text-teal-700">
              Weinfarbe = aktive Charge
            </span>
          </div>

          {/* Maßstab-Hinweis */}
          <p className="no-print text-xs text-s112-muted mt-1">
            Gitternetz = 1 m · Raum: {plan.breite_m} × {plan.laenge_m} m
          </p>
        </div>

        {/* ── Sidebar: nicht platzierte Behälter ────────────────────────────── */}
        {writeOk && (
          <div className="no-print w-44 flex-shrink-0">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Nicht platziert
            </p>
            {unplaced.length === 0 ? (
              <p className="text-xs text-s112-muted italic">Alle Behälter platziert ✓</p>
            ) : (
              <div className="space-y-1.5">
                {unplaced.map(b => {
                  const typ = TYP[b.typ] ?? TYP.sonstiges
                  return (
                    <div
                      key={b.id}
                      draggable
                      onDragStart={e => handleSidebarDragStart(e, b.id)}
                      className="flex items-center gap-2 px-2 py-1.5 border-2 rounded-lg text-xs font-medium text-gray-700 cursor-grab hover:shadow-sm active:opacity-70 transition-shadow"
                      style={{ backgroundColor: typ.bg, borderColor: typ.border }}
                      title="In den Plan ziehen"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{b.name}</p>
                        <p className="text-[10px] text-gray-500">{typ.label}{b.volumen_liter ? ` · ${b.volumen_liter.toLocaleString('de-AT')} L` : ''}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-4 space-y-1 text-[10px] text-s112-muted">
              <p>↖ Ziehen zum Platzieren</p>
              <p>↔ Auf dem Plan verschieben</p>
              <p>✕ Vom Plan entfernen</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
