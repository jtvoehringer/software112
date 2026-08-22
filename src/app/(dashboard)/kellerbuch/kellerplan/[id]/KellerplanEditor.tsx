'use client'

import { useState, useRef, useTransition, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, FlaskConical, Wine } from 'lucide-react'
import { upsertKellerplanPosition, deleteKellerplanPosition } from '../actions'

// ── Typen ─────────────────────────────────────────────────────────────────────

type Plan = { id: string; name: string; breite_m: number; laenge_m: number }

type Behaelter = {
  id: string
  name: string
  typ: string
  volumen_liter: number | null
}

type WeinInfo = { weinausbauId: string; name: string; jahrgang: number | null; rebsorte: string | null }

// ── Füllstand-Farbskala ───────────────────────────────────────────────────────

function getFillColor(pct: number): string {
  if (pct >= 1.0) return '#EF4444'   // rot   – voll / überfüllt
  if (pct >= 0.9) return '#F97316'   // orange – fast voll (≥ 90 %)
  if (pct >= 0.7) return '#F9E54F'   // gelb  – mittelvoll (≥ 70 %)
  return '#98C780'                    // grün  – gut (< 70 %)
}

// pos_x_pct / pos_y_pct = linke obere Ecke des Kreisboundingbox (% des Canvas)
// breite_pct = Durchmesser als % der Canvas-Breite
type PosData = { pos_x_pct: number; pos_y_pct: number; breite_pct: number; hoehe_pct: number }

// ── Farben pro Behälter-Typ ───────────────────────────────────────────────────

