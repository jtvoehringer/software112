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

// pos_x_pct / pos_y_pct = linke obere Ecke des Kreisboundingbox (% des Canvas)
// breite_pct = Durchmesser als % der Canvas-Breite
type PosData = { pos_x_pct: number; pos_y_pct: number; breite_pct: number; hoehe_pct: number }

// ── Farben pro Behälter-Typ ───────────────────────────────────────────────────

const TYP: Record<string, { bg: string; border: string; label: string }> = {
  stahltank: { bg: '#f1f5f9', border: '#94a3b8', label: 'Stahltank' },
  holzfass:  { bg: '#fffbeb', border: '#d97706', label: 'Holzfass'  },
  betonei:   { bg: '#fafaf9', border: '#78716c', label: 'Betonei'   },
  amphore:   { bg: '#fff7ed', border: '#ea580c', label: 'Amphore'   },
  sonstiges: { bg: '#f9fafb', border: '#9ca3af', label: 'Sonstiges' },
}

// ── Konstanten ────────────────────────────────────────────────────────────────

// DIN A4 Portrait: 210 × 297 mm → Höhe/Breite = 297/210 ≈ 1.4143
const A4_RATIO   = 297 / 210
const A4_PERCENT = A4_RATIO * 100   // paddingBottom für A4-Canvas

// Für visuelle Kreise: Da der Canvas A4 ist (nicht quadratisch), muss
// height_pct = size_pct * (210/297) damit der Kreis rund wirkt
const circleHeight = (sizePct: number) => sizePct * (210 / 297)

