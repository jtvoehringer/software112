'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { deactivateWeingarten, deleteWeingarten } from './actions'
import { fmtHa } from '@/lib/format'

const BEWIRTSCHAFTUNG_LABELS: Record<string, string> = {
  konventionell: 'Konventionell',
  bio:           'Bio',
  in_umstellung: 'In Umstellung',
  demeter:       'Demeter',
}

type WRow = {
  id: string; name: string; ried: string | null; rebsorte: string | null
  flaeche_ha: number | null; bewirtschaftung: string | null; aktiv: boolean
}

type SortKey = 'name' | 'ried' | 'rebsorte' | 'flaeche_ha' | 'bewirtschaftung'
type SortDir = 'asc' | 'desc'

function SortTh({
  label, col, current, dir, align = 'left', onSort,
}: {
  label: string; col: SortKey; current: SortKey; dir: SortDir
  align?: 'left' | 'right'; onSort: (col: SortKey) => void
}) {
  const active = col === current
  return (
    <th
      className={`px-4 py-3 font-semibold text-gray-700 cursor-pointer select-none hover:text-s112-teal transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs ${active ? 'text-s112-teal' : 'text-gray-300'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

export default function WeingartenTable({
  weingaerten, writeOk, adminOk,
}: {
  weingaerten: WRow[]; writeOk: boolean; adminOk: boolean
}) {
  const [sortCol, setSortCol] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [pending, startTransition] = useTransition()

  function handleSort(col: SortKey) {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sorted = [...weingaerten].sort((a, b) => {
    let av: string | number | null = a[sortCol]
    let bv: string | number | null = b[sortCol]
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av
    }
    av = String(av).toLowerCase()
    bv = String(bv).toLowerCase()
    return sortDir === 'asc' ? av.localeCompare(bv, 'de') : bv.localeCompare(av, 'de')
  })

  function handleDelete(id: string, name: string) {
    if (!confirm(`Weingarten "${name}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return
    startTransition(() => deleteWeingarten(id))
  }

  function handleDeactivate(id: string) {
    startTransition(() => deactivateWeingarten(id))
  }

  return (
    <div className={`card p-0 overflow-hidden ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-s112-bg border-b border-s112-border">
            <SortTh label="Name"           col="name"           current={sortCol} dir={sortDir} onSort={handleSort} />
            <SortTh label="Ried"           col="ried"           current={sortCol} dir={sortDir} onSort={handleSort} />
            <SortTh label="Rebsorte"       col="rebsorte"       current={sortCol} dir={sortDir} onSort={handleSort} />
            <SortTh label="Fläche (ha)"    col="flaeche_ha"     current={sortCol} dir={sortDir} onSort={handleSort} align="right" />
            <SortTh label="Bewirtschaftung" col="bewirtschaftung" current={sortCol} dir={sortDir} onSort={handleSort} />
            <th className="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
            <th className="text-right px-4 py-3 font-semibold text-gray-700">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((w, i) => (
            <tr
              key={w.id}
              className={`border-b border-s112-border last:border-0 ${!w.aktiv ? 'opacity-50' : ''} ${i % 2 === 0 ? '' : 'bg-s112-bg/50'}`}
            >
              <td className="px-4 py-3 font-medium text-gray-900">{w.name}</td>
              <td className="px-4 py-3 text-s112-muted">{w.ried ?? '–'}</td>
              <td className="px-4 py-3">{w.rebsorte ?? '–'}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {fmtHa(w.flaeche_ha)}
              </td>
              <td className="px-4 py-3">
                {w.bewirtschaftung ? (
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    w.bewirtschaftung === 'bio' || w.bewirtschaftung === 'demeter'
                      ? 'bg-green-100 text-green-700'
                      : w.bewirtschaftung === 'in_umstellung'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {BEWIRTSCHAFTUNG_LABELS[w.bewirtschaftung] ?? w.bewirtschaftung}
                  </span>
                ) : '–'}
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`inline-block w-2 h-2 rounded-full ${w.aktiv ? 'bg-green-500' : 'bg-gray-300'}`} />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-3">
                  {writeOk && (
                    <Link
                      href={`/weingarten/${w.id}`}
                      className="text-s112-teal hover:underline text-xs font-medium"
                    >
                      Bearbeiten
                    </Link>
                  )}
                  {adminOk && w.aktiv && (
                    <button
                      onClick={() => handleDeactivate(w.id)}
                      className="text-yellow-500 hover:text-yellow-700 text-xs"
                    >
                      Deaktivieren
                    </button>
                  )}
                  {adminOk && (
                    <button
                      onClick={() => handleDelete(w.id, w.name)}
                      className="text-red-400 hover:text-red-600 text-xs"
                    >
                      Löschen
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
