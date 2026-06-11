/**
 * CSV-Utility für software:112
 * Erzeugt CSV-String und triggert Browser-Download (nur Client-Side)
 */

export function toCSV(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const escape = (v: unknown): string => {
    if (v == null) return ''
    const s = String(v).replace(/"/g, '""')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
  }
  const header = columns.map(c => escape(c.header)).join(',')
  const body   = rows.map(row => columns.map(c => escape(row[c.key])).join(',')).join('\n')
  return `﻿${header}\n${body}`  // BOM für Excel (Windows)
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportCSV(rows: Record<string, unknown>[], columns: { key: string; header: string }[], filename: string): void {
  downloadCSV(toCSV(rows, columns), filename)
}
