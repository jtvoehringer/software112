'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { deactivateWeingarten, deleteWeingarten } from './actions'

const BEWIRTSCHAFTUNG_BADGE: Record<string, string> = {
  bio:           'bg-green-100 text-green-700',
  demeter:       'bg-green-100 text-green-700',
  in_umstellung: 'bg-yellow-100 text-yellow-700',
  konventionell: 'bg-gray-100 text-gray-600',
}
const BEWIRTSCHAFTUNG_LABEL: Record<string, string> = {
  bio: 'Bio', demeter: 'Demeter', in_umstellung: 'In Umstellung', konventionell: 'Konventionell',
}

export type WRow = {
  id: string; name: string; ried: string | null; rebsorte: string | null
  flaeche_ha: number | null; bewirtschaftung: string | null; aktiv: boolean
}
export type GSTRow = {
  id: string; weingarten_id: string; gst_nr: string
  rebsorte: string | null; flaeche_ha: number | null
  spritzbar: boolean; katastralgemeinde: string | null
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

// ── Grundstück-Zeile ──────────────────────────────────────────────────────────

function GSTZeile({ gst }: { gst: GSTRow }) {
  return (
    <tr className="border-b border-s112-border/50 last:border-0 bg-white hover:bg-s112-bg/30 transition-colors">
      <td className="pl-16 pr-3 py-2 text-xs text-gray-500">
        <span className="font-mono">GST {gst.gst_nr}</span>
        {gst.katastralgemeinde && (
          <span className="ml-2 text-gray-400">{gst.katastralgemeinde}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-s112-muted">{gst.rebsorte ?? '–'}</td>
      <td className="px-3 py-2 text-xs text-right tabular-nums text-s112-muted">
        {gst.flaeche_ha != null ? gst.flaeche_ha.toFixed(4) : '–'}
      </td>
      <td className="px-3 py-2 text-xs text-center">
        {!gst.spritzbar && (
          <span className="text-xs text-gray-400 italic">Brache</span>
        )}
      </td>
      <td />
    </tr>
  )
}

// ── Weingarten-Zeile ──────────────────────────────────────────────────────────

function WeingartenZeile({
  w, gsts, writeOk, adminOk,
}: {
  w: WRow; gsts: GSTRow[]; writeOk: boolean; adminOk: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm(`"${w.name}" wirklich löschen?`)) return
    startTransition(() => deleteWeingarten(w.id))
  }
  function handleDeactivate() {
    startTransition(() => deactivateWeingarten(w.id))
  }

  const gstHa = gsts.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)

  return (
    <>
      <tr
        className={`border-b border-s112-border last:border-0 cursor-pointer select-none
          ${!w.aktiv ? 'opacity-50' : 'hover:bg-s112-bg/40'} transition-colors
          ${pending ? 'opacity-40 pointer-events-none' : ''}`}
        onClick={() => gsts.length > 0 && setOpen(o => !o)}
      >
        {/* expand chevron + name */}
        <td className="pl-8 pr-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className={`text-gray-400 ${gsts.length === 0 ? 'invisible' : ''}`}>
              <ChevronIcon open={open} />
            </span>
            <span className="font-medium text-gray-800 text-sm">{w.name}</span>
            {w.bewirtschaftung && (
              <span className={`inline-block px-1.5 py-0 rounded-full text-xs font-medium ${BEWIRTSCHAFTUNG_BADGE[w.bewirtschaftung] ?? 'bg-gray-100 text-gray-600'}`}>
                {BEWIRTSCHAFTUNG_LABEL[w.bewirtschaftung] ?? w.bewirtschaftung}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-sm text-s112-muted">{w.rebsorte ?? '–'}</td>
        <td className="px-3 py-2.5 text-sm text-right tabular-nums">
          {w.flaeche_ha != null ? w.flaeche_ha.toFixed(4) : (gstHa > 0 ? gstHa.toFixed(4) : '–')}
        </td>
        <td className="px-3 py-2.5 text-center">
          {gsts.length > 0 && (
            <span className="text-xs text-gray-400">{gsts.length} GST</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-3">
            {writeOk && (
              <Link href={`/weingarten/${w.id}`} className="text-s112-teal hover:underline text-xs font-medium">
                Bearbeiten
              </Link>
            )}
            {adminOk && w.aktiv && (
              <button onClick={handleDeactivate} className="text-yellow-500 hover:text-yellow-700 text-xs">
                Deaktivieren
              </button>
            )}
            {adminOk && (
              <button onClick={handleDelete} className="text-red-400 hover:text-red-600 text-xs">
                Löschen
              </button>
            )}
          </div>
        </td>
      </tr>

      {open && gsts.map(g => <GSTZeile key={g.id} gst={g} />)}
    </>
  )
}

// ── Lage-Gruppe ───────────────────────────────────────────────────────────────

function LageGruppe({
  ried, weingaerten, gstMap, writeOk, adminOk,
}: {
  ried: string; weingaerten: WRow[]; gstMap: Map<string, GSTRow[]>
  writeOk: boolean; adminOk: boolean
}) {
  const [open, setOpen] = useState(true)

  const totalHa = weingaerten.reduce((s, w) => {
    const gsts = gstMap.get(w.id) ?? []
    const ha = gsts.length > 0
      ? gsts.reduce((a, g) => a + (g.flaeche_ha ?? 0), 0)
      : (w.flaeche_ha ?? 0)
    return s + ha
  }, 0)

  return (
    <>
      <tr
        className="bg-s112-bg border-b border-s112-border cursor-pointer select-none hover:bg-s112-bg/80 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-4 py-2.5" colSpan={4}>
          <div className="flex items-center gap-2">
            <span className="text-s112-teal"><ChevronIcon open={open} /></span>
            <span className="font-semibold text-gray-900 text-sm">{ried}</span>
            <span className="text-xs text-s112-muted ml-1">
              {weingaerten.length} {weingaerten.length === 1 ? 'Weingarten' : 'Weingärten'}
              {' · '}
              {totalHa.toFixed(4)} ha
            </span>
          </div>
        </td>
        <td className="px-4 py-2.5" />
      </tr>

      {open && weingaerten.map(w => (
        <WeingartenZeile
          key={w.id}
          w={w}
          gsts={gstMap.get(w.id) ?? []}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      ))}
    </>
  )
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

export default function WeingartenBaum({
  weingaerten, grundstuecke, writeOk, adminOk,
}: {
  weingaerten: WRow[]; grundstuecke: GSTRow[]
  writeOk: boolean; adminOk: boolean
}) {
  // Grundstücke nach weingarten_id gruppieren
  const gstMap = new Map<string, GSTRow[]>()
  for (const g of grundstuecke) {
    const arr = gstMap.get(g.weingarten_id) ?? []
    arr.push(g)
    gstMap.set(g.weingarten_id, arr)
  }

  // Weingärten nach Ried gruppieren
  const lagenMap = new Map<string, WRow[]>()
  for (const w of weingaerten) {
    const ried = w.ried ?? '(Keine Ried)'
    const arr = lagenMap.get(ried) ?? []
    arr.push(w)
    lagenMap.set(ried, arr)
  }
  const lagen = Array.from(lagenMap.entries()).sort(([a], [b]) => a.localeCompare(b, 'de'))

  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-s112-bg border-b-2 border-s112-border">
            <th className="text-left px-4 py-3 font-semibold text-gray-700">Ried / Weingarten / GST</th>
            <th className="text-left px-3 py-3 font-semibold text-gray-700">Rebsorte</th>
            <th className="text-right px-3 py-3 font-semibold text-gray-700">Fläche (ha)</th>
            <th className="text-center px-3 py-3 font-semibold text-gray-700">Details</th>
            <th className="text-right px-3 py-3 font-semibold text-gray-700">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {lagen.map(([ried, wgs]) => (
            <LageGruppe
              key={ried}
              ried={ried}
              weingaerten={wgs}
              gstMap={gstMap}
              writeOk={writeOk}
              adminOk={adminOk}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