const DEFAULT_SIZE = 10   // % Canvas-Breite (Startgröße)
const MIN_SIZE     =  4
const MAX_SIZE     = 35
const RESIZE_STEP  =  3

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
  const canvasRef    = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{
    id: string
    startX: number; startY: number
    origX:  number; origY: number
  } | null>(null)

  const [, startTransition]       = useTransition()
  const [positions, setPositions] = useState<Record<string, PosData>>(initialPositions)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const behaelterMap = Object.fromEntries(behaelter.map(b => [b.id, b]))
  const placedIds    = new Set(Object.keys(positions))
  const unplaced     = behaelter.filter(b => !placedIds.has(b.id))

  // ── Gitter: 1 Gitterzelle = 1 Meter im Raum ──────────────────────────────
  const gridBgStyle = {
    backgroundImage:
      'linear-gradient(to right, #e5e7eb 1px, transparent 1px), ' +
      'linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)',
    backgroundSize: `${100 / plan.breite_m}% ${100 / plan.laenge_m}%`,
  }

  // ── Persistenz ──────────────────────────────────────────────────────────────

  const savePos = useCallback((behaelterId: string, pos: PosData) => {
    setSaving(true)
    setSaveError(null)
    startTransition(async () => {
      try {
        await upsertKellerplanPosition(plan.id, behaelterId, pos)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
      } finally {
        setSaving(false)
      }
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
    const size = DEFAULT_SIZE
    const pos: PosData = {
      pos_x_pct:  Math.max(0, Math.min(100 - size,              rawX - size / 2)),
      pos_y_pct:  Math.max(0, Math.min(100 - circleHeight(size), rawY - circleHeight(size) / 2)),
      breite_pct: size,
      hoehe_pct:  size,
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

    setPositions(prev => {
      const pos = prev[ds.id]
      if (!pos) return prev
      return {
        ...prev,
        [ds.id]: {
          ...pos,
          pos_x_pct: Math.max(0, Math.min(100 - pos.breite_pct,              ds.origX + dx)),
          pos_y_pct: Math.max(0, Math.min(100 - circleHeight(pos.breite_pct), ds.origY + dy)),
        },
      }
    })
  }

  function handleCanvasPointerUp(e: React.PointerEvent) {
    const ds = dragStateRef.current
    if (!ds) return
    canvasRef.current?.releasePointerCapture(e.pointerId)
    dragStateRef.current = null
    const pos = positions[ds.id]
    if (pos) savePos(ds.id, pos)
  }

  // ── Resize ────────────────────────────────────────────────────────────────────

  function handleResize(id: string, delta: number) {
    setPositions(prev => {
      const pos = prev[id]
      if (!pos) return prev
      const newSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pos.breite_pct + delta))
      const newPos: PosData = {
        ...pos,
        breite_pct: newSize,
        hoehe_pct:  newSize,
        pos_x_pct:  Math.max(0, Math.min(100 - newSize,              pos.pos_x_pct)),
        pos_y_pct:  Math.max(0, Math.min(100 - circleHeight(newSize), pos.pos_y_pct)),
      }
      savePos(id, newPos)
      return { ...prev, [id]: newPos }
    })
  }

  // ── Vom Plan entfernen ───────────────────────────────────────────────────────

  function handleRemove(id: string) {
    setPositions(prev => { const n = { ...prev }; delete n[id]; return n })
    startTransition(async () => {
      try {
        await deleteKellerplanPosition(plan.id, id)
      } catch (err) {
        console.error('Löschen fehlgeschlagen:', err)
      }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────────

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

      {/* Speicher-Status */}
      {saving && (
        <p className="no-print text-xs text-s112-muted mb-1">Wird gespeichert…</p>
      )}
      {saveError && (
        <p className="no-print text-xs text-red-500 mb-1">⚠ {saveError}</p>
      )}

      <div className="flex gap-6 items-start">

        {/* ── Canvas ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">

          {/* A4-Canvas – festes Seitenverhältnis 210:297 */}
          <div
            ref={canvasRef}
            className="kellerplan-canvas relative w-full border-2 border-gray-500 bg-white select-none"
            style={{
              paddingBottom: `${A4_PERCENT}%`,
              cursor: writeOk ? 'crosshair' : 'default',
              ...gridBgStyle,
            }}
            onDragOver={writeOk ? handleCanvasDragOver : undefined}
            onDrop={writeOk ? handleCanvasDrop : undefined}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
          >
            {/* Behälter auf dem Plan – als Kreise */}
            {Object.entries(positions).map(([behaelterId, pos]) => {
              const b    = behaelterMap[behaelterId]
              if (!b) return null
              const typ  = TYP[b.typ] ?? TYP.sonstiges
              const wein = weinMap[behaelterId] ?? null
              const size = pos.breite_pct
              const hPct = circleHeight(size)

              return (
                <div
                  key={behaelterId}
                  className="absolute overflow-hidden flex flex-col items-center justify-center group"
                  style={{
                    left:            `${pos.pos_x_pct}%`,
                    top:             `${pos.pos_y_pct}%`,
                    width:           `${size}%`,
                    height:          `${hPct}%`,
                    borderRadius:    '50%',
                    backgroundColor: typ.bg,
                    border:          `2px solid ${typ.border}`,
                    cursor:          writeOk ? 'grab' : 'default',
                    touchAction:     'none',
                  }}
                  onPointerDown={e => handleBlockPointerDown(e, behaelterId)}
                >
                  {/* Entfernen-Button */}
                  {writeOk && (
                    <button
                      className="no-print absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-400 hover:bg-red-500 text-white text-[9px] flex items-center justify-center z-20 leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={e => { e.stopPropagation(); handleRemove(behaelterId) }}
                      onPointerDown={e => e.stopPropagation()}
                      title="Vom Plan entfernen"
                    >
                      ×
                    </button>
                  )}

                  {/* Resize-Buttons − / + */}
                  {writeOk && (
                    <>
                      <button
                        className="no-print absolute bottom-1 left-1 w-4 h-4 rounded-full bg-gray-200 hover:bg-s112-teal hover:text-white text-gray-600 text-[11px] flex items-center justify-center z-20 leading-none opacity-0 group-hover:opacity-100 transition-opacity font-bold"
                        onClick={e => { e.stopPropagation(); handleResize(behaelterId, -RESIZE_STEP) }}
                        onPointerDown={e => e.stopPropagation()}
                        title="Kleiner"
                      >
                        −
                      </button>
                      <button
                        className="no-print absolute bottom-1 right-1 w-4 h-4 rounded-full bg-gray-200 hover:bg-s112-teal hover:text-white text-gray-600 text-[11px] flex items-center justify-center z-20 leading-none opacity-0 group-hover:opacity-100 transition-opacity font-bold"
                        onClick={e => { e.stopPropagation(); handleResize(behaelterId, +RESIZE_STEP) }}
                        onPointerDown={e => e.stopPropagation()}
                        title="Größer"
                      >
                        +
                      </button>
                    </>
                  )}

                  {/* Inhalt: Name, Volumen, Wein */}
                  <div className="px-1 text-center w-4/5 pointer-events-none">
                    <p
                      className="font-bold text-gray-800 leading-tight truncate w-full text-center"
                      style={{ fontSize: 'clamp(5px, 1.4cqw, 11px)' }}
                    >
                      {b.name}
                    </p>
                    {b.volumen_liter && (
                      <p
                        className="text-gray-500 leading-tight"
                        style={{ fontSize: 'clamp(4px, 1.1cqw, 9px)' }}
                      >
                        {b.volumen_liter.toLocaleString('de-AT')} L
                      </p>
                    )}
                    {wein && (
                      <p
                        className="leading-tight truncate w-full text-center font-medium"
                        style={{ fontSize: 'clamp(4px, 1.1cqw, 9px)', color: 'var(--s112-teal, #14b8a6)' }}
                      >
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

            {/* A4-Label für Druck */}
            <div className="print-only absolute bottom-1 right-2 text-[8px] text-gray-300">
              DIN A4 · {plan.breite_m} × {plan.laenge_m} m
            </div>
          </div>

          {/* Legende */}
          <div className="no-print mt-2 flex flex-wrap gap-2 items-center">
            {Object.entries(TYP).map(([key, t]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border"
                style={{ backgroundColor: t.bg, borderColor: t.border, color: '#374151' }}
              >
                {t.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-teal-200 bg-teal-50 text-teal-700">
              Teal = aktive Weincharge
            </span>
          </div>

          <p className="no-print text-xs text-s112-muted mt-1">
            Gitternetz = 1 m · Raum: {plan.breite_m} × {plan.laenge_m} m ·
            Hover: −/+ Größe anpassen · × Entfernen
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
                      className="flex items-center gap-2 px-2 py-1.5 border-2 rounded-full text-xs font-medium text-gray-700 cursor-grab hover:shadow-sm active:opacity-70 transition-shadow"
                      style={{ backgroundColor: typ.bg, borderColor: typ.border }}
                      title="In den Plan ziehen"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{b.name}</p>
                        <p className="text-[10px] text-gray-500">
                          {typ.label}{b.volumen_liter ? ` · ${b.volumen_liter.toLocaleString('de-AT')} L` : ''}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-4 space-y-1 text-[10px] text-s112-muted">
              <p>↖ Ziehen zum Platzieren</p>
              <p>↔ Auf Plan verschieben</p>
              <p>− + Größe (hover)</p>
              <p>✕ Entfernen (hover)</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
