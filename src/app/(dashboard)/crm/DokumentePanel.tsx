'use client'

import { useState, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { AktivitaetDokument } from '@/lib/crm/types'

function fmtBytes(b: number | null): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function DokumentePanel({
  aktivitaetId,
  initialDokumente,
  writeOk,
}: {
  aktivitaetId: string
  initialDokumente: AktivitaetDokument[]
  writeOk: boolean
}) {
  const [docs, setDocs]       = useState<AktivitaetDokument[]>(initialDokumente)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const inputRef              = useRef<HTMLInputElement>(null)

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`/api/crm/aktivitaet/${aktivitaetId}/dokument`, { method: 'POST', body: fd })
    if (res.ok) {
      const dok = await res.json()
      setDocs(prev => [...prev, { ...dok, aktivitaet_id: aktivitaetId, storage_pfad: '' }])
    } else {
      const { error: msg } = await res.json().catch(() => ({ error: 'Upload fehlgeschlagen' }))
      setError(msg ?? 'Upload fehlgeschlagen')
    }
    setUploading(false)
  }

  async function handleDelete(dokId: string) {
    if (!confirm('Dokument löschen?')) return
    const res = await fetch(`/api/crm/aktivitaet/${aktivitaetId}/dokument/${dokId}`, { method: 'DELETE' })
    if (res.ok) setDocs(prev => prev.filter(d => d.id !== dokId))
  }

  return (
    <div className="mt-2">
      {/* Dokumentenliste */}
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-1 bg-s112-bg border border-s112-border rounded-lg px-2 py-1 text-xs group">
              <a
                href={`/api/crm/aktivitaet/${aktivitaetId}/dokument/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-s112-teal hover:underline max-w-[140px] truncate"
                title={d.dateiname}
              >
                {d.dateiname}
              </a>
              {d.groesse_bytes && (
                <span className="text-s112-muted ml-0.5">{fmtBytes(d.groesse_bytes)}</span>
              )}
              {writeOk && (
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  className="ml-0.5 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                  title="Löschen"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload-Button */}
      {writeOk && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-xs text-s112-muted hover:text-s112-teal border border-dashed border-gray-200 hover:border-s112-teal/40 rounded px-2 py-0.5 transition-colors disabled:opacity-40"
          >
            {uploading ? 'Hochladen…' : 'Anhang'}
          </button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      )}
    </div>
  )
}