const TYP: Record<string, { bg: string; border: string; label: string }> = {
  lagertank:    { bg: '#f1f5f9', border: '#94a3b8', label: 'Lagertank'      },
  immervolltank:{ bg: '#e0f2fe', border: '#0284c7', label: 'Immervoll-Tank' },
  stahltank:    { bg: '#f1f5f9', border: '#94a3b8', label: 'Stahltank'      }, // legacy
  holzfass:     { bg: '#fffbeb', border: '#d97706', label: 'Holzfass'       },
  betonei:   { bg: '#fafaf9', border: '#78716c', label: 'Betonei'   },
  amphore:   { bg: '#fff7ed', border: '#ea580c', label: 'Amphore'   },
  bottich:        { bg: '#f0fdf4', border: '#16a34a', label: 'Bottich'         },
  gaerstaender:   { bg: '#fefce8', border: '#ca8a04', label: 'Gärständer'      },
  zisterne:       { bg: '#ecfeff', border: '#0891b2', label: 'Zisterne'        },
  presse:         { bg: '#faf5ff', border: '#9333ea', label: 'Presse'          },
  barrique:       { bg: '#fef2f2', border: '#b45309', label: 'Barrique'        },
  doppelbarrique: { bg: '#fdf2f8', border: '#be185d', label: 'Doppel-Barrique' },
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

// Schwellwert (in % der Canvas-Breite/Höhe), unterhalb dessen ein Pointer-Down/Up
// als Klick (statt Verschieben) gewertet wird → öffnet den Gebinde-Dialog.
const CLICK_THRESHOLD_PCT = 0.6

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function KellerplanEditor({
  plan,
  initialPositions,
  behaelter,
  weinMap,
  fillMap,
  writeOk,
}: {
  plan: Plan
  initialPositions: Record<string, PosData>
  behaelter: Behaelter[]
  weinMap: Record<string, WeinInfo>
  fillMap: Record<string, number>
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
  const [dialogBehaelterId, setDialogBehaelterId] = useState<string | null>(null)

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
    if (!positions[id] || !canvasRef.current) return
    e.stopPropagation()
    if (!writeOk) {
      // Read-only: kein Verschieben möglich, aber Klick soll den Gebinde-Dialog öffnen
      setDialogBehaelterId(id)
      return
    }
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

    const rect = canvasRef.current?.getBoundingClientRect()
    const dxPct = rect ? Math.abs(((e.clientX - ds.startX) / rect.width)  * 100) : 0
    const dyPct = rect ? Math.abs(((e.clientY - ds.startY) / rect.height) * 100) : 0
    const wasClick = dxPct < CLICK_THRESHOLD_PCT && dyPct < CLICK_THRESHOLD_PCT

    if (wasClick) {
      // Kaum/keine Bewegung → als Klick werten und Gebinde-Dialog öffnen (kein Speichern nötig)
      setDialogBehaelterId(ds.id)
      return
    }

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

  // ── Gebinde-Dialog: Behälter + ggf. aktuelle Charge für die Sprung-Links ────
  const dialogBehaelter = dialogBehaelterId ? behaelterMap[dialogBehaelterId] : null
  const dialogWein       = dialogBehaelterId ? weinMap[dialogBehaelterId] ?? null : null

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
        <p className="no-print text-xs text-red-500 mb-1">{saveError}</p>
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

              // Füllstand berechnen
              const fillLiter  = fillMap[behaelterId] ?? 0
              const fillPct    = b.volumen_liter && b.volumen_liter > 0
                ? fillLiter / b.volumen_liter
                : null
              const fillColor  = fillPct !== null ? getFillColor(fillPct) : null
              const fillHeight = fillPct !== null ? Math.min(fillPct * 100, 100) : 0
              const fillPctDisplay = fillPct !== null
                ? Math.round(fillPct * 100)
                : null

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
                    border:          `2px solid ${fillColor ?? typ.border}`,
                    cursor:          writeOk ? 'grab' : 'pointer',
                    touchAction:     'none',
                  }}
                  onPointerDown={e => handleBlockPointerDown(e, behaelterId)}
                  title="Klicken für Umziehen / Kellerbehandlungen / Abfüllen"
                >
                  {/* ── Füllstand-Fläche (bottom-anchored, durch overflow:hidden zum Kreis geschnitten) */}
                  {fillColor && (
                    <div
                      style={{
                        position:        'absolute',
                        bottom:          0,
                        left:            0,
                        right:           0,
                        height:          `${fillHeight}%`,
                        backgroundColor: fillColor,
                        opacity:         0.32,
                        zIndex:          0,
                        transition:      'height 0.4s ease',
                        pointerEvents:   'none',
                      }}
                    />
                  )}

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

                  {/* Inhalt: Name, Füllstand, Wein – über der Fill-Fläche */}
                  <div className="px-1 text-center w-4/5 pointer-events-none" style={{ position: 'relative', zIndex: 2 }}>
                    <p
                      className="font-bold text-gray-800 leading-tight truncate w-full text-center"
                      style={{ fontSize: 'clamp(5px, 1.4cqw, 11px)' }}
                    >
                      {b.name}
                    </p>
                    {b.volumen_liter && (
                      <p
                        className="text-gray-600 leading-tight font-medium"
                        style={{ fontSize: 'clamp(4px, 1.1cqw, 9px)' }}
                      >
                        {fillLiter > 0
                          ? `${fillLiter.toLocaleString('de-AT', { maximumFractionDigits: 0 })} / ${b.volumen_liter.toLocaleString('de-AT')} L`
                          : `${b.volumen_liter.toLocaleString('de-AT')} L`
                        }
                        {fillPctDisplay !== null && fillLiter > 0 && (
                          <span style={{ marginLeft: '2px', color: fillColor ?? undefined }}>
                            {` (${fillPctDisplay} %)`}
                          </span>
                        )}
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
            <span className="text-[10px] text-gray-400 mx-1">|</span>
            {[
              { color: '#98C780', label: '< 70 %' },
              { color: '#F9E54F', label: '70–90 %' },
              { color: '#F97316', label: '90–100 %' },
              { color: '#EF4444', label: '≥ 100 %' },
            ].map(({ color, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border border-gray-200"
                style={{ color: '#374151' }}
              >
                <span
                  style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: color, opacity: 0.8 }}
                />
                {label}
              </span>
            ))}
          </div>

          <p className="no-print text-xs text-s112-muted mt-1">
            Gitternetz = 1 m · Raum: {plan.breite_m} × {plan.laenge_m} m ·
            Klick: Gebinde-Aktionen · Hover: −/+ Größe anpassen · × Entfernen
          </p>
        </div>

        {/* ── Sidebar: nicht platzierte Behälter ────────────────────────────── */}
        {writeOk && (
          <div className="no-print w-44 flex-shrink-0">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Nicht platziert
            </p>
            {unplaced.length === 0 ? (
              <p className="text-xs text-s112-muted italic">Alle Behälter platziert</p>
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
              <p>Klick → Umziehen / Behandlungen / Abfüllen</p>
              <p>↔ Auf Plan verschieben</p>
              <p>− + Größe (hover)</p>
              <p>× Entfernen (hover)</p>
            </div>
          </div>
        )}
      </div>

      {/* Gebinde-Dialog: Sprung zu Umziehen / Kellerbehandlungen / Abfüllen */}
      {dialogBehaelter && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setDialogBehaelterId(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800">{dialogBehaelter.name}</h3>
            <p className="text-xs text-s112-muted mt-0.5 mb-4">
              {dialogWein
                ? `${dialogWein.name}${dialogWein.jahrgang ? ` ${dialogWein.jahrgang}` : ''}${dialogWein.rebsorte ? ` · ${dialogWein.rebsorte}` : ''}`
                : 'Kein Wein im Behälter'}
            </p>

            <div className="space-y-2">
              <Link
                href={`/kellerbuch/behaelter/${dialogBehaelter.id}/umzuege`}
                onClick={() => setDialogBehaelterId(null)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-s112-border hover:border-s112-teal/50 hover:bg-s112-bg/40 transition-colors text-sm font-medium text-gray-700"
              >
                <ArrowLeftRight className="w-4 h-4" /> Umziehen
              </Link>
              <Link
                href={`/kellerbuch/behaelter/${dialogBehaelter.id}/behandlungen`}
                onClick={() => setDialogBehaelterId(null)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-s112-border hover:border-s112-teal/50 hover:bg-s112-bg/40 transition-colors text-sm font-medium text-gray-700"
              >
                <FlaskConical className="w-4 h-4" /> Kellerbehandlungen
              </Link>
              {dialogWein ? (
                <Link
                  href={`/weinhandel/fuellungen/neu?charge=${dialogWein.weinausbauId}`}
                  onClick={() => setDialogBehaelterId(null)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-s112-border hover:border-s112-teal/50 hover:bg-s112-bg/40 transition-colors text-sm font-medium text-gray-700"
                >
                  <Wine className="w-4 h-4" /> Abfüllen
                </Link>
              ) : (
                <div
                  title="Kein Wein im Behälter – nichts zum Abfüllen"
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-s112-border opacity-40 cursor-not-allowed text-sm font-medium text-gray-500"
                >
                  <Wine className="w-4 h-4" /> Abfüllen
                </div>
              )}
            </div>

            <button type="button" onClick={() => setDialogBehaelterId(null)}
              className="mt-4 px-4 py-1.5 rounded-lg text-sm text-gray-600 hover:text-gray-800">
              Schließen
            </button>
          </div>
        </div>
      )}
    </>
  )
}
