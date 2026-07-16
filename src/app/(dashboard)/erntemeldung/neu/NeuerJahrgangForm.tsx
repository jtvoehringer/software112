'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createJahrgang } from '../actions'

export default function NeuerJahrgangForm({ aktuellesJahr }: { aktuellesJahr: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createJahrgang(formData)
      if (result?.error) { setError(result.error); return }
      router.push('/erntemeldung')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Jahrgang <span className="text-red-500">*</span>
        </label>
        <input name="jahrgang" type="number" required
          min="1900" max="2100" defaultValue={aktuellesJahr}
          className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ernte Beginn</label>
          <input name="ernte_beginn" type="date"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ernte Ende</label>
          <input name="ernte_ende" type="date"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notizen</label>
        <textarea name="notizen" rows={3}
          className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-40">
          {pending ? 'Anlegen…' : 'Anlegen'}
        </button>
        <a href="/erntemeldung" className="px-5 py-2 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
