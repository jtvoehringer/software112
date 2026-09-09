import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { createJahrgang } from '../actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Neuer Jahrgang – software:112' }

export default async function NeuerJahrgangPage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/erntemeldung')

  async function handleSubmit(formData: FormData) {
    'use server'
    await createJahrgang(formData)
    redirect('/erntemeldung')
  }

  const aktuellesJahr = new Date().getFullYear()

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Neuer Jahrgang</h1>
        <p className="text-sm text-s112-muted mt-0.5">Jahrgang anlegen und Erntezeitraum festlegen</p>
      </div>
      <div className="card">
        <form action={handleSubmit} className="space-y-4">
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
            <button type="submit"
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Anlegen
            </button>
            <a href="/erntemeldung" className="px-5 py-2 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800">
              Abbrechen
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}
