'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'

export default function BelegUpload() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    let fehlerText = ''
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/buchhaltung/belege', { method: 'POST', body: fd })
        const json = await res.json()
        if (!res.ok) fehlerText = `${file.name}: ${json.error ?? 'Upload fehlgeschlagen'}`
      } catch {
        fehlerText = `${file.name}: Upload fehlgeschlagen. Bitte erneut versuchen.`
      }
    }
    if (fehlerText) setError(fehlerText)
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
    router.refresh()
  }

  return (
    <div
      className={`bg-white rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-s112-teal bg-s112-bg' : 'border-s112-border'}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        id="beleg-upload-input"
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
        disabled={uploading}
      />
      <label htmlFor="beleg-upload-input" className="cursor-pointer inline-flex flex-col items-center gap-2">
        <Upload className={`w-8 h-8 ${uploading ? 'text-s112-muted animate-pulse' : 'text-s112-blue-700'}`} />
        <span className="text-sm font-medium text-s112-text-1">
          {uploading ? 'Wird hochgeladen und erkannt…' : 'Beleg-Foto oder PDF hierher ziehen oder klicken'}
        </span>
        <span className="text-xs text-s112-muted">PDF, JPEG, PNG oder WebP, max. 15 MB je Datei</span>
      </label>
      {error && <p className="text-s112-err-fg text-xs mt-3">{error}</p>}
    </div>
  )
}
